import type {
  BaselineAnalysis,
  QueryScope,
} from "../../domain/src/analysis.js";
import { canonicalJson } from "../../domain/src/canonical.js";
import type {
  ProjectSnapshot,
  RevisionRecord,
  SnapshotTarget,
} from "../../domain/src/model.js";
import {
  applicableRecords,
  keyOf,
  participates,
  recordConfidence,
  selectedPin,
  targetEquals,
  targetOf,
} from "../../domain/src/selected.js";
import type { JsonValue, StateEvent } from "../../schema/src/generated.js";
import { condition, normalizeReferences } from "./condition.js";
import type { Checked, ReadValue } from "./condition.js";
import type {
  Confidence,
  ContentMode,
  EvaluationPoint,
  StateCell,
  StateComparison,
  StateResult,
  StateTrace,
} from "./evaluation-contracts.js";
import type {
  Effect,
  Field,
  Occurrence,
  Operand,
  Reference,
  Scenario,
  Transition,
} from "./generated.js";
import { fieldAccepts, statePayload } from "./model.js";
import { Board, cellKey, equalValue } from "./state-board.js";
import { inTime, orderedGroups, type Ordered } from "./timeline.js";

interface Input extends Ordered {
  id: string;
  bindings: Record<string, string>;
  canonical?: { record: RevisionRecord; value: Occurrence };
  legacy?: { record: RevisionRecord; value: StateEvent };
  hypothetical?: Scenario["occurrences"][number];
}
interface PriorState {
  tick: number;
  cells: Map<string, StateCell>;
}
interface Rule {
  record: RevisionRecord;
  body: Transition;
}
interface Change {
  trace: StateTrace;
  cells: Map<string, StateCell>;
}
interface ScenarioInputs {
  record: RevisionRecord;
  scenario: Scenario;
  occurrenceIds?: string[];
}
interface Options {
  baselineId: string;
  scope: QueryScope;
  analysis: BaselineAnalysis;
  point: EvaluationPoint;
  mode: ContentMode;
  scenario?: ScenarioInputs;
  target?: string;
  actor?: string;
}

const samePosition = (value: Ordered, tick: number, order: number) =>
  value.worldTick === tick && value.eventOrder === order;
const empty = (): Map<string, StateCell> => new Map();
const maxScheduled = 4096;

function validEvidence(
  records: ReadonlyMap<string, RevisionRecord>,
  pin: SnapshotTarget,
) {
  return !!selectedPin(records, pin);
}

function inputTimeline(
  records: ReadonlyMap<string, RevisionRecord>,
  point: EvaluationPoint,
  scenario: ScenarioInputs | undefined,
  result: StateResult,
): Input[] {
  const timeline: Input[] = [];
  for (const record of records.values()) {
    const value = statePayload(record);
    const source = targetOf(record);
    if (value?.record_type === "occurrence") {
      const input: Input = {
        id: keyOf(source),
        worldTick: value.world_tick,
        eventOrder: value.event_order,
        bindings: {},
        canonical: { record, value },
      };
      if (inTime(input, point)) timeline.push(input);
    }
    const narrative = record.meta.extensions["narrative"] as unknown as
      StateEvent | undefined;
    if (!narrative || !Object.hasOwn(narrative, "field")) continue;
    if (
      narrative.world_tick === undefined ||
      narrative.event_order === undefined
    ) {
      if (narrative.record_role === "canon")
        result.issues.push({ code: "INCOMPLETE_TIMELINE", source });
      continue;
    }
    const input: Input = {
      id: keyOf(source),
      worldTick: narrative.world_tick,
      eventOrder: narrative.event_order,
      bindings: {},
      legacy: { record, value: narrative },
    };
    if (
      point.scene &&
      targetEquals(narrative.effective_at.scene.target, point.scene)
    ) {
      if (
        point.boundary === "before" &&
        narrative.effective_at.boundary === "after"
      )
        continue;
      if (
        input.worldTick === point.worldTick &&
        point.eventOrder === undefined
      ) {
        timeline.push(input);
        continue;
      }
    }
    if (inTime(input, point)) timeline.push(input);
  }
  const ids = new Set<string>();
  const selected = scenario?.occurrenceIds
    ? new Set(scenario.occurrenceIds)
    : null;
  for (const event of scenario?.scenario.occurrences ?? []) {
    if (ids.has(event.id)) {
      result.issues.push({
        code: "STATE_OCCURRENCE_DUPLICATE",
        occurrenceId: event.id,
      });
      continue;
    }
    ids.add(event.id);
    const input: Input = {
      id: event.id,
      worldTick: event.world_tick,
      eventOrder: event.event_order,
      bindings: event.bindings,
      hypothetical: event,
    };
    if ((!selected || selected.has(event.id)) && inTime(input, point))
      timeline.push(input);
  }
  if (selected && [...selected].some((id) => !ids.has(id)))
    throw new Error("STATE_OCCURRENCE_MISSING");
  return timeline;
}

