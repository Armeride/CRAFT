import { lstat, mkdir, open, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { canonicalJson } from '../../domain/src/canonical.js';
import { isProjectPath } from '../../domain/src/path.js';
import type { SourceFile } from '../../domain/src/model.js';
import { captureFiles, fileFailure, fingerprint, hash, newId } from '../../project-fs/src/files.js';
import { gitText, runGit } from './git.js';

export interface RepositoryGuard {
  readonly root: string;
  readonly commonDir: string;
  readonly commit: string;
  readonly indexDigest: string | null;
  readonly status: string;
  readonly fingerprint: string;
}
const oid = (value: string): string => {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) throw new Error('Invalid Git object ID');
  return value;
};
async function indexDigest(root: string): Promise<string | null> {
  const path = await gitText(root, ['rev-parse', '--git-path', 'index']);
  try { return hash(await readFile(isAbsolute(path) ? path : resolve(root, path))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
export async function repositoryGuard(root: string, requireClean = true): Promise<RepositoryGuard> {
  const absolute = await realpath(root);
  const top = await realpath(await gitText(absolute, ['rev-parse', '--show-toplevel']));
  if (absolute !== top) throw fileFailure('GIT_ROOT_REQUIRED', 'Select the repository/worktree root', 'project.yaml');
  const common = await gitText(top, ['rev-parse', '--git-common-dir']);
  const status = (await runGit(top, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).stdout.toString('utf8');
  if (requireClean && status) throw fileFailure('WORKTREE_DIRTY', 'Migration requires a clean committed basis; no automatic stash is performed', 'project.yaml');
  return { root: top, commonDir: await realpath(isAbsolute(common) ? common : resolve(top, common)), commit: oid(await gitText(top, ['rev-parse', '--verify', 'HEAD^{commit}'])), indexDigest: await indexDigest(top), status, fingerprint: fingerprint(await captureFiles(top)) };
}
export async function assertSourceUnchanged(before: RepositoryGuard): Promise<void> {
  const after = await repositoryGuard(before.root, false);
  if (canonicalJson(before) !== canonicalJson(after)) throw fileFailure('BASE_CHANGED', 'Source HEAD/index/working files changed; migration result remains isolated', 'project.yaml');
}

export async function withRepositoryLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  const common = await gitText(root, ['rev-parse', '--git-common-dir']);
  const path = join(await realpath(isAbsolute(common) ? common : resolve(root, common)), 'craft-migration.lock');
  const token = newId('lock');
  let handle;
  try { handle = await open(path, 'wx'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw fileFailure('WORKTREE_BUSY', 'Migration metadata lock exists; it is never stolen on a timeout', 'project.yaml'); throw error; }
  try {
    await handle.writeFile(JSON.stringify({ token, pid: process.pid }) + '\n');
    await handle.sync();
    await handle.close();
    return await action();
  } finally {
    await handle.close().catch(() => {});
    const value = JSON.parse(await readFile(path, 'utf8')) as { token: string };
    if (value.token !== token) throw fileFailure('MIGRATION_LOCK_CHANGED', 'Lock owner changed; refusing to remove it', 'project.yaml');
    await unlink(path);
  }
}

export async function checkedManagedRoot(path: string, sourceRoot: string): Promise<string> {
  const expected = resolve(path);
  if (expected === sourceRoot || expected.startsWith(sourceRoot + sep)) throw fileFailure('MANAGED_ROOT_INVALID', 'Managed worktrees must be outside the source worktree', 'project.yaml');
  await mkdir(expected, { recursive: true });
  const actual = await realpath(expected);
  if (actual !== expected || (await lstat(expected)).isSymbolicLink()) throw fileFailure('MANAGED_ROOT_INVALID', 'Managed root must not be a symlink/junction', 'project.yaml');
  return actual;
}
export async function assertOwnedPath(managedRoot: string, target: string): Promise<void> {
  const base = await realpath(managedRoot);
  const absolute = resolve(target);
  if (absolute === base || !absolute.startsWith(base + sep)) throw new Error('Managed path escape');
  let current = base;
  for (const component of relative(base, absolute).split(sep)) {
    current = join(current, component);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Managed path contains a link'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}

/** The caller owns this newly created tree. No checkout filters/hooks or source writes. */
export async function materializeFiles(root: string, files: ReadonlyMap<string, SourceFile>): Promise<void> {
  for (const [path, file] of files) {
    if (!isProjectPath(path) || path.split('/').some(part => part.toLowerCase() === '.git')) throw new Error('Unsafe materialization path');
    const target = join(root, ...path.split('/'));
    await assertOwnedPath(root, target);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(file.contentBase64, 'base64'), { flag: 'wx' });
  }
}
export interface ScratchWorkspace { path: string; branch: string; baseCommit: string; sourceRoot: string }
export async function createMigrationWorktree(source: RepositoryGuard, managedRoot: string, runId: string, allFiles: ReadonlyMap<string, SourceFile>): Promise<ScratchWorkspace> {
  if (!/^mig_[a-f0-9-]+$/.test(runId)) throw new Error('Invalid migration run ID');
  const path = join(managedRoot, 'worktrees', runId);
  const branch = `workbench/migration/${runId}`;
  await assertOwnedPath(managedRoot, path);
  await mkdir(dirname(path), { recursive: true });
  await runGit(source.root, ['worktree', 'add', '--no-checkout', '-b', branch, path, source.commit]);
  await runGit(path, ['read-tree', source.commit]);
  await materializeFiles(path, allFiles);
  return { path, branch, baseCommit: source.commit, sourceRoot: source.root };
}

/** Preserve all untouched index entries; hash raw bytes without clean filters. */
export async function commitMigration(workspace: ScratchWorkspace, changes: readonly { path: string; file: SourceFile | null }[], message: string): Promise<string> {
  if (await gitText(workspace.path, ['rev-parse', 'HEAD']) !== workspace.baseCommit) throw fileFailure('BASE_CHANGED', 'Migration branch moved before commit', 'project.yaml');
  const lines: string[] = [];
  for (const { path, file } of changes) {
    if (!isProjectPath(path)) throw new Error('Unsafe index path');
    if (file) {
      const object = oid((await runGit(workspace.path, ['hash-object', '--no-filters', '-w', '--stdin'], Buffer.from(file.contentBase64, 'base64'))).stdout.toString('ascii').trim());
      const existing = await runGit(workspace.path, ['ls-files', '--stage', '--', path]);
      const mode = /^(100644|100755) /.exec(existing.stdout.toString('utf8'))?.[1] ?? '100644';
      lines.push(`${mode} ${object}\t${path}\0`);
    } else lines.push(`0 ${'0'.repeat(workspace.baseCommit.length)}\t${path}\0`);
  }
  await runGit(workspace.path, ['update-index', '-z', '--index-info'], Buffer.from(lines.join('')));
  const tree = oid(await gitText(workspace.path, ['write-tree']));
  const commit = oid((await runGit(workspace.path, ['commit-tree', tree, '-p', workspace.baseCommit], Buffer.from(message + '\n'), { GIT_AUTHOR_NAME: 'CRAFT Migration', GIT_AUTHOR_EMAIL: 'migration@localhost', GIT_COMMITTER_NAME: 'CRAFT Migration', GIT_COMMITTER_EMAIL: 'migration@localhost' })).stdout.toString('ascii').trim());
  await runGit(workspace.path, ['update-ref', `refs/heads/${workspace.branch}`, commit, workspace.baseCommit]);
  return commit;
}

/** Only a clean, committed, app-namespaced worktree is removable. The branch is retained. */
export async function removePreservedMigration(managedRoot: string, workspace: ScratchWorkspace, resultCommit: string): Promise<void> {
  await assertOwnedPath(managedRoot, workspace.path);
  if (!/^workbench\/migration\/mig_[a-f0-9-]+$/.test(workspace.branch) || resolve(workspace.path) !== join(await realpath(managedRoot), 'worktrees', workspace.branch.split('/').at(-1)!)) throw new Error('Workspace ownership mismatch');
  const runId = workspace.branch.split('/').at(-1)!;
  const journal = JSON.parse(await readFile(join(managedRoot, 'runs', runId, 'run.json'), 'utf8')) as { state?: string; resultCommit?: string; workspace?: ScratchWorkspace };
  if (journal.state !== 'completed' || journal.resultCommit !== resultCommit || journal.workspace?.path !== workspace.path || journal.workspace.branch !== workspace.branch) throw fileFailure('WORKTREE_UNPRESERVED', 'Run is not recorded as a committed, completed migration', 'project.yaml');
  if (await gitText(workspace.path, ['symbolic-ref', '--short', 'HEAD']) !== workspace.branch || await gitText(workspace.path, ['rev-parse', 'HEAD']) !== resultCommit) throw new Error('Preserved result commit does not match');
  await runGit(workspace.path, ['cat-file', '-e', `${resultCommit}:migrations/history/${runId}.yaml`]);
  const status = (await runGit(workspace.path, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching'])).stdout;
  if (status.length) throw fileFailure('WORKTREE_UNPRESERVED', 'Dirty/untracked/ignored data remains; refusing cleanup', 'project.yaml');
  if ((await repositoryGuard(workspace.sourceRoot, false)).commonDir !== (await repositoryGuard(workspace.path, false)).commonDir) throw new Error('Source repository ownership mismatch');
  await withRepositoryLock(workspace.sourceRoot, () => runGit(workspace.sourceRoot, ['worktree', 'remove', '--', workspace.path]).then(() => undefined));
}
