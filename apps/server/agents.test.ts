import { afterEach, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createWebApp } from "./app.js";
import {
  indexFixture,
  commitFixture,
  removeIndexFixture,
  type IndexFixture,
} from "../../packages/indexer/src/test-helpers.js";
import { registerLocal } from "../../packages/tasks/src/projects.js";
import { SUMMARY_HEADER } from "../../packages/tasks/src/review-diff.js";
import { importDocuments } from "../../packages/tasks/src/import.js";
import { TaskService } from "../../packages/tasks/src/service.js";
import { ManualService } from "../../packages/tasks/src/manual.js";
import { hash } from "../../packages/project-fs/src/files.js";
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

function largePng(): Buffer {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=", "base64");
  // A private ancillary chunk keeps the image valid while putting its bytes over the diff limit.
  const payload = randomBytes(1100000);
  const chunk = Buffer.concat([Buffer.from("crFt"), payload]);
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  checksum.writeUInt32BE(crc32(chunk));
  return Buffer.concat([png.subarray(0, 33), length, chunk, checksum, png.subarray(33)]);
}

describe("internal MCP and browser agent boundary", () => {
  it("binds client calls, preserves a typed character with its references and image, and revokes credentials on cancellation", async () => {
    const fixture = await indexFixture();
    fixtures.push(fixture);
    const sourcePath = "illustrations/portrait.PNG";
    const png = largePng();
    const digest = hash(png);
    const imagePath = `assets/craft/${digest}.png`;
    await mkdir(join(fixture.root, "illustrations"));
    await writeFile(join(fixture.root, sourcePath), png);
    await commitFixture(fixture.root);
    const source = await registerLocal(fixture.app, fixture.root);
    const imported = await importDocuments(fixture.app, source.id, ["README.md"], "Novel fixture", true);
    const registration = await registerLocal(fixture.app, imported.path);
    const tasks = new TaskService(fixture.app);
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
        "game.context",
        "knowledge.search",
        "narrative.context",
        "project.validate",
        "references.reverse",
        "state.compare",
        "state.evaluate",
        "task.checkpoint",
      ]);
      const evaluated = await client.callTool({ name: 'state.evaluate', arguments: { query: { worldTick: 0 } } });
      expect(evaluated.isError).not.toBe(true);
      expect(JSON.parse((evaluated.content as { text: string }[])[0]!.text).data).toMatchObject({ point: { worldTick: 0 }, cells: [], inputDigest: expect.any(String) });
      const invalid = await client.callTool({
        name: "context.build",
        arguments: { root: fixture.root },
      });
      expect(invalid.isError).toBe(true);
      const omitted = await app.inject({
        method: "POST",
        url,
        headers: bearer,
        payload: {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "context.build" },
        },
      });
      expect(omitted.json().result.isError).not.toBe(true);
      expect(
        JSON.parse(omitted.json().result.content[0].text).context.scope.runId,
      ).toBe(run.runId);
      const empty = await app.inject({
        method: "POST",
        url,
        headers: bearer,
        payload: {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "context.build", arguments: null },
        },
      });
      expect(empty.json().result.isError).not.toBe(true);
      const malformed = await app.inject({
        method: "POST",
        url,
        headers: bearer,
        payload: {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "context.build", arguments: [] },
        },
      });
      expect(malformed.json().result.isError).toBe(true);
      const built = await client.callTool({
        name: "context.build",
        arguments: {},
      });
      const activity = (await app.inject({ url: `/api/agent-executions/${record.id}`, headers })).json<AgentExecution>().events;
      const builds = activity.filter(event => event.tool === "context.build");
      expect(builds.filter(event => event.type === "tool.started")).toHaveLength(4);
      expect(builds.filter(event => event.type === "tool.completed").map(event => event.code ?? null)).toEqual([
        "REQUEST_INVALID", null, null, null,
      ]);
      const read = JSON.parse(
        (built.content as { text: string }[])[0]!.text,
      ) as { workingFingerprint: string };
      const args = {
        requestId: randomUUID(),
        expectedSnapshot: read.workingFingerprint,
        kind: "narrative.character",
        title: "HTTP draft",
        body: "한국어 MCP 초안",
        extensions: { narrative: { profile: { role: "Protagonist" }, initial_state: { world_tick: 0, values: {} } } },
        references: [{
          reference_id: "ref_overview",
          relation: "related_to",
          propagation: "none",
          update_policy: "pinned",
          target: { entity_id: "ent_overview", revision_id: "rev_overview_a" },
        }],
        images: [{ sourcePath, alt: "Portrait" }],
      };
      const missingMetadata = await client.callTool({
        name: "changes.propose",
        arguments: { ...args, extensions: {} },
      });
      expect(missingMetadata.isError).toBe(true);
      expect(JSON.stringify(missingMetadata.content)).toContain("EXTENSION_DATA_REQUIRED");
      const outside = await client.callTool({
        name: "changes.propose",
        arguments: { ...args, images: [...args.images, { sourcePath: "../outside.png", alt: "Outside" }] },
      });
      expect(outside.isError).toBe(true);
      expect((await tasks.project(run.runId)).files.has(imagePath)).toBe(false);
      const proposed = await client.callTool({
        name: "changes.propose",
        arguments: args,
      });
      expect(proposed.isError).not.toBe(true);
      const savedProposal: unknown = JSON.parse((proposed.content as { text: string }[])[0]!.text);
      expect(savedProposal).toMatchObject({ imagePaths: [imagePath] });
      const replayed = await client.callTool({
        name: "changes.propose",
        arguments: args,
      });
      expect(
        JSON.parse((replayed.content as { text: string }[])[0]!.text),
      ).toEqual(savedProposal);
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
      const snapshot = await tasks.project(run.runId);
      const characters = [...snapshot.entities.values()].filter(entity => entity.value.kind === "narrative.character");
      expect(characters).toHaveLength(1);
      expect(characters[0]?.revisions.values().next().value?.meta).toMatchObject({
        title: args.title,
        status: "draft",
        extensions: args.extensions,
        references: args.references,
      });
      expect(snapshot.files.get(imagePath)?.digest).toBe(digest);
      expect(snapshot.files.get(`tasks/${run.taskId}/working/ui-draft.md`)?.text)
        .toContain(`![Portrait](${imagePath})`);
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
      const review = await app.inject({
        method: "POST", url: `/api/runs/${run.runId}/integrations`, headers,
        payload: { requestId: randomUUID(), proposalIds: inspection.proposals.map(proposal => proposal.id) },
      });
      expect(review.statusCode, review.body.slice(0, 200)).toBe(200);
      const prepared = review.json<{ id: string; token: string; diff: string }>();
      expect(prepared.diff).toContain(`Binary files /dev/null and b/${imagePath} differ`);
      // Checkpoint input manifests grow with the project; they are listed by object, not in full.
      const summary = prepared.diff.slice(prepared.diff.indexOf(SUMMARY_HEADER + "\n")).split("\n").filter(Boolean);
      expect(summary[0]).toBe(SUMMARY_HEADER);
      expect(summary.length).toBeGreaterThan(1);
      for (const line of summary.slice(1)) expect(line).toMatch(/^A 100644 [a-f0-9]{40} \d+ tasks\/[^/]+\/checkpoints\/[^/]+-inputs\.yaml$/);
      expect(prepared.diff).not.toContain("semantic_digest");
      expect((await app.inject({
        method: "POST", url: `/api/integrations/${prepared.id}/apply`, headers,
        payload: { token: prepared.token },
      })).statusCode).toBe(200);
      const image = await app.inject({ url: `/api/projects/${registration.id}/images/${digest}`, headers });
      expect(image.statusCode).toBe(200);
      expect(hash(Buffer.from(image.json<{ base64: string }>().base64, "base64"))).toBe(digest);
      expect(hash(await readFile(join(fixture.root, sourcePath)))).toBe(digest);
    } finally {
      await client.close();
    }
  }, 120000);
});