function applyGroup(changes: Change[], board: Board, result: StateResult) {
  const writes = new Map<string, Change[]>();
  for (const change of changes)
    for (const key of change.cells.keys()) {
      const existing = writes.get(key) ?? [];
      existing.push(change);
      writes.set(key, existing);
    }
  const conflicted = new Set<Change>();
  for (const [key, writers] of writes) {
    const values = writers.map((change) => change.cells.get(key)!.value);
    if (
      new Set(
        values.map((value) =>
          value === undefined ? "" : canonicalJson(value),
        ),
      ).size <= 1
    )
      continue;
    for (const writer of writers) conflicted.add(writer);
    result.issues.push({
      code: "AMBIGUOUS_EVENT_ORDER",
      field: writers[0]!.cells.get(key)!.field,
    });
  }
  const applied = new Set<string>();
  for (const change of conflicted) {
    for (const [key, cell] of change.cells) {
      const {
        value: _value,
        evidence: _evidence,
        source: _source,
        occurrenceId: _occurrenceId,
        ...unresolved
      } = cell;
      board.changed.set(key, { ...unresolved, certainty: "unknown" });
    }
  }
  for (const change of changes) {
    if (conflicted.has(change)) {
      change.trace.outcome = "conflict";
    } else {
      for (const [key, cell] of change.cells) {
        if (writes.get(key)?.some((writer) => conflicted.has(writer))) continue;
        const previous = applied.has(key) ? board.changed.get(key) : undefined;
        if (previous?.certainty !== "provisional") board.changed.set(key, cell);
        applied.add(key);
      }
    }
    result.trace.push(change.trace);
  }
}

function operandField(
  rule: Transition,
  board: Board,
  locate: (link: string, binding?: string) => string | undefined,
  operand?: Operand,
): Field | undefined {
  if (operand?.type === "input") return rule.input_fields[operand.key];
  if (operand?.type === "state")
    return board.field(locate(operand.link, operand.binding), operand.field);
  return undefined;
}

function makeRuleAccess(
  board: Board,
  rule: Transition,
  input: Input,
  options: Options,
  historical?: PriorState,
) {
  const own = input.canonical?.value;
  const source = own ?? options.scenario?.scenario;
  const inputs = historical ? {} : (source?.inputs ?? {});
  const locate = (link: string, binding?: string) => {
    const pin = rule.links[link]?.target;
    if (!pin) return undefined;
    // Canon occurrences carry explicit prototype-to-exact-target links; hypothetical occurrences bind instances.
    if (binding && own) {
      const bound = own.links[own.bindings[binding] ?? ""]?.target;
      return bound && targetEquals(pin, bound)
        ? board.locate(bound, undefined, false)
        : undefined;
    }
    return board.locate(
      pin,
      binding ? input.bindings[binding] : undefined,
      !!binding,
    );
  };
  const read = (
    operand: Operand,
    hint?: Operand,
    member?: boolean,
  ): ReadValue => {
    if (operand.type === "state") {
      const key = locate(operand.link, operand.binding);
      const value = key
        ? board.read(
            key,
            operand.field,
            historical?.tick ?? input.worldTick,
            historical?.cells,
            !!historical,
          )
        : undefined;
      return value?.value === undefined
        ? {}
        : {
            value: value.value,
            provisional: value.certainty === "provisional",
          };
    }
    let field =
      operand.type === "input"
        ? rule.input_fields[operand.key]
        : operandField(rule, board, locate, hint);
    const raw = operand.type === "input" ? inputs[operand.key] : operand.value;
    if (raw === undefined) return {};
    if (operand.type === "input") {
      const declared = own
        ? field
        : options.scenario?.scenario.input_fields[operand.key];
      if (
        !field ||
        !declared ||
        field.unit !== declared.unit ||
        !fieldAccepts(field, raw)
      )
        return {};
    } else if (member && Array.isArray(raw) && field?.type === "reference")
      field = { type: "reference_set" };
    else if (member && field?.type === "reference_set")
      field = { type: "reference" };
    const value = normalizeReferences(
      raw,
      field,
      operand.type === "literal" ? rule.links : (source?.links ?? {}),
    );
    return value === undefined ? {} : { value };
  };
  return { locate, read };
}

