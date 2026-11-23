import { expect, it } from "vitest";
import { loadProject, parseProject } from "../../project-fs/src/project.js";
import { objectFile, textFile } from "../../project-fs/src/content.js";
import {
  dependencyManifestDigest,
  semanticDigest,
} from "../../project-fs/src/changes.js";
import {
  analyzeProject,
  type BaselineAnalysis,
} from "../../domain/src/analysis.js";
import type {
  Baseline,
  JsonObject,
  Review,
} from "../../schema/src/generated.js";
import type {
  ProjectSnapshot,
  RevisionRecord,
  SourceFile,
} from "../../domain/src/model.js";
import { evaluateState } from "./evaluate.js";
import type { Scenario, Transition } from "./generated.js";
import type { StateResult } from "./evaluation-contracts.js";
import { statePayload } from "./model.js";

const baselineId = "baseline_main";
const record = (snapshot: ProjectSnapshot, id: string) =>
  snapshot.entities
    .get(id)!
    .revisions.get(snapshot.baselines.get(baselineId)!.value.selected[id]!)!;
const cell = (result: StateResult, instance: string, field: string) =>
  result.cells.find(
    (value) => value.instance === instance && value.field === field,
  );
const analysis = (snapshot: ProjectSnapshot) =>
  analyzeProject(snapshot, baselineId, {
    semantic: (entity, revision) => semanticDigest(snapshot, entity, revision),
    dependency: (entity, revision) =>
      dependencyManifestDigest(snapshot, entity, revision),
  });
function replaceMeta(
  files: Map<string, SourceFile>,
  prior: RevisionRecord,
  payload: unknown,
) {
  files.set(
    prior.path,
    objectFile(prior.path, {
      ...prior.meta,
      extensions: {
        ...prior.meta.extensions,
        state_model: payload as JsonObject,
      },
    }),
  );
}
function reviewed(snapshot: ProjectSnapshot) {
  const files = new Map(snapshot.files);
  for (const [id] of Object.entries(
    snapshot.baselines.get(baselineId)!.value.selected,
  )) {
    const row = record(snapshot, id);
    files.set(
      row.path,
      objectFile(row.path, { ...row.meta, status: "approved" }),
    );
  }
  const candidate = parseProject(files);
  for (const id of Object.keys(
    snapshot.baselines.get(baselineId)!.value.selected,
  )) {
    const row = record(candidate, id),
      rev = row.meta.revision_id;
    const review: Review = {
      id: "review_approved_" + id,
      subject: { entity_id: id, revision_id: rev },
      semantic_model_version: 1,
      subject_semantic_digest: semanticDigest(candidate, id, rev),
      dependency_manifest_digest: dependencyManifestDigest(candidate, id, rev),
      scope: {},
      outcome: "accepted",
      reviewer: { type: "user", id: "fixture" },
      created_at: "2026-11-19T00:00:00Z",
    };
    const path = "reviews/" + review.id + ".yaml";
    files.set(path, objectFile(path, review));
  }
  return parseProject(files);
}
function world(
  snapshot: ProjectSnapshot,
  tick: number,
  mode: "working" | "confirmed" = "confirmed",
  checked: BaselineAnalysis = analysis(snapshot),
) {
  return evaluateState(snapshot, {
    baselineId,
    scope: {},
    analysis: checked,
    point: { worldTick: tick },
    mode,
    target: "ent_border",
  });
}

it("replays only reviewed canonical occurrences for chapters 1 and 5 and pins the evidence", async () => {
  const snapshot = reviewed(await loadProject("fixtures/state-model"));
  const early = world(snapshot, 10),
    late = world(snapshot, 50);
  expect(cell(early, "entity:ent_border", "owner")).toMatchObject({
    value: { entity_id: "ent_faction_a" },
    certainty: "confirmed",
  });
  expect(cell(late, "entity:ent_border", "owner")).toMatchObject({
    value: { entity_id: "ent_faction_b" },
    certainty: "confirmed",
    evidence: { entity_id: "ent_treaty", revision_id: "rev_treaty" },
  });
  expect(cell(late, "entity:ent_border", "border")?.value).toEqual({
    corridor: "남쪽 강변",
  });
  expect(
    cell(world(snapshot, -1), "entity:ent_border", "owner")?.certainty,
  ).toBe("unknown");
  const files = new Map(snapshot.files);
  const treaty = record(snapshot, "ent_treaty_occurrence");
  replaceMeta(files, treaty, { ...statePayload(treaty), record_role: "plan" });
  const planned = parseProject(files);
  const result = world(planned, 50, "working");
  expect(cell(result, "entity:ent_border", "owner")?.value).toMatchObject({
    entity_id: "ent_faction_a",
  });
  expect(result.trace[0]).toMatchObject({ reason: "PLAN_NOT_OCCURRED" });
});

