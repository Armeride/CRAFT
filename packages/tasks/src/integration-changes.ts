import { canonicalJson } from '../../domain/src/canonical.js';
import { ValidationFailure } from '../../domain/src/model.js';
import type { ProjectSnapshot, SourceFile } from '../../domain/src/model.js';
import { checkImmutability } from '../../project-fs/src/changes.js';
import { objectFile } from '../../project-fs/src/content.js';
import { fileFailure } from '../../project-fs/src/files.js';
import { imageReferences, managedAssetPattern } from '../../project-fs/src/images.js';

function conflict(path: string, reason = 'Target and result both changed this file') {
  return fileFailure('INTEGRATION_CONFLICT', reason, path);
}

function mergedBaseline(path: string, basis: ProjectSnapshot, target: ProjectSnapshot, result: ProjectSnapshot): SourceFile {
  const original = [...basis.baselines.values()].find(item => item.path === path)?.value;
  const current = [...target.baselines.values()].find(item => item.path === path)?.value;
  const incoming = [...result.baselines.values()].find(item => item.path === path)?.value;
  if (!original || !current || !incoming) throw conflict(path);
  const { selected: base, ...baseDefinition } = original;
  const { selected: ours, ...targetDefinition } = current;
  const { selected: theirs, ...resultDefinition } = incoming;
  const baseKey = canonicalJson(baseDefinition), targetKey = canonicalJson(targetDefinition), resultKey = canonicalJson(resultDefinition);
  if (targetKey !== baseKey && resultKey !== baseKey && targetKey !== resultKey) throw conflict(path, 'Both sides changed the baseline definition');
  const definition = targetKey === baseKey ? resultDefinition : targetDefinition;
  const selected = new Map(Object.entries(ours));
  for (const id of new Set([...Object.keys(base), ...Object.keys(theirs)])) {
    if (theirs[id] === base[id] || theirs[id] === ours[id]) continue;
    if (ours[id] !== base[id]) throw conflict(path, `Both sides selected a different revision for ${id}`);
    const revision = theirs[id];
    if (revision === undefined) selected.delete(id);
    else selected.set(id, revision);
  }
  return objectFile(path, { ...definition, selected: Object.fromEntries(selected) });
}

function mergeFile(file: SourceFile, basis: ProjectSnapshot, target: ProjectSnapshot, result: ProjectSnapshot): SourceFile[] {
  const { path } = file;
  const current = target.files.get(path);
  if (current?.digest === file.digest) return [];
  if (current?.digest === basis.files.get(path)?.digest) return [file];
  if (!path.startsWith('baselines/') || !current) throw conflict(path);
  const merged = mergedBaseline(path, basis, target, result);
  return merged.digest === current.digest ? [] : [merged];
}

export function integrationChanges(basis: ProjectSnapshot, target: ProjectSnapshot, result: ProjectSnapshot, taskId: string, taskBasis = basis): SourceFile[] {
  const immutable = [...checkImmutability(basis, target), ...checkImmutability(basis, result)];
  if (immutable.length) throw new ValidationFailure(immutable);
  const includedAssets = new Set([...result.entities.values()].flatMap(entity => [...entity.revisions.values()].flatMap(revision => imageReferences(revision.body).map(image => image.path))));
  for (const path of taskBasis.files.keys()) if (!result.files.has(path)) throw fileFailure('INTEGRATION_DELETION_UNSUPPORTED', 'Preserve historical records and resolve deletions explicitly', path);
  return [...result.files.values()].flatMap(file => {
    const { path, digest } = file;
    if (digest === basis.files.get(path)?.digest || digest === taskBasis.files.get(path)?.digest) return [];
    const isAsset = managedAssetPattern.test(path);
    if (isAsset && !includedAssets.has(path)) return [];
    if (!isAsset && !/^(?:entities|baselines|reviews)\//.test(path) && !path.startsWith(`tasks/${taskId}/`)) throw fileFailure('WRITE_SCOPE_FORBIDDEN', 'Result contains unrelated project changes', path);
    return mergeFile(file, taskBasis, target, result);
  });
}
