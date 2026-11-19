import { expect, it } from "vitest";
import { indexFixture, removeIndexFixture } from "./test-helpers.js";
import { ProjectIndex } from "./service.js";
import { registerLocal } from "../../tasks/src/projects.js";
import { repositoryGuard } from "../../git-workspace/src/worktree.js";

it("compares independent state inputs on one indexed snapshot and rebuilds deterministically", async () => {
  const f = await indexFixture("state-model");
  const registration = await registerLocal(f.app, f.root);
  const index = await ProjectIndex.registered(f.app, registration.id);
  const options = { scopeToken: index.scopeToken };
  try {
    const source = await repositoryGuard(f.root);
    const scenario = {
      entity_id: "ent_gate_scenario",
      revision_id: "rev_gate_scenario",
    };
    const inputs = {
      before: { scenario, actor: "player", occurrenceIds: ["enter_player"] },
      after: { scenario, actor: "npc", occurrenceIds: ["enter_npc"] },
    };
    type Result = {
      before: { inputDigest: string };
      after: { inputDigest: string };
      changes: {
        field: string;
        before: { value: unknown };
        after: { value: unknown };
      }[];
    };
    const first = await index.query<Result>("state-compare", inputs, options);
    expect(first.data.before.inputDigest).not.toBe(
      first.data.after.inputDigest,
    );
    expect(first.data.changes).toContainEqual(
      expect.objectContaining({
        field: "open",
        before: expect.objectContaining({ value: true }),
        after: expect.objectContaining({ value: false }),
      }),
    );
    const changed = await index.query<Result>(
      "state-compare",
      {
        ...inputs,
        before: { ...inputs.before, actorOverrides: { player: { level: 9 } } },
      },
      options,
    );
    expect(changed.data.before.inputDigest).not.toBe(
      first.data.before.inputDigest,
    );
    expect(changed.data.changes.some((value) => value.field === "open")).toBe(
      false,
    );
    await index.rebuild(index.scopeToken, { full: true });
    const restored = await index.query<Result>(
      "state-compare",
      inputs,
      options,
    );
    expect(restored.data).toEqual(first.data);
    expect(await repositoryGuard(f.root)).toEqual(source);
  } finally {
    await index.close();
    await removeIndexFixture(f);
  }
}, 90_000);
