import native from 'fs-native-extensions';
import { lstat, mkdir, open, readFile, realpath } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileFailure, hash, newId } from '../../project-fs/src/files.js';
import { gitText, runGit } from './git.js';
import { ValidationFailure } from '../../domain/src/model.js';
import { renameWithRetry } from './fs.js';

interface Owner {
  token: string;
  pid: number;
  hostname: string;
  scope: string;
  acquiredAt: string;
  heartbeatAt: string;
  releasedAt?: string;
  recoveredPreviousLease: boolean;
}
const active = new WeakSet<Lease>();
export class Lease {
  private failure: unknown;
  constructor(readonly scope: string, readonly token: string) {}
  assert(scope: string): void {
    if (!active.has(this) || this.scope !== scope || this.failure) throw fileFailure('LOCK_LEASE_INVALID', 'Write lease is not active for this scope', 'project.yaml');
  }
  fail(error: unknown): void { this.failure = error; }
}

async function writeOwner(path: string, owner: Owner): Promise<void> {
  const temporary = `${path}.${newId('tmp')}`;
  const handle = await open(temporary, 'wx');
  try { await handle.writeFile(JSON.stringify(owner) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  await renameWithRetry(temporary, path);
}

/** The stable lock inode is never unlinked. The kernel, not a timeout or PID guess, grants ownership. */
export async function withKernelLock<T>(path: string, scope: string, action: (lease: Lease) => Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  if (await realpath(dirname(path)) !== resolve(dirname(path))) throw new Error('Lock parent is a linked path');
  try { if ((await lstat(path)).isSymbolicLink()) throw new Error('Lock path is a link'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const file = await open(path, 'a+');
  let granted = false;
  try {
    granted = native.tryLock(file.fd);
    if (!granted) throw fileFailure('WORKTREE_BUSY', 'Another process holds this OS lock; lease expiry never overrides it', 'project.yaml');
    const ownerPath = path + '.owner.json';
    let previous: Partial<Owner> | undefined;
    try { previous = JSON.parse(await readFile(ownerPath, 'utf8')) as Partial<Owner>; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const now = new Date().toISOString();
    const owner: Owner = { token: newId('lease'), pid: process.pid, hostname: hostname(), scope, acquiredAt: now, heartbeatAt: now, recoveredPreviousLease: !!previous && !previous.releasedAt };
    const lease = new Lease(scope, owner.token);
    await writeOwner(ownerPath, owner);
    active.add(lease);
    let heartbeat = Promise.resolve();
    const timer = setInterval(() => {
      heartbeat = heartbeat.then(async () => { owner.heartbeatAt = new Date().toISOString(); await writeOwner(ownerPath, owner); }).catch(error => lease.fail(error));
    }, 1000);
    timer.unref();
    try { return await action(lease); }
    finally {
      clearInterval(timer);
      await heartbeat;
      active.delete(lease);
      owner.releasedAt = new Date().toISOString();
      await writeOwner(ownerPath, owner);
    }
  } finally {
    try { if (granted) native.unlock(file.fd); } finally { await file.close(); }
  }
}

export async function gitLocations(root: string): Promise<{ root: string; commonDir: string; gitDir: string }> {
  const absolute = await realpath(root);
  const values = (await runGit(absolute, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir', '--absolute-git-dir'])).stdout.toString('utf8').trim().split(/\r?\n/);
  if (values.length !== 3 || await realpath(values[0]!) !== absolute) throw fileFailure('GIT_ROOT_REQUIRED', 'Select the exact worktree root', 'project.yaml');
  return { root: absolute, commonDir: await realpath(values[1]!), gitDir: await realpath(values[2]!) };
}
export async function worktreeScope(root: string): Promise<string> {
  const locations = await gitLocations(root);
  return `worktree:${locations.commonDir}:${relative(locations.commonDir, locations.gitDir) || '.'}`;
}
export async function withWorktreeLock<T>(root: string, action: (lease: Lease) => Promise<T>): Promise<T> {
  const locations = await gitLocations(root);
  const identity = relative(locations.commonDir, locations.gitDir) || '.';
  return withKernelLock(join(locations.commonDir, 'craft', 'locks', `worktree-${hash(identity)}.lock`), `worktree:${locations.commonDir}:${identity}`, action);
}
export async function withMetadataLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  const locations = await gitLocations(root);
  const deadline = Date.now() + 30_000;
  for (;;) {
  let entered = false;
  try { return await withKernelLock(join(locations.commonDir, 'craft', 'locks', 'metadata.lock'), `repository:${locations.commonDir}`, async () => {
    entered = true;
    // Old migration sentinels lack trustworthy lifetime evidence. Do not steal them.
    try { await lstat(join(locations.commonDir, 'craft-migration.lock')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return action(); throw error; }
    throw fileFailure('WORKTREE_BUSY', 'A legacy migration owner needs explicit inspection', 'project.yaml');
  }); } catch (error) {
    if (entered || Date.now() >= deadline || !(error instanceof ValidationFailure) || !error.diagnostics.some(d => d.code === 'WORKTREE_BUSY')) throw error;
    await new Promise(resolve => setTimeout(resolve, 25)); // wait for release, never override the kernel owner
  }
  }
}
