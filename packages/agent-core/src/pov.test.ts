import { randomUUID } from "node:crypto";
import { writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AgentService } from "./service.js";
import { detectAgent } from "./detect.js";
import { claudePermissionHandler } from "./claude.js";
import {
  indexFixture,
  removeIndexFixture,
  commitFixture,
} from "../../indexer/src/test-helpers.js";
import { loadProject } from "../../project-fs/src/project.js";
import { objectFile } from "../../project-fs/src/content.js";
import {
  dependencyManifestDigest,
  semanticDigest,
} from "../../project-fs/src/changes.js";
import { registerLocal } from "../../tasks/src/projects.js";
import type { ProviderId } from "./contracts.js";
import type { Perspective } from "../../domain/src/story-contracts.js";

it("binds a restricted Claude task to reviewed basis disclosures and denies raw filesystem and MCP reads", async () => {
  const f = await indexFixture("narrative");
  const endpoint = "http://127.0.0.1:4173";
  const secret = "UNPUBLISHED_PASSAGE_BODY";
  const perspective: Perspective = {
    kind: "reader",
    story: {
      sequenceId: "seq_main",
      sceneId: "ent_scene",
      boundary: "after",
      mode: "confirmed",
    },
  };
  const service = new AgentService(f.app, {
    detect: async (provider: ProviderId, cwd: string) => ({
      ...(await detectAgent("fake", cwd)),
      provider,
    }),
    adapters: {
      claude: {
        execute: async (context) => {
          expect(context.profile).toBe("pov");
          expect(context.cwd).not.toContain(f.root);
          expect(await readdir(context.cwd)).toEqual([]);
          expect(context.prompt).toContain("왕궁에 비밀 통로가 있다.");
          expect(context.prompt).not.toMatch(
            /UNPUBLISHED|ent_passage|entity_worktree_only/,
          );
          const canUse = claudePermissionHandler(context);
          const permission = {
            signal: context.signal,
            toolUseID: "read_1",
            requestId: "permission_1",
            suggestions: [],
          };
          expect(
            await canUse(
              "Read",
              { file_path: join(f.root, "project.yaml") },
              permission,
            ),
          ).toMatchObject({ behavior: "deny" });
          expect(
            await canUse("Bash", { command: "read" }, permission),
          ).toMatchObject({ behavior: "deny" });
          expect(await context.tool("context.build", {})).toMatchObject({
            context: { perspective: "reader" },
          });
          expect(
            await context.tool("knowledge.search", { text: secret }),
          ).toMatchObject({ data: { hits: [] } });
          await expect(
            context.tool("context.build", { view: "working" }),
          ).rejects.toThrow("CONTEXT_FORBIDDEN");
          await expect(
            context.tool("entity.get", {
              entityId: "ent_passage",
              revisionId: "rev_passage_a",
            }),
          ).rejects.toThrow("CONTEXT_FORBIDDEN");
          await expect(context.tool("project.validate", {})).rejects.toThrow(
            "REQUEST_INVALID",
          );
          await expect(context.tool("external.call", {})).rejects.toThrow(
            "REQUEST_INVALID",
          );
          await context.emit({
            type: "message.delta",
            text: "Safe writing response",
          });
        },
      },
    },
  });
  try {
    const original = await loadProject(f.root);
    for (const row of original.entities.values())
      for (const revision of row.revisions.values()) {
        await writeFile(
          join(f.root, revision.path),
          objectFile(revision.path, { ...revision.meta, status: "approved" })
            .text!,
        );
      }
    const fact = original.entities
      .get("ent_passage")!
      .revisions.get("rev_passage_a")!;
    await writeFile(join(f.root, fact.bodyPath), secret);
    const ready = await loadProject(f.root);
    const reveal = ready.entities
      .get("ent_reveal")!
      .revisions.get("rev_reveal_a")!;
    const review = objectFile("reviews/review_pov_reveal.yaml", {
      id: "review_pov_reveal",
      subject: { entity_id: "ent_reveal", revision_id: "rev_reveal_a" },
      semantic_model_version: 1,
      subject_semantic_digest: semanticDigest(
        ready,
        "ent_reveal",
        "rev_reveal_a",
      ),
      dependency_manifest_digest: dependencyManifestDigest(
        ready,
        "ent_reveal",
        "rev_reveal_a",
      ),
      scope: reveal.meta.scope,
      outcome: "accepted",
      reviewer: { id: "fixture", type: "user" },
      created_at: "2026-11-19T00:00:00Z",
    });
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(f.root, "reviews"), { recursive: true });
    await writeFile(join(f.root, review.path), review.text!);
    await commitFixture(f.root);
    const registered = await registerLocal(f.app, f.root);
    const run = await service.tasks.start(registered.id, { goal: "POV draft" });
    await service.tasks.saveDraft(
      run.runId,
      "ui-draft.md",
      "entity_worktree_only " + secret,
      null,
    );
    const start = {
      requestId: randomUUID(),
      prompt: "Write a description from the reader perspective.",
      perspective,
    };
    await expect(
      service.start(run.runId, { ...start, provider: "codex" }, endpoint),
    ).rejects.toThrow("POV_PROFILE_UNAVAILABLE");
    const executing = await service.start(
      run.runId,
      { ...start, provider: "claude" },
      endpoint,
    );
    await service.wait(executing.id);
    const result = await service.get(executing.id);
    expect(result.state, result.diagnostic).toBe("completed");
    expect(result.message).toBe("Safe writing response");
    expect(result.perspective).toEqual(perspective);
  } finally {
    await service.close();
    await removeIndexFixture(f);
  }
}, 100_000);
