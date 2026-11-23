import { isProjectPath } from '../../domain/src/path.js';
import type { SourceFile } from '../../domain/src/model.js';
import type { FileChangeSet } from '../../project-fs/src/changes.js';
import { fileFailure, fingerprint } from '../../project-fs/src/files.js';
import { textFile } from './source.js';
import type { MigrationSnapshot } from './types.js';

export function applyStep(input: MigrationSnapshot, changes: FileChangeSet, expectedFiles: readonly string[]): ReadonlyMap<string, SourceFile> {
  if (changes.expectedSnapshot !== fingerprint(input.files)) throw fileFailure('BASE_CHANGED', 'Step input fingerprint changed', 'project.yaml');
  const files = new Map(input.files);
  const seen = new Set<string>();
  const expected = new Set(expectedFiles);
  for (const change of changes.changes) {
    if (!isProjectPath(change.path) || !expected.has(change.path) || seen.has(change.path)) throw fileFailure('MIGRATION_CHANGE_OUT_OF_PLAN', 'Step wrote a duplicate, unsafe or undeclared path', change.path);
    seen.add(change.path);
    if ((files.get(change.path)?.digest ?? null) !== change.expectedDigest) throw fileFailure('FILE_CHANGED_EXTERNALLY', 'Step expected source digest differs', change.path);
    if (change.content === null) files.delete(change.path);
    else files.set(change.path, textFile(change.path, change.content));
  }
  return files;
}
