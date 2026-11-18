import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createWebApp } from "./app.js";
import {
  indexFixture,
  removeIndexFixture,
  type IndexFixture,
} from "../../packages/indexer/src/test-helpers.js";
import { registerLocal } from "../../packages/tasks/src/projects.js";
import { TaskService } from "../../packages/tasks/src/service.js";
import { ManualService } from "../../packages/tasks/src/manual.js";
import type {
  AgentExecution,
  AdapterContext,
} from "../../packages/agent-core/src/contracts.js";
import { pause } from "../../packages/agent-core/src/process.js";

const fixtures: IndexFixture[] = [],
  apps: Awaited<ReturnType<typeof createWebApp>>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const fixture of fixtures.splice(0)) await removeIndexFixture(fixture);
});

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe("internal MCP and browser agent boundary", () => {
  it("negotiates with the standard client, binds every call, replays a proposal and revokes credentials on cancellation", async () => {
    const fixture = await indexFixture();
    fixtures.push(fixture);
    const registration = await registerLocal(fixture.app, fixture.root),
      tasks = new TaskService(fixture.app);
    const run = await tasks.start(registration.id, {
      goal: "HTTP MCP acceptance",
    });
    let context!: AdapterContext;
    const port = await freePort(),
      app = await createWebApp({
        appData: fixture.app,
        port,
        agentAdapters: {
          fake: {
            async execute(value) {
              context = value;
              await pause(60000, value.signal);
            },
          },
        },
      });
    apps.push(app);
    await app.listen({ port, host: "127.0.0.1" });
    const headers: Record<string, string> = { host: "127.0.0.1:" + port };
    const session = await app.inject({ url: "/api/session", headers });
    headers["cookie"] =
      session.cookies[0]!.name + "=" + session.cookies[0]!.value;
    headers["x-craft-csrf"] = session.json().csrf;
    const identity = randomUUID(),
      input = { provider: "fake", prompt: "HTTP MCP fixture" };
    const started = await app.inject({
      method: "POST",
      url: `/api/runs/${run.runId}/agents`,
      headers: { ...headers, "x-craft-request-id": identity },
      payload: input,
    });
    expect(started.statusCode, started.body).toBe(200);
    const record = started.json<AgentExecution>();
    const replay = await app.inject({
      method: "POST",
      url: `/api/runs/${run.runId}/agents`,
      headers: { ...headers, "x-craft-request-id": identity },
      payload: input,
    });
    expect(replay.json().id).toBe(record.id);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/runs/${run.runId}/preserve`,
          headers,
          payload: { action: "checkpoint" },
        })
      ).json().code,
    ).toBe("WORKTREE_BUSY");
    const url = `/mcp/${record.id}`,
      payload = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    expect(
      (await app.inject({ method: "POST", url, headers, payload })).statusCode,
    ).toBe(403);
    const bearer = {
      host: headers["host"]!,
      authorization: "Bearer " + context.mcp.token,
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { ...bearer, origin: "https://external.invalid" },
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/mcp/agent_" + randomUUID(),
          headers: bearer,
          payload,
        })
      ).statusCode,
    ).toBe(403);
    const client = new Client({ name: "CRAFT acceptance", version: "1" });
    const transport = new StreamableHTTPClientTransport(
      new URL(context.mcp.url),
      { requestInit: { headers: { Authorization: bearer.authorization } } },
    );
    try {
      await client.connect(transport);
      expect(
        (await client.listTools()).tools.map((tool) => tool.name).sort(),
      ).toEqual([
        "changes.propose",
        "context.build",
        "entity.get",
        "knowledge.search",
        "project.validate",
        "references.reverse",
        "task.checkpoint",
      ]);
      const invalid = await client.callTool({
        name: "context.build",
        arguments: { root: fixture.root },
      });
      expect(invalid.isError).toBe(true);
      const built = await client.callTool({
        name: "context.build",
        arguments: {},
      });
      const read = JSON.parse(
        (built.content as { text: string }[])[0]!.text,
      ) as { workingFingerprint: string };
      const args = {
        requestId: randomUUID(),
        expectedSnapshot: read.workingFingerprint,
        title: "HTTP draft",
        body: "한국어 MCP 초안",
      };
      const proposed = await client.callTool({
        name: "changes.propose",
        arguments: args,
      });
      expect(proposed.isError).not.toBe(true);
      const replayed = await client.callTool({
        name: "changes.propose",
        arguments: args,
      });
      expect(
        JSON.parse((replayed.content as { text: string }[])[0]!.text),
      ).toEqual(JSON.parse((proposed.content as { text: string }[])[0]!.text));
      const basis = await client.callTool({
        name: "entity.get",
        arguments: {
          entityId: "ent_overview",
          revisionId: "rev_overview_a",
          view: "basis",
        },
      });
      expect(
        JSON.parse((basis.content as { text: string }[])[0]!.text).scope,
      ).toMatchObject({
        runId: run.runId,
        view: "basis",
        basisCommit: run.basisCommit,
      });
      const inspection = await new ManualService(fixture.app).inspect(
        run.runId,
      );
      expect(inspection.proposals).toHaveLength(1);
      expect(inspection.reviews).toHaveLength(1); // Existing fixture review only.
      await app.inject({
        method: "POST",
        url: `/api/agent-executions/${record.id}/cancel`,
        headers,
        payload: {},
      });
      for (let n = 0; n < 150; n++) {
        const current = await app.inject({
          url: `/api/agent-executions/${record.id}`,
          headers,
        });
        if (current.json().state === "cancelled") break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(
        (await app.inject({ method: "POST", url, headers: bearer, payload }))
          .statusCode,
      ).toBe(403);
      const fork = await app.inject({
        method: "POST",
        url: `/api/agent-executions/${record.id}/fork`,
        headers: { ...headers, "x-craft-request-id": randomUUID() },
        payload: {},
      });
      expect(fork.statusCode, fork.body).toBe(200);
      expect(fork.json().runId).not.toBe(run.runId);
    } finally {
      await client.close();
    }
  }, 120000);
});