function effectValue(
  effect: Effect,
  field: Field | undefined,
  rule: Transition,
  prior: JsonValue | undefined,
): { value?: JsonValue; ok: boolean } {
  if (effect.op === "unset") return { ok: true };
  if (effect.value === undefined) return { ok: false };
  const set = effect.op === "add_to_set" || effect.op === "remove_from_set";
  const value = normalizeReferences(
    effect.value,
    set && field?.type === "reference_set" ? { type: "reference" } : field,
    rule.links,
  );
  if (value === undefined) return { ok: false };
  if (effect.op === "set") return { ok: true, value };
  if (set) {
    if (!Array.isArray(prior)) return { ok: false };
    const without = prior.filter((item) => !equalValue(item, value));
    return {
      ok: true,
      value:
        effect.op === "remove_from_set"
          ? without
          : without.length < prior.length
            ? prior
            : [...prior, value],
    };
  }
  if (typeof prior !== "number" || typeof value !== "number")
    return { ok: false };
  const next = effect.op === "increment" ? prior + value : prior - value;
  return Number.isFinite(next) ? { ok: true, value: next } : { ok: false };
}

function traceOf(input: Input, certainty: Confidence): StateTrace {
  return {
    occurrenceId: input.id,
    worldTick: input.worldTick,
    eventOrder: input.eventOrder,
    bindings: input.bindings,
    outcome: "ignored",
    certainty,
  };
}

