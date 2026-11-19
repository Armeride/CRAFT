import { canonicalJson, semanticRevision } from '../../domain/src/canonical.js';
import { isProjectPath } from '../../domain/src/path.js';
import { ValidationFailure } from '../../domain/src/model.js';
import type { Diagnostic, ProjectSnapshot, SourceFile } from '../../domain/src/model.js';
import { fileFailure, hash } from './files.js';
import { managedAssetPattern, validateManagedImage } from './images.js';
import { parseProject } from './project.js';

export interface FileChange<Content = string> {
  readonly path: string;
  readonly expectedDigest: string | null;
  readonly content: Content | null;
}
export interface FileChangeSet<Content = string> {
  readonly expectedSnapshot: string;
  readonly changes: readonly FileChange<Content>[];
}

export function sourceFromChange(path: string, content: string | Uint8Array): SourceFile {
  const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
  const asset = managedAssetPattern.exec(path);
  if (typeof content !== 'string' || asset) {
    if (!asset || typeof content === 'string' || asset[1] !== hash(bytes)) {
      throw fileFailure('ASSET_INVALID', 'Binary writes require a content-addressed managed image path', path);
    }
    validateManagedImage(bytes);
  }
  return { path, contentBase64: bytes.toString('base64'), digest: hash(bytes),
    ...(typeof content === 'string' ? { text: content } : {}) };
}

/** No migration exception yet: stage 2 will require a verified attestation. */
export function checkImmutability(before: ProjectSnapshot, after: ProjectSnapshot): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const [path, original] of before.files) {
    const immutable = managedAssetPattern.test(path) || /^entities\/[^/]+\/revisions\//.test(path) || /^reviews\/[^/]+\.yaml$/.test(path) || /^tasks\/[^/]+\/checkpoints\//.test(path);
    if (immutable && after.files.get(path)?.digest !== original.digest) diagnostics.push({ code: 'IMMUTABLE_RECORD_CHANGED', message: 'Existing revisions, reviews and checkpoints cannot be overwritten/deleted', path, pointer: '', severity: 'error' });
  }
  for (const [id, entity] of before.entities) {
    const current = after.entities.get(id);
    if (current && current.value.kind !== entity.value.kind) diagnostics.push({ code: 'IMMUTABLE_ENTITY_KIND', message: 'A new kind requires a new entity ID', path: current.path, pointer: '/kind', severity: 'error' });
  }
  return diagnostics;
}

/** Build and validate a candidate entirely in memory. Disk application/locking is stage 3. */
export function prepareChanges(snapshot: ProjectSnapshot, changeSet: FileChangeSet<string | Uint8Array>): ProjectSnapshot {
  if (snapshot.fingerprint !== changeSet.expectedSnapshot) throw fileFailure('BASE_CHANGED', 'Snapshot fingerprint does not match the expected basis', 'project.yaml');
  if (!snapshot.writable && changeSet.changes.length) throw fileFailure('PROJECT_READ_ONLY', 'Required extension support is missing', 'project.yaml');
  const files = new Map(snapshot.files);
  const seen = new Set<string>();
  for (const change of changeSet.changes) {
    if (!isProjectPath(change.path) || !(change.path === 'project.yaml' || change.path === 'README.md' || change.path === '.gitignore' || /^(?:entities|baselines|reviews|narrative|tasks|skills|integrations|schemas|migrations|assets)\//.test(change.path))) throw fileFailure('PATH_ESCAPE', 'Change is outside canonical project paths', change.path);
    if (seen.has(change.path)) throw fileFailure('DUPLICATE_CHANGE', 'Path appears twice in a change set', change.path);
    seen.add(change.path);
    const original = files.get(change.path);
    if ((original?.digest ?? null) !== change.expectedDigest) throw fileFailure('FILE_CHANGED_EXTERNALLY', 'Expected file digest differs from captured source', change.path);
    for (const entity of snapshot.entities.values()) {
      const prefix = entity.path.slice(0, entity.path.lastIndexOf('/') + 1);
      if (change.path.startsWith(prefix) && [...entity.revisions.values()].some(revision => !revision.writable)) throw fileFailure('ENTITY_READ_ONLY', 'Entity contains an unsupported extension; preserve its bytes', change.path);
    }
    if (change.content === null) files.delete(change.path);
    else {
      const file = sourceFromChange(change.path, change.content);
      files.set(change.path, file);
    }
  }
  // Compare immutable bytes before parsing so even malformed manual edits get this diagnostic.
  const rawCandidate = { ...snapshot, files };
  const immutable = checkImmutability(snapshot, rawCandidate);
  if (immutable.length) throw new ValidationFailure(immutable);
  const result = parseProject(files);
  const kindChanges = checkImmutability(snapshot, result);
  if (kindChanges.length) throw new ValidationFailure(kindChanges);
  return result;
}

export const semanticDigest = (snapshot: ProjectSnapshot, entityId: string, revisionId: string): string => {
  const entity = snapshot.entities.get(entityId);
  const revision = entity?.revisions.get(revisionId);
  if (!entity || !revision) throw new Error('REVISION_NOT_FOUND');
  if (!revision.writable) throw new Error('SEMANTIC_MODEL_UNSUPPORTED');
  return hash(canonicalJson(semanticRevision(revision, entity.value.kind)));
};

export function dependencyManifestDigest(snapshot: ProjectSnapshot, entityId: string, revisionId: string): string {
  const root = snapshot.entities.get(entityId)?.revisions.get(revisionId);
  if (!root) throw new Error('REVISION_NOT_FOUND');
  const inputs = new Map<string, { entity_id: string; revision_id: string; semantic_digest: string }>();
  const queue = [root];
  const visited = new Set<string>();
  for (let index = 0; index < queue.length; index++) {
    const revision = queue[index]!;
    const key = `${revision.meta.entity_id}/${revision.meta.revision_id}`;
    if (visited.has(key)) continue;
    visited.add(key);
    for (const reference of revision.references) {
      if (reference.value.relation !== 'depends_on') continue;
      const { entity_id, revision_id } = reference.value.target;
      const target = snapshot.entities.get(entity_id)?.revisions.get(revision_id);
      if (!target) throw new Error('MISSING_TARGET');
      inputs.set(`${entity_id}/${revision_id}`, { entity_id, revision_id, semantic_digest: semanticDigest(snapshot, entity_id, revision_id) });
      queue.push(target);
    }
  }
  return hash(canonicalJson([...inputs.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value)));
}
