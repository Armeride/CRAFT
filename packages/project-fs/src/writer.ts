import { lstat, mkdir, readFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson } from '../../domain/src/canonical.js';
import type { SourceFile } from '../../domain/src/model.js';
import { ValidationFailure } from '../../domain/src/model.js';
import { isProjectPath } from '../../domain/src/path.js';
import { Lease, worktreeScope } from '../../git-workspace/src/locks.js';
import { assertOwnedPath, checkedManagedRoot } from '../../git-workspace/src/worktree.js';
import { gitText } from '../../git-workspace/src/git.js';
import { markSourceChanged } from '../../git-workspace/src/generation.js';
import { atomicBytes, readState, writeState } from '../../workspace-runtime/src/state.js';
import type { Transaction } from '../../workspace-runtime/src/generated.js';
import { sourceFromChange, prepareChanges } from './changes.js';
import type { FileChangeSet } from './changes.js';
import { captureFiles, FILE_LIMITS, fileFailure, fingerprint, hash, isCanonicalPath, newId, readSource } from './files.js';
import { parseProject } from './project.js';

const projectFiles = (files: ReadonlyMap<string, SourceFile>): ReadonlyMap<string, SourceFile> => new Map([...files].filter(([path]) => isCanonicalPath(path)));
const matches = (a: SourceFile | undefined, b: SourceFile | null): boolean => (a?.digest ?? null) === (b?.digest ?? null);
/** One file's current bytes, or undefined when it is absent. Never follows project symlinks. */
async function currentSource(root: string, path: string): Promise<SourceFile | undefined> {
  try { return await readSource(root, path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return undefined; }
    throw error;
  }
}
export interface WriteOptions {
  scopeId: string;
  allowedPrefixes: readonly string[];
  onPhase?: (phase: 'prepared' | 'written', path: string) => Promise<void>;
}
const SAVED_RECORD = /^(?:entities\/[^/]+\/revisions\/|reviews\/|tasks\/[^/]+\/checkpoints\/)/;
/** What the read checks need from a journal. Only recovery needs the full journal with file bytes. */
interface JournalSummary { state: Transaction['state']; savedRecords: readonly (readonly [path: string, digest: string])[] }
/**
 * Parsed summaries keyed by journal path and stat identity. Every journal write replaces the file
 * (new inode, size or timestamps), so an unchanged identity means unchanged bytes; any change
 * re-reads and re-validates the journal. Applied journals are never rewritten, so after the first
 * read a check costs one lstat per journal instead of parsing every journal again.
 */
const summaries = new Map<string, { identity: string; summary: JournalSummary }>();
async function journalIdentity(path: string): Promise<string | undefined> {
  const stat = await lstat(path, { bigint: true });
  return stat.isFile() ? [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':') : undefined;
}
function summarize(journal: Transaction): JournalSummary {
  const savedRecords = journal.state === 'applied' ? journal.edits.flatMap(edit => edit.after && SAVED_RECORD.test(edit.path) ? [[edit.path, edit.after.digest] as const] : []) : [];
  return { state: journal.state, savedRecords };
}
async function journalPaths(stateRoot: string): Promise<string[]> {
  const directory = await assertOwnedPath(stateRoot, join(stateRoot, 'transactions'));
  let files: string[];
  try { files = await readdir(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return []; }
    throw error;
  }
  return files.filter(path => /^tx_[a-f0-9-]+\.json$/.test(path)).map(path => join(directory, path));
}
/** Reads and validates the full journal, caching its summary only if the file did not change meanwhile. */
async function readJournal(stateRoot: string, path: string): Promise<Transaction> {
  const before = await journalIdentity(path);
  const journal = await readState<Transaction>(stateRoot, path, 'Transaction');
  const after = await journalIdentity(path);
  if (before !== undefined && before === after) summaries.set(path, { identity: before, summary: summarize(journal) });
  else summaries.delete(path);
  return journal;
}
async function journalEntry(stateRoot: string, path: string): Promise<{ path: string; summary: JournalSummary; journal?: Transaction }> {
  const identity = await journalIdentity(path), cached = summaries.get(path);
  if (identity !== undefined && cached?.identity === identity) return { path, summary: cached.summary };
  const journal = await readJournal(stateRoot, path);
  return { path, summary: summarize(journal), journal };
}
const journalEntries = async (stateRoot: string) => Promise.all((await journalPaths(stateRoot)).map(path => journalEntry(stateRoot, path)));
export async function pendingTransactions(stateRoot: string): Promise<Transaction[]> {
  const pending = (await journalEntries(stateRoot)).filter(entry => entry.summary.state !== 'applied');
  return Promise.all(pending.map(entry => entry.journal ? Promise.resolve(entry.journal) : readJournal(stateRoot, entry.path)));
}
export async function assertSavedRecords(stateRoot: string, current: ReadonlyMap<string, SourceFile>): Promise<void> {
  for (const { summary } of await journalEntries(stateRoot)) for (const [path, digest] of summary.savedRecords) {
    if (current.get(path)?.digest !== digest) throw fileFailure('IMMUTABLE_RECORD_CHANGED', 'A saved revision/review/checkpoint was edited externally', path);
  }
}
export async function assertNoPending(stateRoot: string): Promise<void> {
  if ((await journalEntries(stateRoot)).some(entry => entry.summary.state !== 'applied')) throw fileFailure('RECOVERY_REQUIRED', 'Unfinished write journal blocks reads and further writes', 'project.yaml');
}