function evaluateRule(
  rule: Rule,
  input: Input,
  board: Board,
  options: Options,
  records: ReadonlyMap<string, RevisionRecord>,
  entry?: Checked,
): Change {
  const source = input.canonical
    ? targetOf(input.canonical.record)
    : options.scenario
      ? targetOf(options.scenario.record)
      : undefined;
  const evidence =
    input.canonical?.value.links[input.canonical.value.evidence]?.target;
  const trace = {
    ...traceOf(
      input,
      input.hypothetical
        ? "hypothetical"
        : recordConfidence(rule.record, options.analysis),
    ),
    transition: targetOf(rule.record),
    ...(source ? { source } : {}),
    ...(evidence ? { evidence } : {}),
  };
  const suppress = (
    reason: string,
    outcome: StateTrace["outcome"] = "ignored",
  ): Change => ({ trace: { ...trace, reason, outcome }, cells: empty() });
  if (input.canonical) {
    if (input.canonical.value.record_role !== "canon")
      return suppress("PLAN_NOT_OCCURRED");
    if (
      !participates(input.canonical.record, options.analysis, options.mode) ||
      !participates(rule.record, options.analysis, options.mode)
    )
      return suppress("UNCONFIRMED_EVENT");
    if (
      recordConfidence(input.canonical.record, options.analysis) ===
      "provisional"
    )
      trace.certainty = "provisional";
    if (!evidence || !validEvidence(records, evidence)) {
      if (options.mode === "confirmed")
        return suppress("EVIDENCE_REVIEW_REQUIRED");
      trace.certainty = "provisional";
      trace.reason = "EVIDENCE_REVIEW_REQUIRED";
    }
  }
  if (
    rule.body.trigger.type === "time" &&
    !samePosition(
      input,
      rule.body.trigger.world_tick,
      rule.body.trigger.event_order,
    )
  )
    return suppress("STATE_TRIGGER_MISMATCH");
  const access = makeRuleAccess(board, rule.body, input, options);
  for (const [name, link] of Object.entries(rule.body.bindings)) {
    if (!access.locate(link, name))
      return suppress("STATE_BINDING_MISMATCH", "unknown");
  }
  const check = condition(rule.body, rule.body.condition, access.read);
  trace.condition = check.truth;
  if (check.checks) trace.checks = check.checks;
  if (entry?.truth !== undefined && entry.truth !== "true") {
    trace.condition = entry.truth;
    return suppress(
      entry.truth === "unknown"
        ? "STATE_PRIOR_CONDITION_UNKNOWN"
        : "STATE_NO_ENTRY",
      entry.truth,
    );
  }
  if (check.truth !== "true")
    return suppress(
      check.truth === "false"
        ? "STATE_CONDITION_FALSE"
        : "STATE_CONDITION_UNKNOWN",
      check.truth,
    );
  if (
    (check.provisional || entry?.provisional) &&
    trace.certainty === "confirmed"
  )
    trace.certainty = "provisional";
  const cells = empty();
  for (const effect of rule.body.effects) {
    const key = access.locate(effect.link, effect.binding);
    if (!key) return suppress("STATE_BINDING_MISMATCH", "unknown");
    const prior = board.read(key, effect.field, input.worldTick, cells);
    const field = board.field(key, effect.field);
    if (!field) return suppress("STATE_FIELD_MISSING", "unknown");
    const next = effectValue(effect, field, rule.body, prior?.value);
    if (!next.ok) return suppress("STATE_EFFECT_UNRESOLVED", "unknown");
    const depends = !["set", "unset"].includes(effect.op);
    if (
      depends &&
      prior?.certainty === "provisional" &&
      trace.certainty === "confirmed"
    )
      trace.certainty = "provisional";
    const cell = board.make(key, effect.field, input.worldTick, next.value, {
      certainty: trace.certainty,
      source: source ?? targetOf(rule.record),
      occurrenceId: input.id,
      ...(evidence ? { evidence } : {}),
    });
    if (!cell) return suppress("STATE_EFFECT_OUT_OF_RANGE", "unknown");
    cells.set(cellKey(key, effect.field), cell);
  }
  if (trace.certainty === "provisional")
    for (const cell of cells.values())
      if (cell.certainty !== "unknown") cell.certainty = "provisional";
  return { trace: { ...trace, outcome: "applied" }, cells };
}

function evaluateLegacy(
  input: Input,
  board: Board,
  options: Options,
  records: ReadonlyMap<string, RevisionRecord>,
): Change {
  const { record, value } = input.legacy!;
  const evidence = value.evidence.target,
    source = targetOf(record);
  const trace = {
    ...traceOf(input, recordConfidence(record, options.analysis)),
    source,
    evidence,
  };
  const ignored = (reason: string): Change => ({
    trace: { ...trace, reason },
    cells: empty(),
  });
  if (value.record_role !== "canon") return ignored("PLAN_NOT_OCCURRED");
  if (!participates(record, options.analysis, options.mode))
    return ignored("UNCONFIRMED_EVENT");
  if (!validEvidence(records, evidence)) {
    if (options.mode === "confirmed")
      return ignored("EVIDENCE_REVIEW_REQUIRED");
    trace.certainty = "provisional";
    trace.reason = "EVIDENCE_REVIEW_REQUIRED";
  }
  const subject = records.get(value.subject.target.entity_id);
  const key = subject && board.locate(targetOf(subject), undefined, false);
  const cell =
    key &&
    board.make(
      key,
      value.field,
      input.worldTick,
      value.value,
      { source, evidence, occurrenceId: input.id, certainty: trace.certainty },
      value.unit,
    );
  if (!cell)
    return {
      trace: {
        ...trace,
        outcome: "unknown",
        reason: "STATE_EFFECT_UNRESOLVED",
      },
      cells: empty(),
    };
  return {
    trace: { ...trace, outcome: "applied" },
    cells: new Map([[cellKey(cell.instance, cell.field), cell]]),
  };
}

