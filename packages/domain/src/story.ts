import type { BaselineAnalysis, QueryScope } from "./analysis.js";
import type {
  ProjectSnapshot,
  RevisionRecord,
  SnapshotTarget,
} from "./model.js";
import {
  applicableRecords,
  keyOf,
  participates,
  recordConfidence,
  selectedPin,
  targetEquals,
  targetOf,
} from "./selected.js";
import type {
  EffectiveAt,
  KnowledgeEvent,
  NarrativeCharacter,
  NarrativeFact,
  NarrativeScene,
  RevealEvent,
  Sequence,
} from "../../schema/src/generated.js";
import type {
  ContentMode,
  EvaluationIssue,
  EvaluationPoint,
} from "../../state-model/src/evaluation-contracts.js";
import { evaluateState } from "../../state-model/src/evaluate.js";
import { inTime, orderOf } from "../../state-model/src/timeline.js";
import type {
  Attitude,
  Disclosure,
  Perspective,
  ScenePoint,
  StoryQuery,
} from "./story-contracts.js";

type Records = ReadonlyMap<string, RevisionRecord>;
const narrative = <T>(record: RevisionRecord) =>
  record.meta.extensions["narrative"] as unknown as T | undefined;
const fact = (snapshot: ProjectSnapshot, record: RevisionRecord) =>
  snapshot.entities.get(record.meta.entity_id)?.value.kind === "world.fact"
    ? narrative<NarrativeFact>(record)
    : undefined;
const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value);

export function readStoryQuery(
  input: unknown,
  kind: "author" | "reader" | "character" = "author",
): StoryQuery {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("QUERY_ARGUMENT_INVALID");
  const value = input as Record<string, unknown>;
  const id = (data: unknown): data is string =>
    typeof data === "string" && /^[a-z][a-z0-9_-]{0,255}$/.test(data);
  if (
    Object.keys(value).some(
      (key) =>
        ![
          "sequenceId",
          "sceneId",
          "boundary",
          "mode",
          "characterId",
          "worldTick",
          "eventOrder",
        ].includes(key),
    ) ||
    !id(value["sequenceId"]) ||
    !id(value["sceneId"]) ||
    (value["boundary"] !== "before" && value["boundary"] !== "after") ||
    (value["characterId"] !== undefined && !id(value["characterId"])) ||
    (kind === "character" && !id(value["characterId"])) ||
    (value["mode"] !== undefined &&
      value["mode"] !== "working" &&
      value["mode"] !== "confirmed") ||
    (value["worldTick"] !== undefined && !integer(value["worldTick"])) ||
    (value["eventOrder"] !== undefined &&
      (!integer(value["eventOrder"]) ||
        value["eventOrder"] < 0 ||
        value["worldTick"] === undefined))
  )
    throw new Error("QUERY_ARGUMENT_INVALID");
  return {
    sequenceId: value["sequenceId"],
    sceneId: value["sceneId"],
    boundary: value["boundary"] as StoryQuery["boundary"],
    ...(value["characterId"]
      ? { characterId: value["characterId"] as string }
      : {}),
    ...(value["mode"] ? { mode: value["mode"] as ContentMode } : {}),
    ...(value["worldTick"] !== undefined
      ? { worldTick: value["worldTick"] as number }
      : {}),
    ...(value["eventOrder"] !== undefined
      ? { eventOrder: value["eventOrder"] as number }
      : {}),
  };
}

export function readPerspective(value: unknown): Perspective | undefined {
  if (value === undefined || value === "author") return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("CONTEXT_FORBIDDEN");
  const { kind, story, scope, ...extra } = value as Record<string, unknown>;
  if ((kind !== "reader" && kind !== "character") || Object.keys(extra).length)
    throw new Error("CONTEXT_FORBIDDEN");
  if (
    scope !== undefined &&
    (!scope ||
      typeof scope !== "object" ||
      Array.isArray(scope) ||
      Object.entries(scope).some(
        ([key, val]) =>
          !["platform", "mode", "continuity"].includes(key) ||
          typeof val !== "string" ||
          !val ||
          val.length > 256,
      ))
  )
    throw new Error("CONTEXT_FORBIDDEN");
  return {
    kind,
    story: readStoryQuery(story, kind),
    ...(scope ? { scope: scope as QueryScope } : {}),
  };
}

