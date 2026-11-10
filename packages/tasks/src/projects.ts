import { access, mkdir, readFile, readdir, realpath } from 'node:fs/promises';
import { join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Registration, Run } from '../../workspace-runtime/src/generated.js';
import { readState, writeState } from '../../workspace-runtime/src/state.js';
import { gitText, runGit } from '../../git-workspace/src/git.js';
import { withMetadataLock } from '../../git-workspace/src/locks.js';
import { assertOwnedPath, checkedManagedRoot, materializeFiles } from '../../git-workspace/src/worktree.js';
import { loadCommittedProject, readCommittedFiles } from '../../project-fs/src/git-baseline.js';
import { fileFailure, newId } from '../../project-fs/src/files.js';

export async function getRegistration(appData: string, id: string): Promise<Registration> {
  if (!/^reg_[a-f0-9-]+$/.test(id)) throw new Error('Invalid registration ID');
  const root = await realpath(appData);
  return readState<Registration>(root, join(root, 'registrations', id + '.json'), 'Registration');
}
async function inspect(root: string): Promise<Omit<Registration, 'protocol' | 'id' | 'createdAt'>> {
  const absolute = await realpath(root);
  if (absolute !== await realpath(await gitText(absolute, ['rev-parse', '--show-toplevel']))) throw fileFailure('GIT_ROOT_REQUIRED', 'Select the exact Git worktree root', 'project.yaml');
  const common = await gitText(absolute, ['rev-parse', '--git-common-dir']);
  let selectedRef: string | null = null;
  try { selectedRef = await gitText(absolute, ['symbolic-ref', '--quiet', 'HEAD']); } catch {}
  let head: string | null = null;
  try { head = await gitText(absolute, ['rev-parse', '--verify', 'HEAD^{commit}']); } catch {}
  const value = { root: absolute, commonDir: await realpath(isAbsolute(common) ? common : resolve(absolute, common)), selectedRef, head };
  if (!head) return { ...value, projectId: null, status: 'unborn' };
  const files = await readCommittedFiles(absolute, head);
  if (!files.has('project.yaml')) return { ...value, projectId: null, status: 'import_required' };
  try {
    const snapshot = await loadCommittedProject(absolute, head);
    return { ...value, projectId: snapshot.project.project_id, status: snapshot.writable ? 'ready' : 'unsupported' };
  } catch (error) {
    const text = String(error);
    return { ...value, projectId: null, status: text.includes('SCHEMA_UNSUPPORTED') ? 'unsupported' : 'invalid' };
  }
}
export async function registerLocal(appData: string, root: string): Promise<Registration> {
  const current = await inspect(root);
  const storage = await checkedManagedRoot(appData, current.root);
  await mkdir(join(storage, 'registrations'), { recursive: true });
  for (const file of await readdir(join(storage, 'registrations'))) {
    if (!/^reg_[a-f0-9-]+\.json$/.test(file)) continue;
    const old = await readState<Registration>(storage, join(storage, 'registrations', file), 'Registration');
    if (old.root === current.root) {
      if (old.projectId && current.projectId && old.projectId !== current.projectId) throw fileFailure('PROJECT_ID_CHANGED', 'Registered project identity changed', 'project.yaml');
      const updated: Registration = { ...old, ...current };
      await writeState(storage, join(storage, 'registrations', old.id + '.json'), 'Registration', updated);
      return updated;
    }
  }
  const registration: Registration = { protocol: 1, id: newId('reg'), ...current, createdAt: new Date().toISOString() };
  await writeState(storage, join(storage, 'registrations', registration.id + '.json'), 'Registration', registration);
  return registration;
}