it("separates draft changes and rejects a stale evidence pin in confirmed contexts", async () => {
  const original = await loadProject("fixtures/state-model");
  expect(world(original, 50).trace[0]).toMatchObject({
    reason: "UNCONFIRMED_EVENT",
  });
  expect(
    cell(world(original, 50, "working"), "entity:ent_border", "owner"),
  ).toMatchObject({
    value: { entity_id: "ent_faction_b" },
    certainty: "provisional",
  });
  const snapshot = reviewed(original),
    files = new Map(snapshot.files);
  const selected = snapshot.baselines.get(baselineId)!;
  const copied: Baseline = {
    ...selected.value,
    selected: { ...selected.value.selected },
  };
  delete copied.selected["ent_treaty"];
  files.set(selected.path, objectFile(selected.path, copied));
  const changed = parseProject(files);
  const strict = world(changed, 50);
  expect(
    strict.issues.some((item) => item.code === "EVIDENCE_REVIEW_REQUIRED"),
  ).toBe(true);
  expect(cell(strict, "entity:ent_border", "owner")?.value).toMatchObject({
    entity_id: "ent_faction_a",
  });
});

function game(
  snapshot: ProjectSnapshot,
  scenario: Scenario,
  ids: string[] = scenario.occurrences.map((row) => row.id),
) {
  return evaluateState(snapshot, {
    baselineId,
    scope: {},
    analysis: analysis(snapshot),
    point: { worldTick: 10 },
    mode: "confirmed",
    scenario: {
      record: record(snapshot, "ent_gate_scenario"),
      scenario,
      occurrenceIds: ids,
    },
  });
}

it("evaluates player and NPC independently, distinguishes a missing event and unknown inputs, and never mutates the scenario", async () => {
  const snapshot = await loadProject("fixtures/state-model");
  const scenario = statePayload(
    record(snapshot, "ent_gate_scenario"),
  ) as Scenario;
  const player = game(snapshot, scenario, ["enter_player"]);
  const npc = game(snapshot, scenario, ["enter_npc"]);
  expect(player.trace[0]).toMatchObject({
    condition: "true",
    certainty: "hypothetical",
  });
  expect(npc.trace[0]).toMatchObject({ condition: "false" });
  expect(cell(player, "actor:door", "open")?.value).toBe(true);
  expect(cell(npc, "actor:door", "open")?.value).toBe(false);
  expect(game(snapshot, scenario, []).trace).toEqual([]);
  expect(game(snapshot, scenario, ["enter_player", "enter_player"]).trace).toEqual(player.trace);

  const newOccurrence = scenario.occurrences.find(({ id }) => id === "enter_npc");
  if (!newOccurrence) throw Error("expected an NPC occurrence");
  const withBoundaryNpcs: Scenario = {
    ...scenario,
    actors: {
      ...scenario.actors,
      npc_below: { prototype: "actor", values: { level: 9, quest_completed: true } },
      npc_boundary: { prototype: "actor", values: { level: 10, quest_completed: true } },
    },
    occurrences: [
      ...scenario.occurrences,
      { ...newOccurrence, id: "npc_below", event_order: 3, bindings: { actor: "npc_below", target: "door" } },
      { ...newOccurrence, id: "npc_boundary", event_order: 4, bindings: { actor: "npc_boundary", target: "door" } },
    ],
  };
  expect(game(snapshot, withBoundaryNpcs, ["npc_below"]).trace[0]?.condition).toBe("false");
  expect(game(snapshot, withBoundaryNpcs, ["npc_boundary"]).trace[0]?.condition).toBe("true");

  const files = new Map(snapshot.files);
  const primitive = record(snapshot, "ent_actor");
  const payload = structuredClone(statePayload(primitive)!);
  if (
    payload.record_type !== "definition" ||
    payload.initial.source !== "declared"
  )
    throw Error("expected prototype");
  delete payload.initial.values["quest_completed"];
  replaceMeta(files, primitive, payload);
  const missing = parseProject(files);
  const unknown = {
    ...scenario,
    actors: {
      ...scenario.actors,
      player: { ...scenario.actors["player"]!, values: { level: 10 } },
    },
  };
  const result = game(missing, unknown, ["enter_player"]);
  expect(result.trace[0]).toMatchObject({
    condition: "unknown",
    outcome: "unknown",
  });
  expect(cell(result, "actor:door", "open")?.value).toBe(false);
  expect(scenario.actors["player"]?.values["quest_completed"]).toBe(true);
});

