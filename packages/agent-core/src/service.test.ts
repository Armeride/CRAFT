import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  indexFixture,
  removeIndexFixture,
  type IndexFixture,
} from "../../indexer/src/test-helpers.js";
import { registerLocal } from "../../tasks/src/projects.js";
import { TaskService } from "../../tasks/src/service.js";
import { ManualService } from "../../tasks/src/manual.js";
import { repositoryGuard } from "../../git-workspace/src/worktree.js";
import { AgentService } from "./service.js";
import { FakeAdapter } from "./fake.js";
import { AgentError } from "./contracts.js";
import type { AgentAdapter, AgentExecution } from "./contracts.js";
import { pause } from "./process.js";

const fixtures: IndexFixture[] = [];
const services: AgentService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  for (const fixture of fixtures.splice(0)) await removeIndexFixture(fixture);
});

async function setup(adapter: AgentAdapter = new FakeAdapter()) {
  const fixture = await indexFixture();
  fixtures.push(fixture);
  const registration = await registerLocal(fixture.app, fixture.root);
  const tasks = new TaskService(fixture.app);
  const run = await tasks.start(registration.id, { goal: "Agent acceptance" });
  await tasks.saveDraft(
    run.runId,
    "ui-draft.md",
    "Preserved original draft",
    null,
  );
  const service = new AgentService(fixture.app, {
    adapters: { fake: adapter },
  });
  services.push(service);
  await service.initialize();
  return { ...fixture, registration, tasks, run, service };
}

