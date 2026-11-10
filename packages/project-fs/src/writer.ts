import { mkdir, readFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson } from '../../domain/src/canonical.js';
import type { SourceFile } from '../../domain/src/model.js';
import { ValidationFailure } from '../../domain/src/model.js';
import { isProjectPath } from '../../domain/src/path.js';
import { Lease, worktreeScope } from '../../git-workspace/src/locks.js';
import { assertOwnedPath, checkedManagedRoot } from '../../git-workspace/src/worktree.js';
import { gitText } from '../../git-workspace/src/git.js';
import { atomicText, readState, writeState } from '../../workspace-runtime/src/state.js';
import type { Transaction } from '../../workspace-runtime/src/generated.js';
import { prepareChanges } from './changes.js';
import type { FileChangeSet } from './changes.js';
import { captureFiles, FILE_LIMITS, fileFailure, fingerprint, hash, isCanonicalPath, newId } from './files.js';
import { parseProject } from './project.js';

const projectFiles = (files: ReadonlyMap<string, SourceFile>): ReadonlyMap<string, SourceFile> => new Map([...files].filter(([path]) => isCanonicalPath(path)));
const matches = (a: SourceFile | undefined, b: SourceFile | null): boolean => (a?.digest ?? null) === (b?.digest ?? null);
export interface WriteOptions {
  scopeId: string;
  allowedPrefixes: readonly string[];
  onPhase?: (phase: 'prepared' | 'written', path: string) => Promise<void>;
}
async function transactions(stateRoot: string): Promise<Transaction[]> {
  let files: string[];
  try { files = await readdir(join(stateRoot, 'transactions')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const values = await Promise.all(files.filter(path => /^tx_[a-f0-9-]+\.json$/.test(path)).map(path => readState<Transaction>(stateRoot, join(stateRoot, 'transactions', path), 'Transaction')));
  return values;
}
export async function pendingTransactions(stateRoot: string): Promise<Transaction[]> {
  return (await transactions(stateRoot)).filter(value => value.state !== 'applied');
}
export async function assertSavedRecords(stateRoot: string, current: ReadonlyMap<string, SourceFile>): Promise<void> {
  for (const journal of await transactions(stateRoot)) for (const edit of journal.edits) {
    if (journal.state !== 'applied' || !edit.after || !(/^(?:entities\/[^/]+\/revisions\/|reviews\/|tasks\/[^/]+\/checkpoints\/)/.test(edit.path))) continue;
    if (current.get(edit.path)?.digest !== edit.after.digest) throw fileFailure('IMMUTABLE_RECORD_CHANGED', 'A saved revision/review/checkpoint was edited externally', edit.path);
  }
}
export async function assertNoPending(stateRoot: string): Promise<void> {
  if ((await pendingTransactions(stateRoot)).length) throw fileFailure('RECOVERY_REQUIRED', 'Unfinished write journal blocks reads and further writes', 'project.yaml');
}

function validateCandidate(before: ReadonlyMap<string, SourceFile>, after: ReadonlyMap<string, SourceFile>, changes: FileChangeSet): void {
  if (after.size > FILE_LIMITS.files) throw fileFailure('SOURCE_SIZE_LIMIT', 'Write candidate exceeds capture file limit', 'project.yaml');
  let bytes = 0;
  const portable = new Set<string>();
  for (const [path, file] of after) {
    const size = Buffer.byteLength(file.contentBase64, 'base64'); bytes += size;
    if (size > FILE_LIMITS.fileBytes || bytes > FILE_LIMITS.totalBytes || path.split('/').length > FILE_LIMITS.depth + 1) throw fileFailure('SOURCE_SIZE_LIMIT', 'Write candidate exceeds capture byte/depth limits', path);
    const key = path.normalize('NFC').toLowerCase();
    if (portable.has(key)) throw fileFailure('PATH_COLLISION', 'Case/Unicode path collision in write candidate', path);
    portable.add(key);
    const parts = path.split('/');
    for (let index = 1; index < parts.length; index++) if (after.has(parts.slice(0, index).join('/'))) throw fileFailure('PATH_COLLISION', 'A file cannot also be a parent directory', path);
  }
  if (before.has('project.yaml')) prepareChanges(parseProject(projectFiles(before)), changes);
  else {
    // Bootstrap/import can add a project but cannot overwrite pre-existing source files.
    for (const change of changes.changes) if (before.has(change.path)) throw fileFailure('BOOTSTRAP_OVERWRITE', 'Import must preserve existing file bytes', change.path);
    parseProject(projectFiles(after));
  }
}

export async function applyTransaction(root: string, stateRoot: string, lease: Lease, changes: FileChangeSet, options: WriteOptions): Promise<string> {
  lease.assert(await worktreeScope(root));
  await checkedManagedRoot(stateRoot, root);
  await assertNoPending(stateRoot);
  const before = await captureFiles(root, false);
  if (changes.expectedSnapshot !== fingerprint(projectFiles(before))) throw fileFailure('BASE_CHANGED', 'Working snapshot changed before write', 'project.yaml');
  const after = new Map(before);
  const edits: Transaction['edits'] = [];
  const paths = new Set<string>();
  for (const change of changes.changes) {
    if (!isProjectPath(change.path) || change.path.split('/').some(part => part.toLowerCase() === '.git') || !options.allowedPrefixes.some(prefix => change.path === prefix || change.path.startsWith(prefix.endsWith('/') ? prefix : prefix + '/')) || paths.has(change.path)) throw fileFailure('WRITE_SCOPE_FORBIDDEN', 'Duplicate, unsafe or out-of-scope write', change.path);
    paths.add(change.path);
    if ((before.get(change.path)?.digest ?? null) !== change.expectedDigest) throw fileFailure('FILE_CHANGED_EXTERNALLY', 'Expected file digest no longer matches', change.path);
    const next: SourceFile | null = change.content === null ? null : { path: change.path, text: change.content, contentBase64: Buffer.from(change.content).toString('base64'), digest: hash(change.content) };
    if (next) after.set(change.path, next); else after.delete(change.path);
    edits.push({ path: change.path, before: before.get(change.path) ?? null, after: next });
  }
  validateCandidate(before, after, changes);
  const id = newId('tx');
  const transaction: Transaction = { protocol: 1, id, scopeId: options.scopeId, root, branch: await gitText(root, ['symbolic-ref', '--short', 'HEAD']), beforeFingerprint: fingerprint(before), afterFingerprint: fingerprint(after), state: 'prepared', edits, completed: [], createdAt: new Date().toISOString() };
  const path = join(stateRoot, 'transactions', `${id}.json`);
  await writeState(stateRoot, path, 'Transaction', transaction);
  await options.onPhase?.('prepared', path);
  await finish(root, stateRoot, lease, transaction, options);
  return id;
}

async function finish(root: string, stateRoot: string, lease: Lease, transaction: Transaction, options: WriteOptions): Promise<void> {
  const scope = await worktreeScope(root);
  lease.assert(scope);
  const journalPath = join(stateRoot, 'transactions', transaction.id + '.json');
  if (transaction.root !== root || transaction.scopeId !== options.scopeId || transaction.branch !== await gitText(root, ['symbolic-ref', '--short', 'HEAD'])) throw fileFailure('JOURNAL_SCOPE_MISMATCH', 'Journal belongs to a different run/branch', 'project.yaml');
  let current = await captureFiles(root, false);
  const reconstructed = new Map(current);
  const changes: FileChangeSet['changes'][number][] = [];
  const seen = new Set<string>();
  for (const edit of transaction.edits) {
    if (seen.has(edit.path)) throw fileFailure('JOURNAL_INVALID', 'Duplicate journal path', edit.path);
    seen.add(edit.path);
    if (!isProjectPath(edit.path) || !options.allowedPrefixes.some(prefix => edit.path === prefix || edit.path.startsWith(prefix.endsWith('/') ? prefix : prefix + '/'))) throw fileFailure('JOURNAL_SCOPE_MISMATCH', 'Journal write path is outside this run', edit.path);
    if (!matches(current.get(edit.path), edit.before) && !matches(current.get(edit.path), edit.after)) {
      transaction.state = 'conflict'; transaction.error = 'FILE_CHANGED_EXTERNALLY';
      await writeState(stateRoot, journalPath, 'Transaction', transaction);
      throw fileFailure('FILE_CHANGED_EXTERNALLY', 'Recovery preserves an externally changed file instead of overwriting it', edit.path);
    }
    for (const file of [edit.before, edit.after]) if (file) {
      const bytes = Buffer.from(file.contentBase64, 'base64');
      if (file.path !== edit.path || hash(bytes) !== file.digest || (file.text !== undefined && hash(file.text) !== file.digest && file.text !== new TextDecoder('utf8', { fatal: true }).decode(bytes))) throw fileFailure('JOURNAL_INVALID', 'Journal byte fingerprints are inconsistent', edit.path);
    }
    if (edit.after && edit.after.text === undefined) throw fileFailure('JOURNAL_INVALID', 'Text writer requires a UTF-8 after image', edit.path);
    if (edit.before) reconstructed.set(edit.path, edit.before); else reconstructed.delete(edit.path);
    changes.push({ path: edit.path, expectedDigest: edit.before?.digest ?? null, content: edit.after?.text ?? null });
  }
  if (fingerprint(reconstructed) !== transaction.beforeFingerprint) throw fileFailure('FILE_CHANGED_EXTERNALLY', 'An unrelated source file changed during the interrupted write', 'project.yaml');
  const desired = new Map(reconstructed);
  for (const edit of transaction.edits) if (edit.after) desired.set(edit.path, edit.after); else desired.delete(edit.path);
  if (fingerprint(desired) !== transaction.afterFingerprint) throw fileFailure('JOURNAL_INVALID', 'Journal candidate fingerprint is inconsistent', 'project.yaml');
  validateCandidate(reconstructed, desired, { expectedSnapshot: fingerprint(projectFiles(reconstructed)), changes });
  transaction.state = 'writing';
  await writeState(stateRoot, journalPath, 'Transaction', transaction);
  for (const edit of transaction.edits) {
    lease.assert(scope);
    current = await captureFiles(root, false);
    if (!matches(current.get(edit.path), edit.before) && !matches(current.get(edit.path), edit.after)) throw fileFailure('FILE_CHANGED_EXTERNALLY', 'File changed just before replacement', edit.path);
    const target = join(root, ...edit.path.split('/'));
    await assertOwnedPath(root, target);
    if (!matches(current.get(edit.path), edit.after)) {
      if (edit.after) await atomicText(root, target, edit.after.text!);
      else await unlink(target);
    }
    if (!transaction.completed.includes(edit.path)) transaction.completed.push(edit.path);
    await writeState(stateRoot, journalPath, 'Transaction', transaction);
    await options.onPhase?.('written', edit.path);
  }
  if (fingerprint(await captureFiles(root, false)) !== transaction.afterFingerprint) throw fileFailure('FILE_CHANGED_EXTERNALLY', 'Source changed before transaction completion', 'project.yaml');
  if (transaction.branch !== await gitText(root, ['symbolic-ref', '--short', 'HEAD'])) throw fileFailure('JOURNAL_SCOPE_MISMATCH', 'Workspace branch changed during write', 'project.yaml');
  transaction.state = 'applied'; delete transaction.error;
  await writeState(stateRoot, journalPath, 'Transaction', transaction);
}
export async function recoverTransactions(root: string, stateRoot: string, lease: Lease, options: WriteOptions): Promise<string[]> {
  lease.assert(await worktreeScope(root));
  const recovered: string[] = [];
  for (const transaction of await pendingTransactions(stateRoot)) { await finish(root, stateRoot, lease, transaction, options); recovered.push(transaction.id); }
  return recovered;
}