function validateCandidate(before: ReadonlyMap<string, SourceFile>, after: ReadonlyMap<string, SourceFile>, changes: FileChangeSet<string | Uint8Array>): void {
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

export async function applyTransaction(root: string, stateRoot: string, lease: Lease, changes: FileChangeSet<string | Uint8Array>, options: WriteOptions): Promise<string> {
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
    const next = change.content === null ? null : sourceFromChange(change.path, change.content);
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
  const current = await captureFiles(root, false);
  const reconstructed = new Map(current);
  const changes: FileChangeSet<string | Uint8Array>['changes'][number][] = [];
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
    if (edit.after) sourceFromChange(edit.path, edit.after.text ?? Buffer.from(edit.after.contentBase64, 'base64'));
    if (edit.before) reconstructed.set(edit.path, edit.before); else reconstructed.delete(edit.path);
    changes.push({ path: edit.path, expectedDigest: edit.before?.digest ?? null, content: edit.after ? edit.after.text ?? Buffer.from(edit.after.contentBase64, 'base64') : null });
  }
  if (fingerprint(reconstructed) !== transaction.beforeFingerprint) throw fileFailure('FILE_CHANGED_EXTERNALLY', 'An unrelated source file changed during the interrupted write', 'project.yaml');
  const desired = new Map(reconstructed);
  for (const edit of transaction.edits) if (edit.after) desired.set(edit.path, edit.after); else desired.delete(edit.path);
  if (fingerprint(desired) !== transaction.afterFingerprint) throw fileFailure('JOURNAL_INVALID', 'Journal candidate fingerprint is inconsistent', 'project.yaml');
  validateCandidate(reconstructed, desired, { expectedSnapshot: fingerprint(projectFiles(reconstructed)), changes });
  transaction.state = 'writing';
  await writeState(stateRoot, journalPath, 'Transaction', transaction);
  // Recovery decides per file from its digest (before or after), so the journal is persisted at
  // phase changes only. Re-reading one file here keeps the external-edit check without a full capture.
  for (const edit of transaction.edits) {
    lease.assert(scope);
    const existing = await currentSource(root, edit.path);
    if (!matches(existing, edit.before) && !matches(existing, edit.after)) throw fileFailure('FILE_CHANGED_EXTERNALLY', 'File changed just before replacement', edit.path);
    const target = join(root, ...edit.path.split('/'));
    await assertOwnedPath(root, target);
    if (!matches(existing, edit.after)) {
      if (edit.after) await atomicBytes(root, target, Buffer.from(edit.after.contentBase64, 'base64'));
      else await unlink(target);
    }
    if (!transaction.completed.includes(edit.path)) transaction.completed.push(edit.path);
    await options.onPhase?.('written', edit.path);
  }
  if (fingerprint(await captureFiles(root, false)) !== transaction.afterFingerprint) throw fileFailure('FILE_CHANGED_EXTERNALLY', 'Source changed before transaction completion', 'project.yaml');
  if (transaction.branch !== await gitText(root, ['symbolic-ref', '--short', 'HEAD'])) throw fileFailure('JOURNAL_SCOPE_MISMATCH', 'Workspace branch changed during write', 'project.yaml');
  transaction.state = 'applied'; delete transaction.error;
  if (transaction.edits.some(edit => edit.before?.digest !== edit.after?.digest)) await markSourceChanged(root, lease);
  await writeState(stateRoot, journalPath, 'Transaction', transaction);
}
export async function recoverTransactions(root: string, stateRoot: string, lease: Lease, options: WriteOptions): Promise<string[]> {
  lease.assert(await worktreeScope(root));
  const recovered: string[] = [];
  for (const transaction of await pendingTransactions(stateRoot)) { await finish(root, stateRoot, lease, transaction, options); recovered.push(transaction.id); }
  return recovered;
}
