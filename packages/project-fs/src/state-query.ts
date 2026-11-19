import {
  resolveScene,
  readStoryQuery,
  storySequences,
} from "../../domain/src/story.js";
import { canonicalJson } from "../../domain/src/canonical.js";
import {
  applicableRecords,
  selectedPin,
  targetOf,
} from "../../domain/src/selected.js";
import type {
  BaselineAnalysis,
  QueryScope,
} from "../../domain/src/analysis.js";
import type {
  ProjectSnapshot,
  SnapshotTarget,
} from "../../domain/src/model.js";
import type { JsonValue } from "../../schema/src/generated.js";
import type { Scenario } from "../../state-model/src/generated.js";
import {
  statePayload,
  validateStateModel,
} from "../../state-model/src/model.js";
import {
  compareStates,
  evaluateState,
} from "../../state-model/src/evaluate.js";
import {
  evaluatorVersion,
  type StateQuery,
  type StateOptions,
} from "../../state-model/src/evaluation-contracts.js";
import { ValidationFailure } from "../../domain/src/model.js";
import { hash } from "./files.js";
import { semanticDigest } from "./changes.js";

interface QueryContext {
  baselineId: string;
  scope: QueryScope;
  analysis: BaselineAnalysis;
  headCommit: string;
  scopeFingerprint: string;
}
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const isId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z][a-z0-9_-]{0,255}$/.test(value);
const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value);

function readStateQuery(
  value: unknown,
): Omit<StateQuery, "worldTick"> & { worldTick?: number } {
  if (
    !isObject(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          "worldTick",
          "eventOrder",
          "boundary",
          "mode",
          "scenario",
          "actor",
          "occurrenceIds",
          "overrides",
          "actorOverrides",
          "target",
          "scene",
        ].includes(key),
    )
  )
    throw new Error("QUERY_ARGUMENT_INVALID");
  const {
    worldTick,
    eventOrder,
    boundary,
    mode,
    scenario,
    actor,
    occurrenceIds,
    overrides,
    actorOverrides,
    target,
    scene,
  } = value;
  if (
    (worldTick !== undefined && !integer(worldTick)) ||
    (eventOrder !== undefined && (!integer(eventOrder) || eventOrder < 0)) ||
    (boundary !== undefined && boundary !== "before" && boundary !== "after") ||
    (mode !== undefined && mode !== "confirmed" && mode !== "working") ||
    (target !== undefined && !isId(target)) ||
    (actor !== undefined && !isId(actor)) ||
    (scenario !== undefined &&
      (!isObject(scenario) ||
        Object.keys(scenario).length !== 2 ||
        !isId(scenario["entity_id"]) ||
        !isId(scenario["revision_id"]))) ||
    (occurrenceIds !== undefined &&
      (!Array.isArray(occurrenceIds) ||
        occurrenceIds.length > 1024 ||
        !occurrenceIds.every(isId) ||
        new Set(occurrenceIds).size !== occurrenceIds.length)) ||
    (overrides !== undefined &&
      (!isObject(overrides) || Object.keys(overrides).length > 128)) ||
    (actorOverrides !== undefined &&
      (!isObject(actorOverrides) ||
        Object.entries(actorOverrides).length > 64 ||
        Object.entries(actorOverrides).some(
          ([actor, values]) =>
            !isId(actor) ||
            !isObject(values) ||
            Object.keys(values).length > 128,
        ))) ||
    (scene !== undefined &&
      (!isObject(scene) ||
        Object.keys(scene).length !== 3 ||
        worldTick !== undefined ||
        eventOrder !== undefined ||
        boundary !== undefined ||
        scenario !== undefined)) ||
    (!scenario &&
      (actor !== undefined ||
        overrides !== undefined ||
        actorOverrides !== undefined ||
        occurrenceIds !== undefined))
  )
    throw new Error("QUERY_ARGUMENT_INVALID");
  return value as ReturnType<typeof readStateQuery>;
}

function scenarioInputs(
  snapshot: ProjectSnapshot,
  context: QueryContext,
  query: ReturnType<typeof readStateQuery>,
) {
  if (!query.scenario) return undefined;
  const records = applicableRecords(
    snapshot,
    context.baselineId,
    context.scope,
  );
  const record = selectedPin(records, query.scenario);
  const payload = record && statePayload(record);
  if (
    !record ||
    payload?.record_type !== "scenario" ||
    payload.baseline_id !== context.baselineId
  )
    throw new Error("STATE_SCENARIO_MISMATCH");
  if (query.actor && !Object.hasOwn(payload.actors, query.actor))
    throw new Error("STATE_ACTOR_MISSING");
  const actors = { ...payload.actors };
  for (const [actor, values] of Object.entries(query.actorOverrides ?? {})) {
    if (!Object.hasOwn(actors, actor)) throw new Error("STATE_ACTOR_MISSING");
    const original = actors[actor]!;
    actors[actor] = { ...original, values: { ...original.values, ...values } };
  }
  const scenario: Scenario = {
    ...payload,
    actors,
    inputs: { ...payload.inputs, ...query.overrides },
  };
  if (query.actorOverrides || query.overrides) {
    const entity = snapshot.entities.get(record.meta.entity_id)!;
    const entities = new Map(snapshot.entities),
      revisions = new Map(entity.revisions);
    revisions.set(record.meta.revision_id, {
      ...record,
      meta: {
        ...record.meta,
        extensions: {
          ...record.meta.extensions,
          state_model: scenario as unknown as Record<string, JsonValue>,
        },
      },
    });
    entities.set(record.meta.entity_id, { ...entity, revisions });
    const issues = validateStateModel({ ...snapshot, entities });
    if (issues.length) throw new ValidationFailure(issues);
  }
  return {
    record,
    scenario,
    ...(query.occurrenceIds ? { occurrenceIds: query.occurrenceIds } : {}),
  };
}