function entryChange(prior: Checked | undefined, next: Checked): Checked {
  const provisional = !!prior?.provisional || next.provisional;
  if (next.truth === "false" || prior?.truth === "true")
    return { truth: "false", provisional };
  return {
    truth:
      prior?.truth === "false" && next.truth === "true" ? "true" : "unknown",
    provisional,
  };
}

export function evaluateState(
  snapshot: ProjectSnapshot,
  options: Options,
): StateResult {
  const { baselineId, scope, analysis, mode, point, scenario } = options;
  const records = applicableRecords(snapshot, baselineId, scope);
  const result: StateResult = {
    point,
    mode,
    assumption: !!scenario,
    actor: options.actor ?? null,
    cells: [],
    trace: [],
    issues: [],
  };
  const board = new Board(records, analysis, scenario?.scenario);
  const rules = new Map<string, Rule>();
  for (const record of records.values()) {
    const value = statePayload(record);
    if (value?.record_type === "transition")
      rules.set(keyOf(targetOf(record)), { record, body: value });
  }
  const entries = new Map<string, Checked>();
  const scheduled = inputTimeline(records, point, scenario, result);
  if (scheduled.length > maxScheduled)
    throw new Error("STATE_EVALUATION_LIMIT");
  const preserveHistory = scheduled.some((input) => {
    const occurrence = input.canonical?.value;
    const target = occurrence?.links[occurrence.transition]?.target;
    return (
      target &&
      rules.get(keyOf(target))?.body.trigger.type === "condition_entered"
    );
  });
  let prior: PriorState | undefined;
  for (const group of orderedGroups(scheduled)) {
    const beforeGroup = preserveHistory
      ? { tick: group[0]!.worldTick, cells: new Map(board.changed) }
      : undefined;
    const changes: Change[] = [];
    const watchers: {
      input: Input;
      rule: Rule;
      key: string;
      before: Checked;
      applications: number;
    }[] = [];
    for (const input of group) {
      if (input.legacy) {
        changes.push(evaluateLegacy(input, board, options, records));
        continue;
      }
      const pin =
        input.canonical?.value.links[input.canonical.value.transition]?.target;
      const candidates = pin
        ? [rules.get(keyOf(pin))].filter((rule): rule is Rule => !!rule)
        : [...rules.values()];
      for (const rule of candidates) {
        const trigger = rule.body.trigger;
        if (
          input.hypothetical &&
          trigger.type === "event" &&
          trigger.name !== input.hypothetical.name
        )
          continue;
        if (
          input.hypothetical &&
          trigger.type === "time" &&
          !samePosition(input, trigger.world_tick, trigger.event_order)
        )
          continue;
        const access = makeRuleAccess(board, rule.body, input, options);
        if (
          input.hypothetical &&
          Object.entries(rule.body.bindings).some(
            ([name, link]) => !access.locate(link, name),
          )
        )
          continue;
        if (
          changes.length + watchers.length + result.trace.length >=
          maxScheduled
        )
          throw new Error("STATE_EVALUATION_LIMIT");
        if (trigger.type !== "condition_entered") {
          changes.push(evaluateRule(rule, input, board, options, records));
          continue;
        }
        const binding = canonicalJson(
          input.canonical?.value.bindings ?? input.bindings,
        );
        const key = keyOf(targetOf(rule.record)) + "/" + binding;
        const before = condition(rule.body, trigger.node, access.read);
        if (input.canonical) {
          const recent =
            prior &&
            condition(
              rule.body,
              trigger.node,
              makeRuleAccess(board, rule.body, input, options, prior).read,
            );
          const crossing = entryChange(
            recent?.truth !== "unknown"
              ? (recent ?? entries.get(key))
              : entries.get(key),
            before,
          );
          const change = evaluateRule(
            rule,
            input,
            board,
            options,
            records,
            crossing,
          );
          changes.push(change);
          if (change.trace.outcome !== "ignored") entries.set(key, before);
        } else if (input.hypothetical) {
          const crossing = entryChange(entries.get(key), before);
          if (crossing.truth !== "false")
            changes.push(
              evaluateRule(rule, input, board, options, records, crossing),
            );
          watchers.push({
            input,
            rule,
            key,
            before,
            applications: crossing.truth === "true" ? 1 : 0,
          });
        }
      }
      if (!candidates.length)
        changes.push({
          trace: {
            ...traceOf(input, "provisional"),
            outcome: "unknown",
            reason: "STATE_TRIGGER_UNAVAILABLE",
            ...(input.canonical
              ? { source: targetOf(input.canonical.record) }
              : {}),
          },
          cells: empty(),
        });
      else if (
        input.hypothetical &&
        !changes.some((change) => change.trace.occurrenceId === input.id) &&
        !watchers.some((watcher) => watcher.input === input)
      ) {
        changes.push({
          trace: {
            ...traceOf(input, "hypothetical"),
            reason: "STATE_TRIGGER_UNMATCHED",
          },
          cells: empty(),
        });
      }
    }
    applyGroup(changes, board, result);
    for (let step = 1; watchers.length && step <= 256; step++) {
      const wave: Change[] = [];
      for (const watcher of watchers) {
        const { input, rule } = watcher;
        const trigger = rule.body.trigger;
        if (trigger.type !== "condition_entered") continue;
        const after = condition(
          rule.body,
          trigger.node,
          makeRuleAccess(board, rule.body, input, options).read,
        );
        const crossed = entryChange(watcher.before, after);
        watcher.before = after;
        if (crossed.truth !== "true") continue;
        if (
          step >= rule.body.repeat.max_chain_steps ||
          watcher.applications >= rule.body.repeat.max_per_occurrence
        ) {
          result.issues.push({
            code: "STATE_CHAIN_LIMIT",
            occurrenceId: input.id,
            source: targetOf(rule.record),
          });
          wave.push({
            trace: {
              ...traceOf(input, "hypothetical"),
              outcome: "limit",
              transition: targetOf(rule.record),
              reason: "STATE_CHAIN_LIMIT",
            },
            cells: empty(),
          });
          continue;
        }
        watcher.applications++;
        wave.push(evaluateRule(rule, input, board, options, records, crossed));
      }
      if (!wave.length) break;
      if (result.trace.length + wave.length >= maxScheduled)
        throw new Error("STATE_EVALUATION_LIMIT");
      applyGroup(wave, board, result);
      if (!wave.some((change) => change.trace.outcome === "applied")) break;
    }
    for (const watcher of watchers) entries.set(watcher.key, watcher.before);
    prior = beforeGroup;
  }
  for (const item of result.trace) {
    if (item.reason === "EVIDENCE_REVIEW_REQUIRED")
      result.issues.push({
        code: item.reason,
        ...(item.source ? { source: item.source } : {}),
      });
  }
  const actors = options.actor ? new Set([options.actor]) : undefined;
  if (actors)
    for (const event of scheduled) {
      const bindings = Object.values(event.bindings);
      if (bindings.includes(options.actor!))
        for (const name of bindings) actors.add(name);
    }
  result.cells = board.cells(point.worldTick, actors, options.target);
  return result;
}

export function compareStates(
  before: StateResult,
  after: StateResult,
): StateComparison {
  const a = new Map(
    before.cells.map((cell) => [cellKey(cell.instance, cell.field), cell]),
  );
  const b = new Map(
    after.cells.map((cell) => [cellKey(cell.instance, cell.field), cell]),
  );
  const changes = [];
  for (const key of [...new Set([...a.keys(), ...b.keys()])]) {
    const left = a.get(key) ?? null,
      right = b.get(key) ?? null;
    const comparable = (cell: StateCell | null) =>
      cell ? [cell.value ?? null, cell.certainty, cell.unit ?? null] : null;
    if (canonicalJson(comparable(left)) === canonicalJson(comparable(right)))
      continue;
    const cell = left ?? right!;
    changes.push({
      instance: cell.instance,
      field: cell.field,
      before: left,
      after: right,
    });
  }
  return { before, after, changes };
}
