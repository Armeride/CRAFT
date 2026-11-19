import { applies, type BaselineAnalysis, type QueryScope } from "./analysis.js";
import type { ProjectSnapshot } from "./model.js";
import {
  applicableRecords,
  recordConfidence,
  targetEquals,
  targetOf,
} from "./selected.js";
import type {
  GameDesign,
  GameObservation,
  Quantity,
  SnapshotTarget,
  Scope,
  Reference,
  Revision,
} from "../../schema/src/generated.js";

interface DesignRow {
  target: SnapshotTarget;
  title: string;
  status: Revision["status"];
  selected: boolean;
  scope: Scope;
  quantities: Record<string, Quantity | { value: number; unit: null }>;
  certainty: string;
  evidence: Reference[];
  decisions: { target: SnapshotTarget; title: string; body: string }[];
}

export function gameContext(
  snapshot: ProjectSnapshot,
  baseline: string,
  scope: QueryScope,
  analysis: BaselineAnalysis,
  entityId?: string,
) {
  const selection = snapshot.baselines.get(baseline)!.value.selected;
  const rules: DesignRow[] = [],
    proposals: DesignRow[] = [],
    observations = [];
  const decisions = [
    ...applicableRecords(snapshot, baseline, scope).values(),
  ].filter(
    (record) =>
      snapshot.entities.get(record.meta.entity_id)?.value.kind === "decision",
  );
  for (const entity of snapshot.entities.values()) {
    if (!entity.value.kind.startsWith("game.")) continue;
    if (
      entityId &&
      entity.value.kind !== "game.observation" &&
      entity.value.id !== entityId
    )
      continue;
    for (const record of entity.revisions.values()) {
      if (
        !record.writable ||
        !applies(record.meta.scope, scope) ||
        record.meta.status === "deprecated"
      )
        continue;
      const extension = record.meta.extensions["game_design"] as unknown as
        GameDesign | GameObservation | undefined;
      if (!extension) continue;
      const target = targetOf(record),
        selected = selection[target.entity_id] === target.revision_id;
      const base = {
        target,
        title: record.meta.title,
        status: record.meta.status,
        selected,
        scope: record.meta.scope,
      };
      if (entity.value.kind === "game.observation") {
        if (
          !selected ||
          !("measurements" in extension) ||
          (entityId && extension.rule.target.entity_id !== entityId) ||
          (['continuity', 'platform', 'mode'] as const).some(key =>
            scope[key] !== undefined && typeof extension.conditions[key] === 'string' && extension.conditions[key] !== scope[key])
        )
          continue;
        observations.push({ ...base, ...extension });
        continue;
      }
      if ("measurements" in extension) continue;
      const quantities: Record<
        string,
        Quantity | { value: number; unit: null }
      > = { ...extension.parameters };
      if (
        extension.invulnerability_seconds !== undefined &&
        !quantities["invulnerability_seconds"]
      ) {
        quantities["invulnerability_seconds"] = {
          value: extension.invulnerability_seconds,
          value_type: "decimal",
          unit: "seconds",
        };
      }
      if (extension.stamina_cost !== undefined && !quantities["stamina_cost"]) {
        quantities["stamina_cost"] = {
          value: extension.stamina_cost,
          unit: null,
        };
      }
      const row = {
        ...base,
        quantities,
        certainty: recordConfidence(record, analysis),
        evidence: record.references
          .map((item) => item.value)
          .filter((item) => ["evidence", "cites"].includes(item.relation)),
        decisions: decisions
          .filter(
            (value) =>
              value.references.some((ref) =>
                targetEquals(ref.value.target, target),
              ) ||
              record.references.some((ref) =>
                targetEquals(ref.value.target, targetOf(value)),
              ),
          )
          .map((decision) => ({
            target: targetOf(decision),
            title: decision.meta.title,
            body: decision.body,
          })),
      };
      (selected ? rules : proposals).push(row);
    }
  }
  const differences = observations.flatMap((observation) =>
    observation.measurements.map((measurement) => {
      const design = rules.find((rule) =>
        targetEquals(rule.target, observation.rule.target),
      )?.quantities[measurement.parameter];
      return {
        observation: observation.target,
        rule: observation.rule.target,
        parameter: measurement.parameter,
        planned: design ?? null,
        observed: measurement.quantity,
        delta:
          design?.unit === measurement.quantity.unit
            ? measurement.quantity.value - design.value
            : null,
      };
    }),
  );
  return { scope, rules, proposals, observations, differences };
}
