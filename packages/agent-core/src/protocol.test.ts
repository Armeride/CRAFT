import { afterEach, describe, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  indexFixture,
  removeIndexFixture,
  type IndexFixture,
} from "../../indexer/src/test-helpers.js";
import { CodexAdapter } from "./codex.js";
import { claudePermissionHandler, consumeClaudeStream } from "./claude.js";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { capabilities, detectAgent, supportedVersion } from "./detect.js";
import {
  capture,
  resolveProgram,
  spawnProgram,
  terminateTree,
} from "./process.js";
import type { AdapterContext, AgentEvent } from "./contracts.js";

const fixturePath = resolve(
  "packages/agent-core/test-fixtures/codex-server.mjs",
);
const fixtures: IndexFixture[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await removeIndexFixture(fixture);
});

function context(signal = new AbortController().signal): AdapterContext {
  return {
    cwd: process.cwd(),
    prompt: "Fixture instruction",
    userPrompt: "Fixture instruction",
    signal,
    installation: {
      provider: "codex",
      path: process.execPath,
      version: "fixture",
      available: true,
      authentication: "not_required",
      capabilities,
    },
    mcp: { url: "http://127.0.0.1:1/mcp/fixture", token: "test-only" },
    emit: async () => {},
    session: async () => {},
    tool: async () => ({}),
    ask: async (request) => ({
      allow: request.kind === "question",
      answers: { focus: ["Story"] },
    }),
  };
}

