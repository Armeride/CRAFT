import { applies, type BaselineAnalysis, type QueryScope } from "./analysis.js";
import {
  revisionKey,
  type ProjectSnapshot,
  type RevisionRecord,
  type SnapshotTarget,
} from "./model.js";
import type {
  ContentMode,
  Confidence,
} from "../../state-model/src/evaluation-contracts.js";

export const targetOf = (record: RevisionRecord): SnapshotTarget => ({
  entity_id: record.meta.entity_id,
  revision_id: record.meta.revision_id,
});
export const keyOf = (target: SnapshotTarget) =>
  revisionKey(target.entity_id, target.revision_id);
export const targetEquals = (a: SnapshotTarget, b: SnapshotTarget) =>
  keyOf(a) === keyOf(b);

export function applicableRecords(
  snapshot: ProjectSnapshot,
  baselineId: string,
  scope: QueryScope,
) {
  const records = new Map<string, RevisionRecord>();
  for (const [id, revision] of Object.entries(
    snapshot.baselines.get(baselineId)!.value.selected,
  )) {
    const record = snapshot.entities.get(id)?.revisions.get(revision);
    if (
      record?.writable &&
      record.meta.status !== "deprecated" &&
      applies(record.meta.scope, scope)
    )
      records.set(id, record);
  }
  return records;
}
export function selectedPin(
  records: ReadonlyMap<string, RevisionRecord>,
  target: SnapshotTarget,
) {
  const record = records.get(target.entity_id);
  return record?.meta.revision_id === target.revision_id ? record : undefined;
}
export function recordConfidence(
  record: RevisionRecord,
  analysis: BaselineAnalysis,
): Confidence {
  const node = analysis.nodes[keyOf(targetOf(record))];
  return record.meta.status === "approved" &&
    node?.review === "valid" &&
    !node.blockers.length
    ? "confirmed"
    : "provisional";
}
export function participates(
  record: RevisionRecord,
  analysis: BaselineAnalysis,
  mode: ContentMode,
) {
  return (
    mode === "working" || recordConfidence(record, analysis) === "confirmed"
  );
}