async function until(
  service: AgentService,
  id: string,
  condition: (record: AgentExecution) => boolean,
): Promise<AgentExecution> {
  for (let n = 0; n < 200; n++) {
    const record = await service.get(id);
    if (condition(record)) return record;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw Error("Expected execution state did not arrive");
}

describe("bound agent execution and preservation", () => {
  it("streams a managed proposal once, preserves exact context receipts and leaves the target untouched", async () => {
    const f = await setup(),
      before = await repositoryGuard(f.root),
      input = {
        requestId: randomUUID(),
        provider: "fake" as const,
        prompt: "새 원문을 작성한다.",
      };
    const started = await f.service.start(
      f.run.runId,
      input,
      "http://127.0.0.1:4173",
    );
    await f.service.wait(started.id);
    const record = await f.service.get(started.id);
    expect(record.state, record.code).toBe("completed");
    expect(record.checkpointId).toBeTruthy();
    expect(record.message).toContain("Local fixture");
    const current = await f.tasks.project(f.run.runId);
    const inspection = await new ManualService(f.app).inspect(f.run.runId);
    expect(inspection.proposals).toHaveLength(1);
    const created = inspection.proposals[0]!.changes.find(
      (change) => change.action === "add_revision",
    )!;
    const revision = current.entities
      .get(created.entity_id)!
      .revisions.get(created.revision_id)!;
    expect(revision.meta.created_by.type).toBe("agent");
    expect(revision.meta.status).toBe("draft");
    expect(
      current.baselines.get("baseline_main")!.value.selected[created.entity_id],
    ).toBeUndefined();
    expect(revision.body).toContain(input.prompt);
    expect(
      current.files.get(
        `tasks/${f.run.taskId}/working/agent-context-${record.id}.json`,
      )!.text,
    ).toContain("snapshotToken");
    expect(
      (await f.service.start(f.run.runId, input, "http://127.0.0.1:4173")).id,
    ).toBe(record.id);
    await expect(
      f.service.start(
        f.run.runId,
        { ...input, prompt: "different" },
        "http://127.0.0.1:4173",
      ),
    ).rejects.toThrow("REQUEST_ID_REUSED");
    expect(await repositoryGuard(f.root)).toEqual(before);
  }, 120000);

  it("waits for scoped answers, expires them after use, and preserves pending input on cancellation", async () => {
    const f = await setup(new FakeAdapter({ ask: true })),
      started = await f.service.start(
        f.run.runId,
        {
          requestId: randomUUID(),
          provider: "fake",
          prompt: "Question acceptance",
        },
        "http://127.0.0.1:4173",
      );
    const asked = await until(
      f.service,
      started.id,
      (record) => record.state === "waiting_for_input",
    );
    await expect(
      f.service.respond(started.id, randomUUID(), { allow: true }),
    ).rejects.toThrow("AGENT_INPUT_EXPIRED");
    await f.service.respond(started.id, asked.pending!.id, {
      allow: true,
      answers: { focus: ["Rules"] },
    });
    const approval = await until(
      f.service,
      started.id,
      (record) => record.pending?.kind === "approval",
    );
    await expect(f.tasks.assertExecutionIdle(f.run.runId)).rejects.toThrow(
      /WORKTREE_BUSY/,
    );
    await f.service.cancel(started.id);
    await f.service.wait(started.id);
    const result = await f.service.get(started.id);
    expect(result.state, result.code).toBe("cancelled");
    expect(result.pending).toBeNull();
    expect(result.checkpointId).toBeTruthy();
    await expect(
      f.service.respond(started.id, approval.pending!.id, { allow: true }),
    ).rejects.toThrow("AGENT_INPUT_EXPIRED");
    expect(
      (await f.tasks.project(f.run.runId)).files.get(
        `tasks/${f.run.taskId}/working/ui-draft.md`,
      )!.text,
    ).toBe("Preserved original draft");
    const snapshot = await f.tasks.project(f.run.runId);
    expect(
      snapshot.files.get(
        `tasks/${f.run.taskId}/working/agent-result-${result.id}.json`,
      )!.text,
    ).toContain("Fixture draft creation");
    await expect(
      f.service.start(
        f.run.runId,
        { requestId: randomUUID(), provider: "fake", prompt: "Retry" },
        "http://127.0.0.1:4173",
      ),
    ).rejects.toThrow("AGENT_NEW_RUN_REQUIRED");
    // A restart sees a persisted stale request but never grants it again.
    await writeFile(
      join(f.app, "agents", result.id, "execution.json"),
      JSON.stringify({
        ...result,
        state: "waiting_for_input",
        pending: approval.pending,
      }),
    );
    const restarted = new AgentService(f.app);
    services.push(restarted);
    await restarted.initialize();
    expect(await restarted.get(result.id)).toMatchObject({
      state: "interrupted",
      pending: null,
      code: "AGENT_INTERRUPTED",
    });
    await expect(
      restarted.respond(result.id, approval.pending!.id, { allow: true }),
    ).rejects.toThrow("AGENT_INPUT_EXPIRED");
  }, 120000);

  it("keeps unconfirmed termination distinct from cancellation and blocks cleanup and integration", async () => {
    const f = await setup({
      async execute(context) {
        try {
          await pause(60000, context.signal);
        } catch {
          throw new AgentError("AGENT_TERMINATION_UNCONFIRMED");
        }
      },
    });
    const record = await f.service.start(
      f.run.runId,
      {
        requestId: randomUUID(),
        provider: "fake",
        prompt: "Termination fixture",
      },
      "http://127.0.0.1:4173",
    );
    await f.service.cancel(record.id);
    await f.service.wait(record.id);
    expect(await f.service.get(record.id)).toMatchObject({
      state: "failed",
      code: "AGENT_TERMINATION_UNCONFIRMED",
    });
    await expect(f.tasks.cleanup(f.run.runId)).rejects.toThrow(
      "AGENT_TERMINATION_UNCONFIRMED",
    );
    await expect(f.tasks.project(f.run.runId)).rejects.toThrow(
      "AGENT_TERMINATION_UNCONFIRMED",
    );
  }, 120000);

  it("rejects unmanaged successful output, quarantines the workspace and preserves every offending byte", async () => {
    const f = await setup({
      async execute(context) {
        await writeFile(join(context.cwd, "outside.txt"), "unmanaged output");
      },
    });
    const before = await repositoryGuard(f.root),
      record = await f.service.start(
        f.run.runId,
        {
          requestId: randomUUID(),
          provider: "fake",
          prompt: "Invalid exit zero",
        },
        "http://127.0.0.1:4173",
      );
    await f.service.wait(record.id);
    const failed = await f.service.get(record.id);
    expect(failed.state).toBe("failed");
    expect(failed.code).toBe("AGENT_RESULT_INVALID");
    expect(await readFile(join(f.run.path, "outside.txt"), "utf8")).toBe(
      "unmanaged output",
    );
    await expect(f.tasks.project(f.run.runId)).rejects.toThrow(
      /AGENT_RESULT_INVALID/,
    );
    expect(await repositoryGuard(f.root)).toEqual(before);
  }, 120000);

  it("keeps two worktrees isolated and rejects foreign or revoked MCP credentials", async () => {
    const contexts: { token: string; id: string }[] = [];
    const adapter: AgentAdapter = {
      async execute(context) {
        contexts.push({
          token: context.mcp.token,
          id: context.mcp.url.split("/").at(-1)!,
        });
        await pause(10000, context.signal);
      },
    };
    const f = await setup(adapter),
      second = await f.tasks.start(f.registration.id, {
        goal: "Second isolated task",
      });
    const a = await f.service.start(
      f.run.runId,
      { requestId: randomUUID(), provider: "fake", prompt: "A" },
      "http://127.0.0.1:4173",
    );
    const b = await f.service.start(
      second.runId,
      { requestId: randomUUID(), provider: "fake", prompt: "B" },
      "http://127.0.0.1:4173",
    );
    const first = contexts.find((context) => context.id === a.id)!,
      other = contexts.find((context) => context.id === b.id)!;
    expect(() =>
      f.service.authenticated(b.id, "Bearer " + first.token),
    ).toThrow("CONTEXT_FORBIDDEN");
    expect(() =>
      f.service.authenticated(a.id, "Bearer " + "한".repeat(64)),
    ).toThrow("CONTEXT_FORBIDDEN");
    const knowledge = f.service.authenticated(a.id, "Bearer " + first.token);
    await expect(
      knowledge.call("entity.get", {
        entityId: "ent_overview",
        revisionId: "rev_overview_a",
        root: f.root,
      }),
    ).rejects.toThrow(/REQUEST_INVALID/);
    const read = (await knowledge.call("entity.get", {
      entityId: "ent_overview",
      revisionId: "rev_overview_a",
      view: "basis",
    })) as { scope: { runId: string; view: string } };
    expect(read.scope).toMatchObject({ runId: f.run.runId, view: "basis" });
    expect(other.token).not.toBe(first.token);
    await f.service.cancel(a.id);
    await f.service.cancel(b.id);
    await Promise.all([f.service.wait(a.id), f.service.wait(b.id)]);
    expect(() =>
      f.service.authenticated(a.id, "Bearer " + first.token),
    ).toThrow("CONTEXT_FORBIDDEN");
  }, 120000);
});