describe("native protocol and process boundaries", () => {
  it("separates authentication failure and unknown status from installation, keeping account output private", async () => {
    const f = await indexFixture();
    fixtures.push(f);
    const script = join(f.app, "node_modules/@anthropic-ai/claude-code/cli.js");
    await mkdir(join(script, ".."), { recursive: true });
    const shim = join(f.app, "claude.cmd");
    await writeFile(
      shim,
      '@"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
    );
    const source = (auth: string) =>
      `if(process.argv.includes('--version'))console.log('2.1.294');else if(process.argv.includes('--help'))console.log('--strict-mcp-config --permission-prompts');else console.log(${JSON.stringify(auth)});`;
    await writeFile(
      script,
      source(
        JSON.stringify({ loggedIn: false, email: "fixture@example.invalid" }),
      ),
    );
    const unavailable = await detectAgent("claude", f.root, shim);
    expect(unavailable).toMatchObject({
      available: true,
      authentication: "unauthenticated",
      version: "2.1.294",
    });
    expect(JSON.stringify(unavailable)).not.toContain(
      "fixture@example.invalid",
    );
    await writeFile(script, source("unknown auth response"));
    expect(await detectAgent("claude", f.root, shim)).toMatchObject({
      available: true,
      authentication: "unknown",
    });
  });
  it("does not advertise required capabilities on older or unknown versions", () => {
    expect(supportedVersion("codex", "0.168.0")).toBe(false);
    expect(supportedVersion("codex", "0.169.0-alpha.11.1")).toBe(true);
    expect(supportedVersion("claude", "2.1.260")).toBe(false);
    expect(supportedVersion("claude", "2.1.293")).toBe(false);
    expect(supportedVersion("claude", "2.1.294")).toBe(true);
    expect(supportedVersion("claude", null)).toBe(false);
  });
  it("normalizes sanitized Claude stream fixtures without duplicating partial text or treating progress as completion", async () => {
    const messages = JSON.parse(
      await readFile(
        resolve("packages/agent-core/test-fixtures/claude-stream.json"),
        "utf8",
      ),
    ) as SDKMessage[];
    const ctx = context(),
      events: Omit<AgentEvent, "sequence" | "createdAt">[] = [],
      sessions: string[] = [];
    ctx.emit = async (event) => {
      events.push(event);
    };
    ctx.session = async (id) => {
      sessions.push(id);
    };
    async function* stream() {
      yield* messages;
    }
    await consumeClaudeStream(stream(), ctx);
    expect(
      events
        .filter((event) => event.type === "message.delta")
        .map((event) => event.text)
        .join(""),
    ).toBe("국경 초안 검토해 주세요.");
    expect(events.some((event) => event.type === "tool.completed")).toBe(false);
    expect(events.some((event) => event.tool?.startsWith("mcp__craft__"))).toBe(false);
    expect(sessions).toEqual(["fixture_session"]);
    expect(
      events.find((event) => event.type === "usage.updated")?.usage,
    ).toEqual({ inputTokens: 11, outputTokens: 4 });
    async function* missingResult() {
      yield messages[0]!;
    }
    await expect(consumeClaudeStream(missingResult(), ctx)).rejects.toThrow(
      "AGENT_PROTOCOL_INVALID",
    );
  });
  it("normalizes native UTF-8 chunks, questions, approvals and usage without a model", async () => {
    const events: Omit<AgentEvent, "sequence" | "createdAt">[] = [],
      requests: string[] = [];
    const ctx = context();
    ctx.emit = async (event) => {
      events.push(event);
    };
    ctx.ask = async (request) => {
      requests.push(request.kind);
      return {
        allow: request.kind === "question",
        answers: { focus: ["Story"] },
      };
    };
    await new CodexAdapter({
      command: process.execPath,
      args: [fixturePath, "normal"],
    }).execute(ctx);
    expect(
      events
        .filter((event) => event.type === "message.delta")
        .map((event) => event.text)
        .join(""),
    ).toBe("국경 초안");
    expect(requests).toEqual(["question", "approval"]);
    expect(events.filter((event) => event.tool).map(({ type, tool, code }) => [type, tool, code])).toEqual([
      ["tool.completed", "entity.get", "AGENT_TOOL_FAILED"],
      ["tool.started", "external_read", undefined],
      ["tool.completed", "external_read", undefined],
      ["tool.started", "commandExecution", undefined],
      ["tool.completed", "commandExecution", undefined],
    ]);
    expect(
      events.find((event) => event.type === "usage.updated")?.usage,
    ).toEqual({ inputTokens: 10, outputTokens: 3 });
  });

  it("rejects malformed frames and confirms interruption before returning", async () => {
    await expect(
      new CodexAdapter({
        command: process.execPath,
        args: [fixturePath, "malformed"],
      }).execute(context()),
    ).rejects.toThrow("AGENT_PROTOCOL_INVALID");
    const abort = new AbortController(),
      ctx = context(abort.signal);
    ctx.session = async () => {
      setTimeout(() => abort.abort(), 100);
    };
    await expect(
      new CodexAdapter({
        command: process.execPath,
        args: [fixturePath, "cancel"],
      }).execute(ctx),
    ).rejects.toThrow("AGENT_CANCELLED");
  });

  it("passes shell punctuation literally and resolves only recognized Windows launchers", async () => {
    const argument = '한국어 공백 & $(echo unsafe) "quote"';
    const result = await capture(
      {
        command: process.execPath,
        args: ["-e", "process.stdout.write(process.argv[1])"],
      },
      [argument],
      process.cwd(),
    );
    expect(result).toEqual({ code: 0, text: argument });
    const f = await indexFixture();
    fixtures.push(f);
    const script = join(f.app, "node_modules/@openai/codex/bin/codex.js");
    await mkdir(join(script, ".."), { recursive: true });
    await writeFile(script, "");
    const shim = join(f.app, "codex.cmd");
    await writeFile(
      shim,
      '@"%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
    );
    expect((await resolveProgram(shim, "codex")).args).toEqual([script]);
    await writeFile(shim, "arbitrary launcher");
    await expect(resolveProgram(shim, "codex")).rejects.toThrow(
      "AGENT_SHIM_UNSUPPORTED",
    );
    expect(
      (await detectAgent("codex", f.root, join(f.app, "missing.exe")))
        .available,
    ).toBe(false);
  });

  it("terminates the owned native process tree including a live descendant", async () => {
    if (process.platform !== "win32") return;
    const f = await indexFixture();
    fixtures.push(f);
    await mkdir(f.app, { recursive: true });
    const pidFile = join(f.app, "child-pid.txt");
    const child = spawnProgram(
      { command: process.execPath, args: [fixturePath, "tree", pidFile] },
      [],
      f.app,
    );
    try {
      let pid = 0;
      for (let n = 0; n < 100; n++) {
        try {
          pid = Number(await readFile(pidFile, "utf8"));
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
      expect(pid).toBeGreaterThan(0);
      process.kill(pid, 0);
      await terminateTree(child);
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      await terminateTree(child);
    }
  });

  it("returns Claude host answers and declines approvals without permission bypass", async () => {
    const ctx = context(),
      requests: string[] = [];
    ctx.ask = async (request) => {
      requests.push(request.kind);
      return {
        allow: request.kind === "question",
        answers: { "0": ["Story"] },
      };
    };
    const handler = claudePermissionHandler(ctx),
      options = {
        signal: ctx.signal,
        toolUseID: "fixture-tool-id",
        requestId: "fixture-request",
      };
    expect(
      await handler("mcp__craft__context_build", {}, options),
    ).toMatchObject({ behavior: "allow" });
    const policy = { ...options, serverPolicyAskOnly: true };
    expect(
      await handler("mcp__craft__context_build", {}, policy),
    ).toMatchObject({ behavior: "deny" });
    expect(
      await handler(
        "mcp__craft__context_build",
        {},
        { ...options, mcpServer: { name: "foreign", source: "dynamic" } },
      ),
    ).toMatchObject({ behavior: "deny" });
    requests.length = 0;
    const answered = await handler(
      "AskUserQuestion",
      {
        questions: [
          { question: "Choose focus", options: [{ label: "Story" }] },
        ],
      },
      options,
    );
    expect(answered).toMatchObject({
      behavior: "allow",
      updatedInput: { answers: { "Choose focus": "Story" } },
      toolUseID: "fixture-tool-id",
    });
    expect(
      await handler("Bash", { command: "sanitized command" }, options),
    ).toMatchObject({ behavior: "deny" });
    expect(requests).toEqual(["question", "approval"]);
  });
});