export function storySequences(
  snapshot: ProjectSnapshot,
  baselineId: string,
  scope: QueryScope,
) {
  const records = applicableRecords(snapshot, baselineId, scope);
  const sequences = [];
  for (const [path, data] of snapshot.documents) {
    if (!/^narrative\/sequences\/[^/]+\.yaml$/.test(path)) continue;
    const sequence = data as Sequence;
    const scenes: ScenePoint[] = [];
    let order = 0;
    for (const chapter of sequence.chapters)
      for (const reference of chapter.scenes) {
        const position = order++;
        const record = selectedPin(records, reference.target);
        const details = record && narrative<NarrativeScene>(record);
        if (
          !record ||
          snapshot.entities.get(record.meta.entity_id)?.value.kind !==
            "narrative.scene" ||
          !details
        )
          continue;
        scenes.push({
          order: position,
          chapter: chapter.label,
          chapterId: chapter.id,
          target: targetOf(record),
          title: record.meta.title,
          startTick: details.start_tick ?? null,
          endTick: details.end_tick ?? null,
        });
      }
    sequences.push({
      id: sequence.id,
      scenes,
      incomplete: scenes.length !== order,
    });
  }
  const characters = [...records.values()]
    .filter(
      (record) =>
        snapshot.entities.get(record.meta.entity_id)?.value.kind ===
        "narrative.character",
    )
    .map((record) => ({ id: record.meta.entity_id, title: record.meta.title }));
  return { sequences, characters };
}

export function resolveScene(
  snapshot: ProjectSnapshot,
  baselineId: string,
  scope: QueryScope,
  query: StoryQuery,
) {
  const { sequences } = storySequences(snapshot, baselineId, scope);
  const sequence = sequences.find((value) => value.id === query.sequenceId);
  const scenes =
    sequence?.scenes.filter(
      (value) => value.target.entity_id === query.sceneId,
    ) ?? [];
  if (!sequence || scenes.length !== 1)
    throw new Error("STORY_SCENE_AMBIGUOUS");
  const scene = scenes[0]!;
  return { sequence, scene, point: pointAt(scene, query) };
}

function pointAt(scene: ScenePoint, query: StoryQuery): EvaluationPoint | null {
  const tick =
    query.worldTick ??
    (query.boundary === "before" ? scene.startTick : scene.endTick);
  if (tick === null) return null;
  if (
    (scene.startTick !== null && tick < scene.startTick) ||
    (scene.endTick !== null && tick > scene.endTick) ||
    (scene.startTick !== null &&
      scene.endTick !== null &&
      scene.endTick < scene.startTick)
  )
    return null;
  return {
    worldTick: tick,
    boundary: query.boundary,
    scene: scene.target,
    ...(query.eventOrder !== undefined ? { eventOrder: query.eventOrder } : {}),
  };
}

interface KnowledgeRow {
  record: RevisionRecord;
  body: KnowledgeEvent;
  worldTick: number;
  eventOrder: number;
  certainty: "confirmed" | "provisional";
}
function insideScene(
  event: {
    worldTick: number;
    eventOrder: number;
    body: { effective_at: EffectiveAt };
  },
  point: EvaluationPoint,
) {
  const sameScene =
    !!point.scene &&
    targetEquals(event.body.effective_at.scene.target, point.scene);
  if (
    sameScene &&
    point.boundary === "before" &&
    event.body.effective_at.boundary === "after"
  )
    return false;
  return (
    (event.worldTick === point.worldTick &&
      sameScene &&
      point.eventOrder === undefined) ||
    inTime(event, point)
  );
}