export function validateCloneUrl(input: string, allowFile = false): { url: string; protocol: 'https' | 'ssh' | 'file' } {
  if (/[\u0000-\u0020]/.test(input) || input.includes('::') || input.startsWith('-')) throw new Error('CLONE_URL_FORBIDDEN');
  if (/^[a-zA-Z0-9._][a-zA-Z0-9._-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*:[a-zA-Z0-9_./-]+$/.test(input)) return { url: input, protocol: 'ssh' };
  const url = new URL(input);
  if (url.password || url.search || url.hash || (url.protocol === 'https:' && url.username)) throw new Error('CLONE_URL_FORBIDDEN');
  if (url.protocol === 'file:' && allowFile && !url.hostname) return { url: url.href, protocol: 'file' };
  if ((url.protocol !== 'https:' && url.protocol !== 'ssh:') || !/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(url.hostname) || (url.username && !/^[a-zA-Z0-9._][a-zA-Z0-9._-]*$/.test(url.username))) throw new Error('CLONE_URL_FORBIDDEN');
  return { url: url.href, protocol: url.protocol === 'https:' ? 'https' : 'ssh' };
}
export async function cloneProject(appData: string, input: string, allowFile = false): Promise<Registration> {
  const remote = validateCloneUrl(input, allowFile);
  const storage = resolve(appData);
  await mkdir(storage, { recursive: true });
  if (await realpath(storage) !== storage) throw new Error('App data must not be linked');
  if (remote.protocol === 'file') {
    const local = fileURLToPath(remote.url);
    if (await gitText(local, ['rev-parse', '--is-bare-repository']) !== 'true') throw new Error('Local clone fixture must be a bare repository');
  }
  const destination = join(storage, 'managed-repositories', newId('repo'));
  const template = join(storage, 'empty-git-template');
  await mkdir(template, { recursive: true });
  if ((await readdir(template)).length) throw new Error('Git template directory is not empty');
  await assertOwnedPath(storage, destination);
  await mkdir(join(storage, 'managed-repositories'), { recursive: true });
  await runGit(storage, ['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.ssh.allow=always', '-c', `protocol.file.allow=${allowFile ? 'always' : 'never'}`, 'clone', '--no-checkout', '--no-recurse-submodules', '--no-hardlinks', `--template=${template}`, '--', remote.url, destination], undefined, { GIT_ALLOW_PROTOCOL: allowFile ? 'https:ssh:file' : 'https:ssh', GIT_TERMINAL_PROMPT: '0' });
  const registration = await registerLocal(storage, destination);
  if (registration.head) {
    await withMetadataLock(destination, async () => {
      await runGit(destination, ['read-tree', registration.head!]);
      await materializeFiles(destination, await readCommittedFiles(destination, registration.head!, false));
    });
  }
  registration.remoteUrl = remote.url;
  await writeState(storage, join(storage, 'registrations', registration.id + '.json'), 'Registration', registration);
  return registration;
}

export async function relocateRegistration(appData: string, id: string, newRoot: string): Promise<Registration> {
  const storage = await realpath(appData);
  const prior = await getRegistration(storage, id);
  try { await access(prior.root); throw new Error('REGISTRATION_ALREADY_LOCATED'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const current = await inspect(newRoot);
  if (!prior.projectId || current.projectId !== prior.projectId || current.status !== 'ready') throw new Error('REGISTRATION_PROJECT_MISMATCH');
  const registration = { ...prior, ...current };
  const runDirectory = join(storage, 'runs');
  let entries: string[] = [];
  try { entries = await readdir(runDirectory); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await withMetadataLock(registration.root, async () => {
    for (const runId of entries.filter(value => /^run_[a-f0-9-]+$/.test(value))) {
      const run = await readState<Run>(storage, join(runDirectory, runId, 'run.json'), 'Run');
      if (run.registrationId !== id || run.workspaceState !== 'present') continue;
      if (run.path !== join(storage, 'worktrees', runId) || run.branch !== `workbench/task/${run.taskId}/${runId}`) throw new Error('RUN_SCOPE_MISMATCH');
      await assertOwnedPath(storage, run.path);
      try { await access(run.path); } catch { continue; }
      await runGit(registration.root, ['worktree', 'repair', '--', run.path]);
    }
  });
  await writeState(storage, join(storage, 'registrations', id + '.json'), 'Registration', registration);
  return registration;
}
