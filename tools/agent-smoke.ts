/** Explicit, short real-provider acceptance against a disposable local project. */
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { createWebApp } from "../apps/server/app.js";
import { indexFixture } from "../packages/indexer/src/test-helpers.js";
import { registerLocal } from "../packages/tasks/src/projects.js";
import { TaskService } from "../packages/tasks/src/service.js";
import { ManualService } from "../packages/tasks/src/manual.js";
import { repositoryGuard } from "../packages/git-workspace/src/worktree.js";
import type { AgentExecution } from "../packages/agent-core/src/contracts.js";

const args = process.argv.slice(2),
  provider = args[args.indexOf("--provider") + 1];
if (
  !args.includes("--confirm-model-use") ||
  !["codex", "claude"].includes(provider ?? "")
)
  throw new Error(
    "Usage: agent-smoke --provider codex|claude --confirm-model-use [--model NAME]. This calls a real model using the installed runner’s account.",
  );
const modelIndex = args.indexOf("--model"),
  model = modelIndex < 0 ? undefined : args[modelIndex + 1];
const fixture = await indexFixture(),
  registration = await registerLocal(fixture.app, fixture.root);
const tasks = new TaskService(fixture.app),
  run = await tasks.start(registration.id, {
    goal: "Explicit real-provider smoke: " + provider,
  });
const before = await repositoryGuard(fixture.root);
const listener = createServer();
await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = (listener.address() as { port: number }).port;
await new Promise<void>((resolve) => listener.close(() => resolve()));
const app = await createWebApp({ appData: fixture.app, port });
let executionId = "";
try {
  await app.listen({ port, host: "127.0.0.1" });
  const headers: Record<string, string> = { host: "127.0.0.1:" + port };
  const session = await app.inject({ url: "/api/session", headers });
  headers["cookie"] =
    session.cookies[0]!.name + "=" + session.cookies[0]!.value;
  headers["x-craft-csrf"] = session.json().csrf;
  const marker = "CRAFT smoke " + randomUUID();
  const response = await app.inject({
    method: "POST",
    url: `/api/runs/${run.runId}/agents`,
    headers,
    payload: {
      requestId: randomUUID(),
      provider,
      ...(model ? { model } : {}),
      prompt: `Short integration test. Use only the craft MCP tools. Call context.build, then changes.propose once with a new UUID, its current workingFingerprint, title "Smoke draft", and body exactly "${marker}". Then call project.validate and finish with one short sentence. Do not use shell, native file editing, network services, skills or additional agents. Do not select or approve the draft.`,
    },
  });
  if (response.statusCode !== 200)
    throw new Error("Start failed: " + response.json().code);
  executionId = response.json<AgentExecution>().id;
  const deadline = Date.now() + 120000;
  let result: AgentExecution;
  for (;;) {
    result = (
      await app.inject({ url: `/api/agent-executions/${executionId}`, headers })
    ).json<AgentExecution>();
    if (
      ["completed", "failed", "cancelled", "interrupted"].includes(result.state)
    )
      break;
    if (result.pending) {
      await app.inject({
        method: "POST",
        url: `/api/agent-executions/${executionId}/respond`,
        headers,
        payload: { requestId: result.pending.id, answer: { allow: false } },
      });
    }
    if (Date.now() > deadline) {
      await app.inject({
        method: "POST",
        url: `/api/agent-executions/${executionId}/cancel`,
        headers,
        payload: {},
      });
      throw new Error(
        "Smoke timeout; cancellation requested and workspace retained",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (result.state !== "completed")
    throw new Error("Provider result: " + result.state + " / " + result.code);
  const inspection = await new ManualService(fixture.app).inspect(run.runId),
    snapshot = await tasks.project(run.runId);
  const changes = inspection.proposals.flatMap((proposal) => proposal.changes);
  const added = changes.filter((change) => change.action === "add_revision");
  if (added.length !== 1 || changes.length !== 1)
    throw new Error("Expected exactly one unselected draft proposal");
  const change = added[0]!,
    revision = snapshot.entities
      .get(change.entity_id)!
      .revisions.get(change.revision_id)!;
  if (
    revision.body !== marker ||
    revision.meta.status !== "draft" ||
    revision.meta.created_by.type !== "agent" ||
    snapshot.baselines.get("baseline_main")!.value.selected[change.entity_id]
  )
    throw new Error("Draft contract failed");
  if (
    JSON.stringify(await repositoryGuard(fixture.root)) !==
    JSON.stringify(before)
  )
    throw new Error("Original project changed");
  console.log(
    JSON.stringify({
      provider,
      version: result.installationVersion,
      state: result.state,
      checkpoint: result.checkpointId,
      proposalCount: added.length,
      sourceUnchanged: true,
      modelCall: true,
      workspace: fixture.home,
    }),
  );
} finally {
  await app.close(); // cancels an unfinished execution and preserves its worktree
  console.log(JSON.stringify({ retainedWorkspace: fixture.home, executionId }));
}