function knowledge(
  records: Records,
  analysis: BaselineAnalysis,
  query: StoryQuery,
  point: EvaluationPoint | null,
  issues: EvaluationIssue[],
) {
  const items = new Map<string, KnowledgeRow>();
  const ambiguous = new Set<string>();
  if (!point || !query.characterId) return items;
  for (const record of records.values()) {
    const body = narrative<KnowledgeEvent>(record);
    if (
      !body?.attitude ||
      body.record_role !== "canon" ||
      body.subject.target.entity_id !== query.characterId ||
      !participates(record, analysis, query.mode ?? "confirmed")
    )
      continue;
    const source = targetOf(record);
    if (body.world_tick === undefined || body.event_order === undefined) {
      issues.push({ code: "INCOMPLETE_TIMELINE", source });
      continue;
    }
    let certainty =
      recordConfidence(record, analysis) === "confirmed"
        ? ("confirmed" as const)
        : ("provisional" as const);
    if (
      !selectedPin(records, body.evidence.target) ||
      !selectedPin(records, body.effective_at.scene.target)
    ) {
      issues.push({ code: "EVIDENCE_REVIEW_REQUIRED", source });
      if (query.mode !== "working") continue;
      certainty = "provisional";
    }
    if (!selectedPin(records, body.proposition.target)) continue;
    const item: KnowledgeRow = {
      record,
      body,
      worldTick: body.world_tick,
      eventOrder: body.event_order,
      certainty,
    };
    if (!insideScene(item, point)) continue;
    const key = keyOf(body.proposition.target);
    const old = items.get(key);
    if (!old || orderOf(old, item) < 0) {
      items.set(key, item);
      ambiguous.delete(key);
    } else if (
      orderOf(old, item) === 0 &&
      (old.body.attitude !== body.attitude || old.record.body !== record.body)
    )
      ambiguous.add(key);
  }
  for (const key of ambiguous) {
    issues.push({
      code: "AMBIGUOUS_EVENT_ORDER",
      source: targetOf(items.get(key)!.record),
    });
    items.delete(key);
  }
  return items;
}

function readerDisclosures(
  records: Records,
  analysis: BaselineAnalysis,
  query: StoryQuery,
  scenes: ScenePoint[],
  order: number,
) {
  const entries: Disclosure[] = [];
  const indexes = new Map<string, number>();
  const ambiguous = new Set<string>();
  for (const scene of scenes) {
    const key = keyOf(scene.target);
    if (indexes.has(key)) ambiguous.add(key);
    else indexes.set(key, scene.order);
  }
  for (const record of records.values()) {
    const event = narrative<RevealEvent>(record);
    if (
      event?.sequence_id !== query.sequenceId ||
      event.record_role !== "canon" ||
      !participates(record, analysis, query.mode ?? "confirmed") ||
      !selectedPin(records, event.target.target)
    )
      continue;
    const scene = keyOf(event.scene.target);
    const position = indexes.get(scene);
    if (
      position === undefined ||
      ambiguous.has(scene) ||
      position > order ||
      (position === order &&
        query.boundary === "before" &&
        event.boundary === "after")
    )
      continue;
    entries.push({
      target: targetOf(selectedPin(records, event.target.target)!),
      text: event.revealed_content,
      certainty:
        recordConfidence(record, analysis) === "confirmed"
          ? "confirmed"
          : "provisional",
    });
  }
  return entries;
}

function characterDisclosures(
  rows: ReadonlyMap<string, KnowledgeRow>,
): Disclosure[] {
  const entries: Disclosure[] = [];
  for (const { record, body, certainty } of rows.values()) {
    if (body.attitude === "explicitly_unaware") continue;
    // The authored perception is the exported text. Raw fact bodies, titles, anchors and evidence stay in the author view.
    const text = record.body
      .replace(/\[\[ref:[^\]\r\n]+\]\]/g, "")
      .replace(/<a id="[^"]+"><\/a>/g, "")
      .trim();
    if (text)
      entries.push({
        target: {
          entity_id: body.proposition.target.entity_id,
          revision_id: body.proposition.target.revision_id,
        },
        text,
        certainty,
        attitude: body.attitude,
      });
  }
  return entries;
}

