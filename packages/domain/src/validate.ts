import type { Diagnostic, LocatedReference, ProjectSnapshot, RevisionRecord } from './model.js';
import { normalizedScope } from './canonical.js';
import type { Scope, Sequence, SnapshotTarget } from '../../schema/src/generated.js';

export function scopesOverlap(a: Scope, b: Scope): boolean {
  if ((a.continuity ?? 'main') !== (b.continuity ?? 'main')) return false;
  return (['platform', 'mode'] as const).every(key => !a[key] || !b[key] || a[key].some(value => b[key]!.includes(value)));
}

export function validateGraph(snapshot: ProjectSnapshot): Diagnostic[] {
  const errors: Diagnostic[] = [];
  const issue = (code: string, message: string, path: string, pointer: string, severity: 'error' | 'warning' = 'error'): void => { errors.push({ code, message, path, pointer, severity }); };
  const checkTarget = (target: SnapshotTarget, path: string, pointer: string): RevisionRecord | undefined => {
    const record = snapshot.entities.get(target.entity_id)?.revisions.get(target.revision_id);
    if (!record) issue('MISSING_TARGET', `Missing exact revision ${target.entity_id}/${target.revision_id}`, path, pointer);
    else if (target.anchor_id && !record.anchors.has(target.anchor_id)) issue('MISSING_ANCHOR', `Anchor ${target.anchor_id} is missing`, path, pointer + '/anchor_id');
    return record;
  };
  const checkReferences = (references: readonly LocatedReference[]): void => {
    const seen = new Set<string>();
    const defaults = { depends_on: 'blocking', evidence: 'advisory', cites: 'none', compares: 'none', replaces: 'none', related_to: 'none' };
    for (const { value, path, pointer } of references) {
      if (seen.has(value.reference_id)) issue('DUPLICATE_REFERENCE_ID', `Repeated reference ${value.reference_id}`, path, pointer + '/reference_id');
      seen.add(value.reference_id);
      checkTarget(value.target, path, pointer + '/target');
      if (value.propagation !== defaults[value.relation] && !value.rationale) issue('REFERENCE_RATIONALE_REQUIRED', 'Propagation override requires a rationale', path, pointer + '/rationale');
    }
  };
  for (const entity of snapshot.entities.values()) {
    const childCounts = new Map<string, number>();
    const children = new Map<string, string[]>();
    for (const [id, revision] of entity.revisions) {
      childCounts.set(id, revision.meta.parents.length);
      for (const [index, parent] of revision.meta.parents.entries()) {
        if (!entity.revisions.has(parent)) issue('MISSING_PARENT', `Parent ${parent} is not a revision of ${entity.value.id}`, revision.path, `/parents/${index}`);
        const list = children.get(parent) ?? [];
        list.push(id);
        children.set(parent, list);
      }
      checkReferences(revision.references);
      const narrative = revision.meta.extensions['narrative'];
      if (narrative && revision.writable) {
        const expectKind = (target: unknown, kind: string, pointer: string): void => {
          const reference = target as { target?: SnapshotTarget } | undefined;
          if (reference?.target && snapshot.entities.has(reference.target.entity_id) && snapshot.entities.get(reference.target.entity_id)?.value.kind !== kind) issue('REFERENCE_KIND_MISMATCH', `This role requires ${kind}`, revision.path, pointer);
        };
        if (['narrative.state_event', 'narrative.knowledge_event'].includes(entity.value.kind)) expectKind(narrative['subject'], 'narrative.character', '/extensions/narrative/subject');
        const effectiveAt = narrative['effective_at'] as { scene?: unknown } | undefined;
        if (effectiveAt?.scene) expectKind(effectiveAt.scene, 'narrative.scene', '/extensions/narrative/effective_at/scene');
        if (entity.value.kind === 'narrative.reveal_event') {
          expectKind(narrative['scene'], 'narrative.scene', '/extensions/narrative/scene');
          if (![...snapshot.documents.entries()].some(([path, value]) => path.startsWith('narrative/sequences/') && (value as Sequence).id === narrative['sequence_id'])) issue('SEQUENCE_MISSING', 'Reveal sequence does not exist', revision.path, '/extensions/narrative/sequence_id');
        }
      }
    }
    const queue = [...childCounts].filter(([, count]) => count === 0).map(([id]) => id);
    let cursor = 0;
    while (cursor < queue.length) {
      const id = queue[cursor++]!;
      for (const child of children.get(id) ?? []) {
        const count = childCounts.get(child)! - 1;
        childCounts.set(child, count);
        if (count === 0) queue.push(child);
      }
    }
    if (cursor !== entity.revisions.size && !errors.some(error => error.code === 'MISSING_PARENT' && error.path.startsWith(entity.path.slice(0, entity.path.lastIndexOf('/')) + '/'))) issue('PARENT_CYCLE', 'Revision parents must be a DAG', entity.path, '');
  }
  if (!snapshot.baselines.has(snapshot.project.default_baseline_id)) issue('BASELINE_MISSING', 'Default baseline does not exist', 'project.yaml', '/default_baseline_id');
  for (const { value: baseline, path } of snapshot.baselines.values()) {
    for (const [entityId, revisionId] of Object.entries(baseline.selected)) {
      const revision = checkTarget({ entity_id: entityId, revision_id: revisionId }, path, `/selected/${entityId}`);
      if (!revision) continue;
      const severity = baseline.kind === 'release' ? 'error' : 'warning';
      if (!scopesOverlap(normalizedScope(baseline.scope), revision.meta.scope)) issue('SCOPE_MISMATCH', 'Selected revision is outside baseline scope', path, `/selected/${entityId}`, severity);
      for (const reference of revision.references) {
        if (reference.value.relation === 'depends_on' && baseline.selected[reference.value.target.entity_id] !== reference.value.target.revision_id) issue('BASELINE_DEPENDENCY_MISMATCH', 'Applied dependency does not match the baseline selection', reference.path, reference.pointer, severity);
      }
    }
  }
  // SnapshotTargets are checked for existence, without becoming dependency edges.
  for (const [path, value] of snapshot.documents) {
    const document = value as Record<string, unknown>;
    if (path.startsWith('narrative/sequences/')) {
      const references: LocatedReference[] = [];
      for (const [chapterIndex, chapter] of (value as Sequence).chapters.entries()) for (const [sceneIndex, scene] of chapter.scenes.entries()) references.push({ value: scene, path, pointer: `/chapters/${chapterIndex}/scenes/${sceneIndex}` });
      checkReferences(references);
    }
    if (path.startsWith('reviews/')) checkTarget(document['subject'] as SnapshotTarget, path, '/subject');
    if (path.includes('/proposals/')) {
      for (const [index, target] of (document['input_revisions'] as SnapshotTarget[]).entries()) checkTarget(target, path, `/input_revisions/${index}`);
      for (const [index, change] of (document['changes'] as Record<string, string>[]).entries()) {
        checkTarget({ entity_id: change['entity_id']!, revision_id: change['revision_id']! }, path, `/changes/${index}`);
        if (change['action'] === 'select_revision' && !snapshot.baselines.has(change['baseline_id']!)) issue('BASELINE_MISSING', 'Proposal baseline does not exist', path, `/changes/${index}/baseline_id`);
      }
    }
    if ('inputs' in document && 'builder_version' in document) {
      for (const [index, input] of (document['inputs'] as { target: SnapshotTarget; source_path: string; source_digest: string }[]).entries()) {
        checkTarget(input.target, path, `/inputs/${index}/target`);
        const file = snapshot.files.get(input.source_path);
        if (!file || file.digest !== input.source_digest) issue('CONTEXT_SOURCE_MISMATCH', 'Input source does not match recorded digest', path, `/inputs/${index}/source_digest`, 'warning');
      }
    }
  }
  return errors;
}
