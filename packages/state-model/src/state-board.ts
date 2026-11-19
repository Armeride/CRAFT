import { canonicalJson } from "../../domain/src/canonical.js";
import {
  targetEquals,
  targetOf,
  recordConfidence,
  selectedPin,
} from "../../domain/src/selected.js";
import type { BaselineAnalysis } from "../../domain/src/analysis.js";
import type { RevisionRecord, SnapshotTarget } from "../../domain/src/model.js";
import type {
  JsonValue,
  NarrativeCharacter,
} from "../../schema/src/generated.js";
import { fieldAccepts, statePayload } from "./model.js";
import { normalizeReferences } from "./condition.js";
import type { Field, Scenario } from "./generated.js";
import type { Confidence, StateCell } from "./evaluation-contracts.js";

interface Instance {
  key: string;
  target: SnapshotTarget;
  start: number | undefined;
  fields: Record<string, Field | undefined>;
  initial: Record<string, StateCell>;
}
type Provenance = Pick<
  StateCell,
  "certainty" | "source" | "evidence" | "occurrenceId"
>;
export const cellKey = (instance: string, field: string) =>
  instance + "/" + field;
export const equalValue = (a: JsonValue, b: JsonValue) =>
  canonicalJson(a) === canonicalJson(b);

export class Board {
  private readonly instances = new Map<string, Instance>();
  readonly changed = new Map<string, StateCell>();

  constructor(
    records: ReadonlyMap<string, RevisionRecord>,
    analysis: BaselineAnalysis,
    scenario?: Scenario,
  ) {
    for (const record of records.values()) {
      this.add(
        "entity:" + record.meta.entity_id,
        record,
        recordConfidence(record, analysis),
      );
    }
    for (const [name, actor] of Object.entries(scenario?.actors ?? {})) {
      const prototype = scenario!.links[actor.prototype]?.target;
      const record = prototype && selectedPin(records, prototype);
      if (!record) throw new Error("STATE_BINDING_MISMATCH");
      this.add(
        "actor:" + name,
        record,
        "hypothetical",
        actor.values,
        scenario!.links,
      );
    }
  }

  private add(
    key: string,
    record: RevisionRecord,
    certainty: Confidence,
    overrides: Record<string, JsonValue> = {},
    links?: Scenario["links"],
  ) {
    const definition = statePayload(record);
    const typed =
      definition?.record_type === "definition" ? definition : undefined;
    const legacy = (
      record.meta.extensions["narrative"] as unknown as
        NarrativeCharacter | undefined
    )?.initial_state;
    const initial =
      typed?.initial.source === "declared" ? typed.initial : legacy;
    const target = targetOf(record);
    const fields: Instance["fields"] =
      typed?.fields ??
      Object.fromEntries(
        Object.keys(initial?.values ?? {}).map((key) => [key, undefined]),
      );
    if (!typed && !initial) return;
    const values: Instance["initial"] = {};
    for (const [field, spec] of Object.entries(fields)) {
      const overridden = Object.hasOwn(overrides, field);
      const raw = overridden ? overrides[field] : initial?.values[field];
      const value =
        raw === undefined
          ? undefined
          : normalizeReferences(
              raw,
              spec,
              (overridden ? links : typed?.links) ?? {},
            );
      values[field] = {
        instance: key,
        target,
        field,
        ...(spec?.unit ? { unit: spec.unit } : {}),
        ...(value === undefined
          ? { certainty: "unknown" }
          : { value, certainty, source: target }),
      };
    }
    this.instances.set(key, {
      key,
      target,
      start: initial?.world_tick,
      fields,
      initial: values,
    });
  }

  locate(
    target: SnapshotTarget,
    actor: string | undefined,
    bound: boolean,
  ): string | undefined {
    if (bound && !actor) return undefined;
    const key = actor ? "actor:" + actor : "entity:" + target.entity_id;
    const instance = this.instances.get(key);
    return instance && targetEquals(target, instance.target) ? key : undefined;
  }

  field(key: string | undefined, field: string) {
    return key ? this.instances.get(key)?.fields[field] : undefined;
  }

  read(
    key: string,
    field: string,
    tick: number,
    overlay = this.changed,
    historical = false,
  ): StateCell | undefined {
    const instance = this.instances.get(key);
    if (!instance || instance.start === undefined || tick < instance.start)
      return undefined;
    const id = cellKey(key, field);
    return (
      overlay.get(id) ??
      (historical ? undefined : this.changed.get(id)) ??
      (Object.hasOwn(instance.initial, field)
        ? instance.initial[field]
        : undefined)
    );
  }

  make(
    key: string,
    field: string,
    tick: number,
    value: JsonValue | undefined,
    provenance: Provenance,
    unit?: string,
  ): StateCell | undefined {
    const instance = this.instances.get(key);
    if (!instance || instance.start === undefined || instance.start > tick)
      return undefined;
    const spec = instance.fields[field];
    if (
      value !== undefined &&
      spec &&
      !["reference", "reference_set"].includes(spec.type) &&
      !fieldAccepts(spec, value)
    )
      return undefined;
    const resolvedUnit = spec?.unit ?? unit;
    return {
      instance: key,
      target: instance.target,
      field,
      ...(resolvedUnit ? { unit: resolvedUnit } : {}),
      ...provenance,
      ...(value === undefined ? { certainty: "unknown" } : { value }),
    };
  }

  cells(
    tick: number,
    actors?: ReadonlySet<string>,
    target?: string,
  ): StateCell[] {
    const result: StateCell[] = [];
    for (const instance of this.instances.values()) {
      if (
        (target && target !== instance.target.entity_id) ||
        (actors &&
          instance.key.startsWith("actor:") &&
          !actors.has(instance.key.slice(6)))
      )
        continue;
      const fields = new Set(Object.keys(instance.fields));
      for (const cell of this.changed.values())
        if (cell.instance === instance.key) fields.add(cell.field);
      for (const field of fields) {
        const unit = instance.fields[field]?.unit;
        result.push(
          this.read(instance.key, field, tick) ?? {
            instance: instance.key,
            target: instance.target,
            field,
            certainty: "unknown",
            ...(unit ? { unit } : {}),
          },
        );
      }
    }
    return result.sort((a, b) =>
      cellKey(a.instance, a.field).localeCompare(
        cellKey(b.instance, b.field),
        "en",
      ),
    );
  }
}