export function storyContext(
  snapshot: ProjectSnapshot,
  baselineId: string,
  scope: QueryScope,
  analysis: BaselineAnalysis,
  query: StoryQuery,
  perspective?: Perspective["kind"],
) {
  let position: ReturnType<typeof resolveScene>;
  try {
    position = resolveScene(snapshot, baselineId, scope, query);
  } catch (error) {
    if (perspective) throw new Error("CONTEXT_FORBIDDEN");
    throw error;
  }
  const { sequence, scene, point } = position;
  const records = applicableRecords(snapshot, baselineId, scope);
  const character = query.characterId
    ? records.get(query.characterId)
    : undefined;
  if (
    query.characterId &&
    (!character ||
      snapshot.entities.get(query.characterId)?.value.kind !==
        "narrative.character")
  )
    throw new Error(
      perspective ? "CONTEXT_FORBIDDEN" : "STORY_CHARACTER_MISSING",
    );
  const issues: EvaluationIssue[] = [];
  if (!point || sequence.incomplete)
    issues.push({ code: "INCOMPLETE_TIMELINE" });
  const rows = knowledge(records, analysis, query, point, issues);
  if (perspective) {
    return {
      perspective,
      query,
      worldTick: point?.worldTick ?? null,
      readerPosition: scene.order,
      disclosures:
        perspective === "reader"
          ? readerDisclosures(
              records,
              analysis,
              query,
              sequence.scenes,
              scene.order,
            )
          : characterDisclosures(rows),
      issues: [],
    };
  }
  const state = point
    ? evaluateState(snapshot, {
        baselineId,
        scope,
        analysis,
        point,
        mode: query.mode ?? "confirmed",
        ...(query.characterId ? { target: query.characterId } : {}),
      })
    : null;
  const related = new Set(rows.keys());
  for (const link of records.get(scene.target.entity_id)?.references ?? [])
    related.add(keyOf(link.value.target));
  for (const record of records.values()) {
    const item = narrative<KnowledgeEvent>(record);
    if (
      item?.attitude &&
      item.subject.target.entity_id === query.characterId &&
      targetEquals(item.effective_at.scene.target, scene.target)
    )
      related.add(keyOf(item.proposition.target));
  }
  const facts = [];
  for (const record of records.values()) {
    const event = fact(snapshot, record);
    const pin = targetOf(record),
      provenance = rows.get(keyOf(pin));
    if (!event || (query.characterId && !related.has(keyOf(pin)))) continue;
    const occurred =
      event.record_role === "canon" &&
      point !== null &&
      event.world_tick !== undefined &&
      (event.world_tick < point.worldTick ||
        (event.world_tick === point.worldTick &&
          point.boundary !== "before")) &&
      participates(record, analysis, query.mode ?? "confirmed");
    if (occurred || provenance || event.record_role === "plan")
      facts.push({
        target: pin,
        title: record.meta.title,
        role: event.record_role,
        occurred,
        attitude: provenance?.body.attitude ?? ("unrecorded" as Attitude),
        ...(provenance
          ? {
              knowledge: targetOf(provenance.record),
              evidence: provenance.body.evidence.target,
              certainty: provenance.certainty,
            }
          : {}),
      });
  }
  const profile = character
    ? narrative<NarrativeCharacter>(character)?.profile
    : undefined;
  return {
    perspective: "author",
    query,
    worldTick: point?.worldTick ?? null,
    readerPosition: scene.order,
    timeline: sequence.scenes,
    ...(profile ? { profile } : {}),
    state,
    facts,
    issues,
    disclosures: readerDisclosures(
      records,
      analysis,
      query,
      sequence.scenes,
      scene.order,
    ),
  };
}