function rule(
  snapshot: ProjectSnapshot,
  id: string,
  value: Transition,
  files: Map<string, SourceFile>,
) {
  const original = record(snapshot, "ent_gate_rule");
  const rev = "rev_" + id;
  const entityPath = `entities/${id}/entity.yaml`,
    metaPath = `entities/${id}/revisions/${rev}/meta.yaml`;
  files.set(
    entityPath,
    objectFile(entityPath, { id, kind: "state_model.transition" }),
  );
  files.set(
    metaPath,
    objectFile(metaPath, {
      ...original.meta,
      entity_id: id,
      revision_id: rev,
      extensions: { state_model: value },
    }),
  );
  const body = `entities/${id}/revisions/${rev}/content.md`;
  files.set(body, textFile(body, id));
  return rev;
}

it("detects conflicting simultaneous writes and invalidates the affected atomic transitions", async () => {
  const snapshot = await loadProject("fixtures/state-model");
  const files = new Map(snapshot.files);
  const original = statePayload(
    record(snapshot, "ent_gate_rule"),
  ) as Transition;
  const variant = rule(
    snapshot,
    "ent_conflict",
    { ...original, effects: [{ ...original.effects[0]!, value: false }] },
    files,
  );
  const baseline = snapshot.baselines.get(baselineId)!;
  files.set(
    baseline.path,
    objectFile(baseline.path, {
      ...baseline.value,
      selected: { ...baseline.value.selected, ent_conflict: variant },
    }),
  );
  const edited = parseProject(files),
    scenario = statePayload(record(edited, "ent_gate_scenario")) as Scenario;
  const result = game(edited, scenario, ["enter_player"]);
  expect(result.issues).toContainEqual({
    code: "AMBIGUOUS_EVENT_ORDER",
    field: "open",
  });
  expect(result.trace.map((value) => value.outcome)).toEqual([
    "conflict",
    "conflict",
  ]);
  expect(cell(result, "actor:door", "open")).toMatchObject({
    certainty: "unknown",
  });
  expect(cell(result, "actor:door", "open")?.value).toBeUndefined();
});

it("runs true condition entries from previous false values and bounds cyclic changes", async () => {
  const snapshot = await loadProject("fixtures/state-model"),
    files = new Map(snapshot.files);
  const source = statePayload(record(snapshot, "ent_gate_rule")) as Transition;
  const entry = (value: boolean): Transition => {
    const { condition: _condition, ...rest } = source;
    return {
      ...rest,
      trigger: { type: "condition_entered", node: "watch" },
      nodes: [
        {
          id: "watch",
          op: "compare",
          operator: "eq",
          left: {
            type: "state",
            binding: "target",
            link: "gate",
            field: "open",
          },
          right: { type: "literal", value },
        },
      ],
      effects: [{ ...source.effects[0]!, value: !value }],
      repeat: { mode: "on_entry", max_per_occurrence: 1, max_chain_steps: 4 },
    };
  };
  const close = rule(snapshot, "ent_close", entry(true), files);
  const open = rule(snapshot, "ent_reopen", entry(false), files);
  const baseline = snapshot.baselines.get(baselineId)!;
  files.set(
    baseline.path,
    objectFile(baseline.path, {
      ...baseline.value,
      selected: {
        ...baseline.value.selected,
        ent_close: close,
        ent_reopen: open,
      },
    }),
  );
  const edited = parseProject(files),
    scenario = statePayload(record(edited, "ent_gate_scenario")) as Scenario;
  const result = game(edited, scenario, ["enter_player"]);
  expect(
    result.trace.find((value) => value.transition?.entity_id === "ent_reopen")
      ?.outcome,
  ).toBe("unknown");
  expect(
    result.trace
      .filter((value) => value.outcome === "applied")
      .map((value) => value.transition?.entity_id),
  ).toEqual(["ent_gate_rule", "ent_close", "ent_reopen"]);
  expect(result.issues).toContainEqual(
    expect.objectContaining({ code: "STATE_CHAIN_LIMIT" }),
  );
});
