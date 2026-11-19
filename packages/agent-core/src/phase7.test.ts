import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  commitFixture,
  indexFixture,
  removeIndexFixture,
} from "../../indexer/src/test-helpers.js";
import { rawObject } from "../../project-fs/src/content.js";
import type { Checkpoint, Task } from "../../schema/src/generated.js";
import { registerLocal } from "../../tasks/src/projects.js";
import { resumeContext } from "../../tasks/src/resume-context.js";
import { TaskService } from "../../tasks/src/service.js";
import type { AgentExecution, ProviderId } from "./contracts.js";
import { detectAgent } from "./detect.js";
import { ExternalProfiles } from "./external.js";
import { AgentService } from "./service.js";
import { listSkills } from "./skills.js";

async function pending(
  service: AgentService,
  id: string,
  previous?: string,
): Promise<AgentExecution> {
  for (let attempt = 0; attempt < 240; attempt++) {
    const record = await service.get(id);
    if (record.pending && record.pending.id !== previous) return record;
    if (
      ["completed", "failed", "cancelled", "interrupted"].includes(record.state)
    ) {
      throw new Error(record.code ?? record.state);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Expected external approval");
}

it("recovers pinned instructions and external operation receipts when switching providers without local logs", async () => {
  const f = await indexFixture();
  const firstApp = new TaskService(f.app),
    recoveredApp = join(f.home, "Fresh app");
  const known: string[] = [];
  const unknown: string[] = [];
  const listener = createServer(async (request, response) => {
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    let raw = "";
    for await (const part of request) raw += part;
    const body = JSON.parse(raw);
    const send = (result: unknown) =>
      response
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
    if (body.method === "initialize") {
      send({
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "CRAFT fixture", version: "1" },
      });
    } else if (body.method === "notifications/initialized") {
      response.writeHead(202).end();
    } else {
      const reply = (structuredContent: object) =>
        send({ content: [], structuredContent });
      if (
        body.params.name === "status" &&
        body.params.arguments.jobId === "job_fixture"
      ) {
        reply({ status: "completed" });
      } else if (body.params.arguments.lost) {
        unknown.push(String(request.headers["idempotency-key"]));
        request.socket.destroy();
      } else {
        known.push(String(request.headers["idempotency-key"]));
        reply({ jobId: "job_fixture" });
      }
    }
  });
  const detect = async (provider: ProviderId, cwd: string) => ({
    ...(await detectAgent("fake", cwd)),
    provider,
  });
  const ledgerTool = "external.call",
    endpoint = "http://127.0.0.1:4173";
  const publish = { tool: "publish", arguments: { document: "scene" } };
  const loseConnection = {
    tool: "publish",
    arguments: { document: "scene", lost: true },
  };
  const sendResult = "First provider planned the opening scene.";
  const first = new AgentService(f.app, {
    detect,
    adapters: {
      codex: {
        execute: async (context) => {
          expect(context.prompt).toContain("Confirm border names");
          expect(context.prompt).toContain("builtin:scene-writing");
          const queued = await context.tool(ledgerTool, publish);
          expect(queued).toMatchObject({
            state: "pending",
            job_id: "job_fixture",
            idempotency_key: known[0],
          });
          const lost = await context.tool(ledgerTool, loseConnection);
          expect(lost).toMatchObject({
            state: "external_state_unknown",
            idempotency_key: unknown[0],
          });
          await context.session("transient-provider-session");
          await context.emit({ type: "message.delta", text: sendResult });
        },
      },
    },
  });
  const second = new AgentService(recoveredApp, {
    detect,
    adapters: {
      claude: {
        execute: async (context) => {
          expect(context.prompt).toContain(sendResult);
          expect(context.prompt).toContain("Confirm border names");
          expect(context.prompt).toContain("setting-specific instruction");
          expect(context.prompt).toContain("builtin:scene-writing");
          const statuses = await context.tool("external.status", {});
          expect(statuses).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                state: "pending",
                job_id: "job_fixture",
              }),
              expect.objectContaining({ state: "external_state_unknown" }),
            ]),
          );
          expect(await context.tool(ledgerTool, publish)).toMatchObject({
            job_id: "job_fixture",
          });
          expect(await context.tool(ledgerTool, loseConnection)).toMatchObject({
            state: "external_state_unknown",
          });
          expect(
            await context.tool("external.status", { operationId: known[0] }),
          ).toMatchObject({
            state: "completed",
            result: { status: "completed" },
          });
          await expect(
            context.tool(ledgerTool, { tool: "delete", arguments: {} }),
          ).rejects.toThrow("EXTERNAL_TOOL_FORBIDDEN");
        },
      },
    },
  });
  try {
    await new Promise<void>((resolve) =>
      listener.listen(0, "127.0.0.1", resolve),
    );
    const address = listener.address();
    if (!address || typeof address === "string")
      throw new Error("Fixture port unavailable");
    const profile = {
      id: "fixture",
      label: "Fixture tools",
      endpoint: "http://127.0.0.1:" + address.port + "/mcp",
      jobStatusTool: "status",
      tools: [
        { name: "publish", effect: "write" as const },
        { name: "status", effect: "read" as const },
      ],
    };
    const skillDirectory = join(f.root, "skills", "setting");
    const userSkill = join(f.app, "skills", "setting");
    for (const path of [skillDirectory, userSkill]) {
      await mkdir(path, { recursive: true });
      await writeFile(
        join(path, "skill.yaml"),
        "id: setting\nversion: '1.0.0'\nentrypoint: SKILL.md\n",
      );
      await writeFile(join(path, "SKILL.md"), "setting-specific instruction");
    }
    await commitFixture(f.root);
    const registered = await registerLocal(f.app, f.root);
    const run = await firstApp.start(registered.id, {
      goal: "Recover the first chapter",
    });
    expect(
      (await listSkills(f.app, await firstApp.project(run.runId))).map(
        (skill) => skill.key,
      ),
    ).toEqual(
      expect.arrayContaining([
        "builtin:project-resume",
        "builtin:design-document",
        "builtin:scene-writing",
        "builtin:change-impact",
        "builtin:consistency-review",
        "project:setting",
        "user:setting",
      ]),
    );
    await firstApp.saveDraft(
      run.runId,
      "resume-notes.json",
      JSON.stringify({
        decisions: ["Confirm border names"],
        openQuestions: ["First chapter?"],
        nextActions: ["Draft the opening"],
      }),
      null,
    );
    await new ExternalProfiles(f.app).save(profile);
    const started = await first.start(
      run.runId,
      {
        requestId: randomUUID(),
        provider: "codex",
        prompt: "Plan the scene",
        externalProfileId: profile.id,
        skillKeys: ["builtin:scene-writing", "user:setting"],
      },
      endpoint,
    );
    let previousApproval: string | undefined;
    for (let step = 0; step < 2; step++) {
      const request = await pending(first, started.id, previousApproval);
      previousApproval = request.pending!.id;
      expect(request.pending?.kind).toBe("approval");
      expect(known.length + unknown.length).toBe(step);
      await first.respond(started.id, request.pending!.id, { allow: true });
    }
    await first.wait(started.id);
    const finished = await first.get(started.id);
    expect(finished.state, finished.diagnostic).toBe("completed");
    const original = await firstApp.project(run.runId);
    const task = rawObject<Task>(
      original.files,
      `tasks/${run.taskId}/task.yaml`,
    );
    expect(task.skills).toHaveLength(2);
    const originalRun = (await firstApp.run(run.runId)).run;
    const fresh = await registerLocal(recoveredApp, f.root);
    const restoredTasks = new TaskService(recoveredApp);
    const resumed = await restoredTasks.resume(
      fresh.id,
      run.taskId,
      "refs/heads/" + originalRun.branch,
      originalRun.headCommit!,
    );
    const reconstructed = await resumeContext(restoredTasks, resumed.runId);
    expect(reconstructed).toMatchObject({
      goal: "Recover the first chapter",
      decisions: ["Confirm border names"],
      openQuestions: ["First chapter?"],
      nextActions: ["Draft the opening"],
      previous: { provider: "codex", result: sendResult },
    });
    expect(JSON.stringify(reconstructed)).not.toContain(
      "transient-provider-session",
    );
    const snapshot = await restoredTasks.project(resumed.runId);
    const checkpoint = rawObject<Checkpoint>(
      snapshot.files,
      `tasks/${run.taskId}/checkpoints/${reconstructed.checkpointId}.yaml`,
    );
    expect(checkpoint.external_operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: "pending", job_id: "job_fixture" }),
        expect.objectContaining({ state: "external_state_unknown" }),
      ]),
    );
    expect(await new ExternalProfiles(recoveredApp).list()).toEqual([]);
    await new ExternalProfiles(recoveredApp).save(profile);
    const switched = await second.start(
      resumed.runId,
      {
        requestId: randomUUID(),
        provider: "claude",
        prompt: "Continue",
        externalProfileId: profile.id,
      },
      endpoint,
    );
    await second.wait(switched.id);
    const result = await second.get(switched.id);
    expect(result.state, result.diagnostic).toBe("completed");
    const updated = await resumeContext(restoredTasks, resumed.runId);
    expect(updated.external).toContainEqual(
      expect.objectContaining({ state: "completed", job_id: "job_fixture" }),
    );
    expect(known).toHaveLength(1);
    expect(unknown).toHaveLength(1);
    expect(known[0]).toMatch(/^[a-f0-9-]{36}$/);
    expect(
      await readFile(join(f.root, "skills", "setting", "SKILL.md"), "utf8"),
    ).toBe("setting-specific instruction");
  } finally {
    await first.close();
    await second.close();
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    await removeIndexFixture(f);
  }
}, 120_000);