function evaluate(
  snapshot: ProjectSnapshot,
  context: QueryContext,
  value: unknown,
) {
  const query = readStateQuery(value),
    scenario = scenarioInputs(snapshot, context, query);
  const worldTick = query.worldTick ?? scenario?.scenario.world_tick;
  const point = query.scene
    ? resolveScene(
        snapshot,
        context.baselineId,
        context.scope,
        readStoryQuery(query.scene),
      ).point
    : worldTick === undefined
      ? undefined
      : {
          worldTick,
          ...(query.eventOrder !== undefined
            ? { eventOrder: query.eventOrder }
            : {}),
          ...(query.boundary ? { boundary: query.boundary } : {}),
        };
  if (!point)
    throw new Error(
      query.scene ? "INCOMPLETE_TIMELINE" : "QUERY_ARGUMENT_INVALID",
    );
  const result = evaluateState(snapshot, {
    ...context,
    point,
    mode: query.mode ?? "confirmed",
    ...(scenario ? { scenario } : {}),
    ...(query.actor ? { actor: query.actor } : {}),
    ...(query.target ? { target: query.target } : {}),
  });
  const baseline = snapshot.baselines.get(context.baselineId)!;
  const manifest = {
    policyVersion: evaluatorVersion,
    projectId: snapshot.project.project_id,
    baselineId: context.baselineId,
    baselineDigest: snapshot.files.get(baseline.path)!.digest,
    lockDigest: snapshot.files.get("schemas/lock.json")!.digest,
    source: { commit: context.headCommit, fingerprint: snapshot.fingerprint },
    scope: context.scope,
    query: { ...query, mode: result.mode },
    point,
    scenarioInputs: scenario
      ? {
          target: targetOf(scenario.record),
          actors: scenario.scenario.actors,
          inputs: scenario.scenario.inputs,
          occurrences: scenario.scenario.occurrences,
          assumptions: scenario.scenario.assumptions,
        }
      : null,
    selectedInputs: [
      ...applicableRecords(
        snapshot,
        context.baselineId,
        context.scope,
      ).values(),
    ]
      .map((record) => ({
        target: targetOf(record),
        digest: semanticDigest(
          snapshot,
          record.meta.entity_id,
          record.meta.revision_id,
        ),
      }))
      .sort((left, right) =>
        left.target.entity_id.localeCompare(right.target.entity_id, "en"),
      ),
  };
  const inputDigest = hash(canonicalJson(manifest));
  const scopeCacheKey = hash(
    canonicalJson({ scopeFingerprint: context.scopeFingerprint, inputDigest }),
  );
  return { ...result, inputDigest, scopeCacheKey, manifest };
}

export function stateEvaluation(
  snapshot: ProjectSnapshot,
  context: QueryContext,
  args: Record<string, unknown>,
) {
  return evaluate(snapshot, context, args);
}
export function stateComparison(
  snapshot: ProjectSnapshot,
  context: QueryContext,
  args: Record<string, unknown>,
) {
  if (Object.keys(args).some((key) => key !== "before" && key !== "after"))
    throw new Error("QUERY_ARGUMENT_INVALID");
  const before = evaluate(snapshot, context, args["before"]),
    after = evaluate(snapshot, context, args["after"]);
  return { ...compareStates(before, after), before, after };
}
export function stateOptions(
  snapshot: ProjectSnapshot,
  baselineId: string,
  scope: QueryScope,
): StateOptions {
  const records = applicableRecords(snapshot, baselineId, scope);
  const scenarios = [];
  const targets: { id: string; title: string }[] = [];
  for (const record of records.values()) {
    const state = statePayload(record);
    if (
      state?.record_type === "definition" ||
      record.meta.extensions["narrative"]?.["initial_state"]
    ) {
      targets.push({ id: record.meta.entity_id, title: record.meta.title });
    }
    if (state?.record_type === "scenario" && state.baseline_id === baselineId) {
      scenarios.push({
        target: targetOf(record) as SnapshotTarget,
        title: record.meta.title,
        worldTick: state.world_tick,
        actors: Object.keys(state.actors),
        occurrences: state.occurrences,
        assumptions: state.assumptions,
      });
    }
  }
  return {
    scenarios,
    targets,
    sequences: storySequences(snapshot, baselineId, scope).sequences,
  };
}
