import type { Baseline, Entity, Project, Reference, Revision } from '../../schema/src/generated.js';

export type { Baseline, Entity, Project, Reference, Revision, Scope, SnapshotTarget } from '../../schema/src/generated.js';

export interface Diagnostic {
  code: string;
  message: string;
  severity: 'error' | 'warning';
  path: string;
  pointer: string;
  line?: number;
  column?: number;
}

export class ValidationFailure extends Error {
  constructor(public readonly diagnostics: readonly Diagnostic[]) {
    super(diagnostics.map(d => `${d.path}:${d.line ?? 1}:${d.column ?? 1} ${d.code}: ${d.message}`).join('\n'));
    this.name = 'ValidationFailure';
  }
}

export interface SourceFile {
  readonly path: string;
  readonly text?: string;
  readonly contentBase64: string;
  readonly digest: string;
}

export interface LocatedReference {
  readonly value: Reference;
  readonly path: string;
  readonly pointer: string;
}

export interface RevisionRecord {
  readonly meta: Revision;
  readonly path: string;
  readonly bodyPath: string;
  readonly body: string;
  readonly references: readonly LocatedReference[];
  readonly anchors: ReadonlySet<string>;
  readonly writable: boolean;
}

export interface EntityRecord {
  readonly value: Entity;
  readonly path: string;
  readonly revisions: ReadonlyMap<string, RevisionRecord>;
}

export interface ProjectSnapshot {
  readonly project: Project;
  readonly fingerprint: string;
  readonly files: ReadonlyMap<string, SourceFile>;
  readonly entities: ReadonlyMap<string, EntityRecord>;
  readonly baselines: ReadonlyMap<string, { readonly value: Baseline; readonly path: string }>;
  readonly documents: ReadonlyMap<string, unknown>;
  readonly diagnostics: readonly Diagnostic[];
  readonly writable: boolean;
}

export const revisionKey = (entityId: string, revisionId: string): string => `${entityId}/${revisionId}`;

export function exactRevision(snapshot: ProjectSnapshot, entityId: string, revisionId: string): RevisionRecord {
  const result = snapshot.entities.get(entityId)?.revisions.get(revisionId);
  if (!result) throw new Error(`REVISION_NOT_FOUND: ${revisionKey(entityId, revisionId)}`);
  return result;
}

export function selectedRevision(snapshot: ProjectSnapshot, baselineId: string, entityId: string): RevisionRecord {
  const baseline = snapshot.baselines.get(baselineId)?.value;
  if (!baseline) throw new Error(`BASELINE_NOT_FOUND: ${baselineId}`);
  const revisionId = baseline.selected[entityId];
  if (!revisionId) throw new Error(`ENTITY_NOT_SELECTED: ${entityId}`);
  return exactRevision(snapshot, entityId, revisionId);
}
