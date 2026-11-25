import { access, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import type { Task, Revision } from '../../schema/src/generated.js';
import { ValidationFailure } from '../../domain/src/model.js';
import { gitText, runGit } from '../../git-workspace/src/git.js';
import { Lease, withKernelLock, withWorktreeLock, worktreeScope } from '../../git-workspace/src/locks.js';
import { repositoryGuard } from '../../git-workspace/src/worktree.js';
import { captureFiles, fingerprint, hash } from '../../project-fs/src/files.js';
import { loadProject } from '../../project-fs/src/project.js';
import { readCommittedFiles, loadCommittedProject } from '../../project-fs/src/git-baseline.js';
import { rawObject, objectFile } from '../../project-fs/src/content.js';
import { applyTransaction, pendingTransactions } from '../../project-fs/src/writer.js';
import { metricsSnapshot, resetMetrics } from '../../domain/src/instrumentation.js';
import { TaskService } from './service.js';
import { cloneProject, registerLocal, relocateRegistration, validateCloneUrl } from './projects.js';
import { discoverTasks } from './discovery.js';
import { importDocuments } from './import.js';
import { fixtureCommit, removeWorkspaceFixture, workspaceFixture } from './test-helpers.js';
import type { WorkspaceFixture } from './test-helpers.js';

const fixtures: WorkspaceFixture[] = [];
async function setup(empty = false) { const f = await workspaceFixture(empty); fixtures.push(f); return f; }
afterEach(async () => { for (const f of fixtures.splice(0)) await removeWorkspaceFixture(f); });
const code = async (operation: Promise<unknown>, expected: string) => {
  try { await operation; expect.fail(`Expected ${expected}`); }
  catch (error) { expect(error).toBeInstanceOf(ValidationFailure); expect((error as ValidationFailure).diagnostics.map(d => d.code)).toContain(expected); }
};
async function ready() { const f = await setup(), registration = await registerLocal(f.app, f.root); return { ...f, registration, service: new TaskService(f.app) }; }

describe('stage 3 Git task lifecycle', () => {
  it('commits the brief/checkpoint before execution and isolates two parallel drafts without changing the baseline', async () => {
    const f = await ready();
    const basis = await repositoryGuard(f.root);
    const a = await f.service.start(f.registration.id, { goal: '첫 번째 개요' });
    const b = await f.service.start(f.registration.id, { goal: '두 번째 개요' });
    expect(a.path).not.toBe(b.path); expect(a.taskId).not.toBe(b.taskId);
    expect((await readFile(join(a.path, '.git'), 'utf8')).startsWith('gitdir:')).toBe(true);
    const initial = await readCommittedFiles(a.path, a.initialCommit!);
    expect(initial.has(`tasks/${a.taskId}/brief.md`)).toBe(true);
    expect(initial.has(`tasks/${a.taskId}/checkpoints/${a.checkpointId}.yaml`)).toBe(true);
    const result = await Promise.all([f.service.fakeDraft(a.runId, { entityId: 'ent_overview', body: '# A\n독립 초안 A\n', onPhase: async phase => { if (phase === 'started') expect(await gitText(a.path, ['rev-parse', 'HEAD'])).toBe(a.initialCommit); } }), f.service.fakeDraft(b.runId, { entityId: 'ent_overview', body: '# B\n독립 초안 B\n' })]);
    expect(result.map(r => r.status)).toEqual(['completed', 'completed']);
    const pa = await f.service.project(a.runId), pb = await f.service.project(b.runId);
    expect(pa.baselines.get('baseline_main')!.value.selected.ent_overview).toBe('rev_overview_a');
    expect(pa.entities.get('ent_overview')!.revisions.size).toBe(2);
    expect(pb.entities.get('ent_overview')!.revisions.size).toBe(2);
    const ra = [...pa.entities.get('ent_overview')!.revisions.values()].find(r => r.meta.status === 'draft')!;
    const rb = [...pb.entities.get('ent_overview')!.revisions.values()].find(r => r.meta.status === 'draft')!;
    expect(ra.meta.revision_id).not.toBe(rb.meta.revision_id); expect(ra.meta.parents).toEqual(['rev_overview_a']);
    expect(ra.body).toContain('독립 초안 A'); expect(rb.body).toContain('독립 초안 B');
    expect(await repositoryGuard(f.root)).toEqual(basis);
    await expect(f.service.fakeDraft(a.runId, { entityId: 'ent_overview', body: '중복' })).rejects.toThrow('RUN_NOT_EXECUTABLE');
    await writeFile(join(a.path, ra.bodyPath), '저장된 리비전의 외부 수정\n');
    await code(f.service.project(a.runId), 'IMMUTABLE_RECORD_CHANGED');
    await expect(f.service.cleanup(a.runId)).rejects.toThrow('WORKTREE_UNPRESERVED');
  }, 90_000);

  it('preserves staged, unstaged and untracked bytes/index and snapshots only explicit paths', async () => {
    const f = await ready();
    await writeFile(join(f.root, 'README.md'), 'staged\n'); await runGit(f.root, ['add', 'README.md']);
    await writeFile(join(f.root, 'README.md'), 'working\r\n');
    await writeFile(join(f.root, '선택 메모.txt'), '선택된 원문\r\n'); await writeFile(join(f.root, '남긴 메모.txt'), '원본에만\n');
    const guard = await repositoryGuard(f.root, false), all = fingerprint(await captureFiles(f.root, false));
    const a = await f.service.start(f.registration.id, { goal: 'HEAD 기준' });
    expect(a.omittedWorkingChanges).toBe(true); expect(await readFile(join(a.path, 'README.md'), 'utf8')).not.toBe('working\r\n');
    await expect(access(join(a.path, '선택 메모.txt'))).rejects.toThrow();
    const b = await f.service.start(f.registration.id, { goal: '선택 포함', includeWorkingPaths: ['README.md', '선택 메모.txt'] });
    expect(b.selectedSnapshotRef).toMatch(/^workbench\/snapshot\//); expect(b.omittedWorkingChanges).toBe(false);
    expect(await readFile(join(b.path, 'README.md'), 'utf8')).toBe('working\r\n');
    expect(await readFile(join(b.path, '선택 메모.txt'), 'utf8')).toBe('선택된 원문\r\n');
    await expect(access(join(b.path, '남긴 메모.txt'))).rejects.toThrow();
    expect(await repositoryGuard(f.root, false)).toEqual(guard); expect(fingerprint(await captureFiles(f.root, false))).toBe(all);
    expect(await gitText(f.root, ['stash', 'list'])).toBe('');
  }, 90_000);

  it('acknowledges cancellation, preserves autosaved work and refuses cleanup with untracked or ignored files', async () => {
    const f = await ready(), run = await f.service.start(f.registration.id, { goal: '중단 보존' });
    const result = await f.service.fakeDraft(run.runId, { entityId: 'ent_overview', body: '작성 중 결과\n', onPhase: async phase => { if (phase === 'saved') { expect((await f.service.cancel(run.runId)).status).toBe('cancelling'); await code(f.service.cleanup(run.runId), 'WORKTREE_BUSY'); } } });
    expect(result.status).toBe('cancelled');
    const task = rawObject<Task>((await loadCommittedProject(run.path, result.headCommit!)).files, `tasks/${run.taskId}/task.yaml`);
    expect(task.status).toBe('cancelled'); expect(task.outputs).toHaveLength(1);
    expect(await readFile(join(run.path, task.outputs[0]!), 'utf8')).toBe('작성 중 결과\n');
    await writeFile(join(run.path, '.gitignore'), '비보존.tmp\n'); await writeFile(join(run.path, '비보존.tmp'), '삭제 금지');
    await expect(f.service.cleanup(run.runId)).rejects.toThrow('WORKTREE_UNPRESERVED');
    await rm(join(run.path, '비보존.tmp')); await rm(join(run.path, '.gitignore'));
    await f.service.cleanup(run.runId);
    expect((await f.service.run(run.runId, false)).run.workspaceState).toBe('removed');
    expect(await gitText(f.root, ['rev-parse', `refs/heads/${run.branch}`])).toBe(result.headCommit);
  }, 90_000);

  it('can cancel a queued run and preserves an invalid fake output as a failed working draft', async () => {
    const f = await ready(), a = await f.service.start(f.registration.id, { goal: '대기 취소' });
    await f.service.cancel(a.runId);
    expect((await f.service.fakeDraft(a.runId, { entityId: 'ent_overview', body: '시작하지 않음' })).status).toBe('cancelled');
    const b = await f.service.start(f.registration.id, { goal: '잘못된 참조 결과 보존' });
    const result = await f.service.fakeDraft(b.runId, { entityId: 'ent_overview', body: '[[ref:missing]]\n' });
    expect(result.status).toBe('failed');
    const snapshot = await f.service.project(b.runId), task = rawObject<Task>(snapshot.files, `tasks/${b.taskId}/task.yaml`);
    expect(snapshot.entities.get('ent_overview')!.revisions.size).toBe(1); expect(task.status).toBe('failed');
    expect(snapshot.files.get(task.outputs[0]!)!.text).toBe('[[ref:missing]]\n'); expect(result.headCommit).not.toBe(b.initialCommit);
  }, 90_000);

  it('rediscovers refs/tree after local logs/registration loss and resumes an explicit preserved checkpoint', async () => {
    const f = await ready(), run = await f.service.start(f.registration.id, { goal: 'DB 없이 재발견' });
    const result = await f.service.fakeDraft(run.runId, { entityId: 'ent_overview', body: '보존한 초안\n' });
    await f.service.cleanup(run.runId);
    // Only disposable fixture-local metadata is removed. Git remains the durable source.
    await rm(join(f.app, 'runs', run.runId), { recursive: true });
    await rm(join(f.app, 'registrations', f.registration.id + '.json'));
    const registration = await registerLocal(f.app, f.root);
    const found = (await discoverTasks(f.root, registration.projectId!)).find(item => item.taskId === run.taskId && item.ref === `refs/heads/${run.branch}`)!;
    expect(found.runnable).toBe(true); expect(found.localPreserved).toBe(true); expect(found.remotePreserved).toBe(false);
    expect(found.task.goal).toBe('DB 없이 재발견'); expect(found.checkpoint.id).toBe(result.checkpointId);
    const resumed = await f.service.resume(registration.id, run.taskId, found.ref, result.headCommit!);
    expect(resumed.taskId).toBe(run.taskId); expect(resumed.runId).not.toBe(run.runId); expect(resumed.resumedFrom?.commit).toBe(result.headCommit);
    expect(rawObject<Task>((await f.service.project(resumed.runId)).files, `tasks/${run.taskId}/task.yaml`).outputs).toEqual(found.task.outputs);
  }, 90_000);

  it('clones only safe transports via an offline bare fixture and distinguishes remote-tracking preservation', async () => {
    const f = await ready(), run = await f.service.start(f.registration.id, { goal: '원격 보존 구분' });
    const remote = join(f.home, '로컬 원격.git');
    await runGit(f.home, ['clone', '--bare', '--', f.root, remote]);
    const url = pathToFileURL(remote).href;
    expect(() => validateCloneUrl(url)).toThrow();
    const cloned = await cloneProject(join(f.home, 'clone 앱'), url, true);
    expect(cloned.id).not.toBe(f.registration.id); expect(cloned.projectId).toBe(f.registration.projectId);
    const remoteTask = (await discoverTasks(cloned.root, cloned.projectId!)).find(item => item.taskId === run.taskId)!;
    expect(remoteTask.ref).toMatch(/^refs\/remotes\//); expect(remoteTask.localPreserved).toBe(false); expect(remoteTask.remotePreserved).toBe(true);
    const localOnly = await f.service.start(f.registration.id, { goal: '원격에 없는 새 작업' });
    expect((await discoverTasks(cloned.root, cloned.projectId!)).some(item => item.taskId === localOnly.taskId)).toBe(false);
    expect(await gitText(f.root, ['remote'])).toBe('');
  }, 90_000);

  it.each(['-ufoo', 'file:///D:/unsafe', 'ext::sh', 'http://example.org/a', 'https://user:secret@example.org/a', 'ssh://host/a?x=1', 'git://host/a'])('rejects unsafe clone URL %s', value => expect(() => validateCloneUrl(value)).toThrow());

  it('repairs linked worktrees after a Unicode repository move and creates a separate integration workspace', async () => {
    const f = await ready(), run = await f.service.start(f.registration.id, { goal: '이동과 격리' });
    const result = await f.service.fakeDraft(run.runId, { entityId: 'ent_overview', body: '이동 후에도 보존\n' });
    const moved = join(f.home, '이동한 원본 공백');
    if (![f.root, moved].every(path => resolve(path).startsWith(resolve(f.home) + sep))) throw new Error('Unexpected fixture move path');
    // Model a user moving a repository across folders/volumes. Windows directory rename
    // is denied in this environment for a populated .git; copy/remove preserves its bytes.
    await cp(f.root, moved, { recursive: true });
    await rm(f.root, { recursive: true, maxRetries: 10, retryDelay: 100 }); f.root = moved;
    // Keep the cleanup fixture's root in sync with this deliberate test-only move.
    fixtures[fixtures.length - 1]!.root = moved;
    const registration = await relocateRegistration(f.app, f.registration.id, moved);
    expect(registration.projectId).toBe(f.registration.projectId); expect((await f.service.project(run.runId)).project.project_id).toBe(registration.projectId);
    await writeFile(join(moved, 'README.md'), 'active target dirty\n'); const before = await repositoryGuard(moved, false);
    const integration = await f.service.prepareIntegration(registration.id, result.headCommit!);
    expect(integration.status).toBe('ready'); expect(integration.path).not.toBe(moved);
    expect(await gitText(integration.path, ['rev-parse', 'HEAD'])).toBe(integration.basisCommit);
    expect(await repositoryGuard(moved, false)).toEqual(before);
  }, 90_000);
});

describe('OS leases and recoverable file transactions', () => {
  it('never steals a live OS lock on stale heartbeat/PID and recovers after process death', async () => {
    const f = await setup(), path = join(f.home, 'kernel.lock');
    const moduleUrl = pathToFileURL(resolve('dist/packages/git-workspace/src/locks.js')).href;
    const child = spawn(process.execPath, ['--input-type=module', '-e', `import {withKernelLock} from ${JSON.stringify(moduleUrl)}; await withKernelLock(${JSON.stringify(path)}, 'test-owner', async () => { console.log('READY'); await new Promise(() => { setInterval(() => {}, 1000); }); });`], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      const ready = await Promise.race([once(child.stdout!, 'data').then(value => String(value[0])), once(child, 'exit').then(() => { throw new Error('Lock child exited'); })]);
      expect(ready).toContain('READY');
      const owner = JSON.parse(await readFile(path + '.owner.json', 'utf8'));
      await writeFile(path + '.owner.json', JSON.stringify({ ...owner, pid: 1, heartbeatAt: '2000-01-01T00:00:00Z' }));
      await code(withKernelLock(path, 'test-owner', async () => undefined), 'WORKTREE_BUSY');
    } finally { const exited = once(child, 'exit'); child.kill(); await exited; }
    await withKernelLock(path, 'test-owner', async lease => { lease.assert('test-owner'); expect(JSON.parse(await readFile(path + '.owner.json', 'utf8')).recoveredPreviousLease).toBe(true); });
    expect(JSON.parse(await readFile(path + '.owner.json', 'utf8')).releasedAt).toBeTruthy();
    expect(() => new Lease('test-owner', 'forged').assert('test-owner')).toThrow('LOCK_LEASE_INVALID');
  }, 30_000);

  it.each([
    { phase: 'prepared', fault: 'SIMULATED_CRASH' },
    { phase: 'written', fault: 'SIMULATED_CRASH' },
    { phase: 'written', fault: 'ENOSPC' },
  ] as const)('blocks reads after $phase / $fault and recovers before a new checkpoint', async ({ phase, fault }) => {
    const f = await ready(), run = await f.service.start(f.registration.id, { goal: '부분 쓰기 복구' });
    const source = await repositoryGuard(f.root);
    const body = phase === 'prepared' ? '가'.repeat(400_000) + '\n' : '중간 원문\n'; // journal exceeds the 2 MiB project YAML limit
    const error = Object.assign(new Error(fault), { code: fault });
    await expect(f.service.saveDraft(run.runId, '부분.md', body, null, async current => { if (current === phase) throw error; })).rejects.toBe(error);
    await code(f.service.project(run.runId), 'RECOVERY_REQUIRED');
    expect((await pendingTransactions(join(f.app, 'runs', run.runId))).length).toBe(1);
    const recovered = await f.service.recover(run.runId); expect(recovered.status).toBe('interrupted');
    expect((await f.service.project(run.runId)).files.get(`tasks/${run.taskId}/working/부분.md`)!.text).toBe(body);
    expect(await pendingTransactions(join(f.app, 'runs', run.runId))).toHaveLength(0);
    expect(recovered.headCommit).not.toBe(run.headCommit);
    expect(await repositoryGuard(f.root)).toEqual(source);
  }, 90_000);

  it('reconciles a preserved Git checkpoint after loss of the final runtime journal update', async () => {
    const f = await ready(), run = await f.service.start(f.registration.id, { goal: 'commit 직후 중단' });
    await f.service.fakeDraft(run.runId, { entityId: 'ent_overview', body: 'Git에는 이미 보존한 초안\n' });
    await writeFile(join(f.app, 'runs', run.runId, 'run.json'), JSON.stringify({ ...run, status: 'running' }));
    const recovered = await f.service.recover(run.runId);
    expect(recovered.status).toBe('interrupted'); expect(recovered.headCommit).not.toBe(run.headCommit);
    expect((await f.service.project(run.runId)).entities.get('ent_overview')!.revisions.size).toBe(2);
  }, 90_000);

  it('preserves unknown external edits and refuses expected-hash, immutable, cross-run and path collisions', async () => {
    const f = await ready(), run = await f.service.start(f.registration.id, { goal: '충돌 거부' });
    await f.service.saveDraft(run.runId, '본문.md', '원문\n', null);
    await code(f.service.saveDraft(run.runId, '본문.md', '오래된 입력\n', hash('다른 원문')), 'FILE_CHANGED_EXTERNALLY');
    await expect(f.service.saveDraft(run.runId, '본문.md', '다음\n', hash('원문\n'), async phase => { if (phase === 'prepared') throw new Error('CRASH'); })).rejects.toThrow('CRASH');
    const path = join(run.path, 'tasks', run.taskId, 'working', '본문.md'); await writeFile(path, '외부 편집\n');
    await code(f.service.recover(run.runId), 'FILE_CHANGED_EXTERNALLY'); expect(await readFile(path, 'utf8')).toBe('외부 편집\n');
    const other = await f.service.start(f.registration.id, { goal: '별도 작업' });
    const snapshot = await f.service.project(other.runId), state = join(f.app, 'runs', other.runId);
    await withWorktreeLock(other.path, async lease => {
      await code(applyTransaction(other.path, state, lease, { expectedSnapshot: snapshot.fingerprint, changes: [{ path: `tasks/${run.taskId}/working/escape.md`, expectedDigest: null, content: '범위 밖' }] }, { scopeId: other.runId, allowedPrefixes: [`tasks/${other.taskId}/`] }), 'WRITE_SCOPE_FORBIDDEN');
      await code(applyTransaction(other.path, state, lease, { expectedSnapshot: snapshot.fingerprint, changes: [{ path: 'entities/ent_overview/revisions/rev_overview_a/content.md', expectedDigest: snapshot.files.get('entities/ent_overview/revisions/rev_overview_a/content.md')!.digest, content: '교체 금지' }] }, { scopeId: other.runId, allowedPrefixes: ['entities/'] }), 'IMMUTABLE_RECORD_CHANGED');
      await code(applyTransaction(other.path, state, lease, { expectedSnapshot: snapshot.fingerprint, changes: ['A.md', 'a.md'].map(name => ({ path: `tasks/${other.taskId}/working/${name}`, expectedDigest: null, content: 'collision' })) }, { scopeId: other.runId, allowedPrefixes: [`tasks/${other.taskId}/`] }), 'PATH_COLLISION');
      await code(applyTransaction(other.path, state, lease, { expectedSnapshot: snapshot.fingerprint, changes: [{ path: `tasks/${other.taskId}/working/${'a/'.repeat(65)}deep.md`, expectedDigest: null, content: 'too deep' }] }, { scopeId: other.runId, allowedPrefixes: [`tasks/${other.taskId}/`] }), 'SOURCE_SIZE_LIMIT');
    });
  }, 90_000);

  it('writes many files with a constant number of full captures and recovers an interrupted multi-file write', async () => {
    const f = await ready(), run = await f.service.start(f.registration.id, { goal: '다중 파일 쓰기' });
    const state = join(f.app, 'runs', run.runId), options = { scopeId: run.runId, allowedPrefixes: [`tasks/${run.taskId}/`] };
    const files = (round: string) => Array.from({ length: 20 }, (_, n) => ({ path: `tasks/${run.taskId}/working/note-${String(n)}.md`, text: `${round} ${String(n)}\n` }));
    const write = async (round: string, onPhase?: Parameters<typeof applyTransaction>[4]['onPhase']) => {
      const snapshot = await f.service.project(run.runId);
      return withWorktreeLock(run.path, lease => applyTransaction(run.path, state, lease, { expectedSnapshot: snapshot.fingerprint, changes: files(round).map(file => ({ path: file.path, expectedDigest: snapshot.files.get(file.path)?.digest ?? null, content: file.text })) }, { ...options, ...(onPhase ? { onPhase } : {}) }));
    };
    resetMetrics();
    await write('첫째');
    const counted = metricsSnapshot();
    // Before this change both grew with the number of edits (one full capture and one journal rewrite per file).
    expect(counted['fs.captureFiles.all']?.calls).toBeLessThanOrEqual(3);
    expect(counted['state.write.Transaction']?.calls).toBeLessThanOrEqual(3);
    let written = 0;
    const crashAfterFifth = (phase: string) => {
      if (phase === 'written') { written += 1; }
      return written === 5 ? Promise.reject(new Error('CRASH')) : Promise.resolve();
    };
    await expect(write('둘째', crashAfterFifth)).rejects.toThrow('CRASH');
    const note = (n: number) => readFile(join(run.path, 'tasks', run.taskId, 'working', `note-${String(n)}.md`), 'utf8');
    expect(await note(4)).toBe('둘째 4\n');
    expect(await note(5)).toBe('첫째 5\n');
    await f.service.recover(run.runId);
    expect(await pendingTransactions(state)).toEqual([]);
    expect(await Promise.all(files('둘째').map(file => readFile(join(run.path, file.path), 'utf8')))).toEqual(files('둘째').map(file => file.text));
  }, 90_000);
  it('checks applied journals without re-reading them and notices a journal changed in place', async () => {
    const f = await ready(), run = await f.service.start(f.registration.id, { goal: '저널 재사용' });
    await f.service.saveDraft(run.runId, '첫째.md', '하나\n', null);
    await f.service.saveDraft(run.runId, '둘째.md', '둘\n', null);
    await f.service.project(run.runId);
    resetMetrics();
    await f.service.project(run.runId);
    await f.service.project(run.runId);
    // Applied journals are summarized once; later checks only stat them.
    expect(metricsSnapshot()['state.read.Transaction']).toBeUndefined();
    const directory = join(f.app, 'runs', run.runId, 'transactions'), [journal] = await readdir(directory);
    if (!journal) throw new Error('Expected an applied journal');
    const path = join(directory, journal), value = JSON.parse(await readFile(path, 'utf8')) as { state: string };
    await writeFile(path, JSON.stringify({ ...value, state: 'writing' }, null, 2) + '\n');
    await code(f.service.project(run.runId), 'RECOVERY_REQUIRED');
  }, 90_000);
});

describe('explicit non-destructive document import', () => {
  it('opens without a manifest as import_required and imports only selected committed documents with provenance', async () => {
    const f = await setup(true);
    const original = Buffer.from('\ufeff---\r\ntitle: old\r\n---\r\n# 기록\r\n[[ref:literal]]\r\n');
    await writeFile(join(f.root, '옛 기획.md'), original); await writeFile(join(f.root, '비선택.txt'), '비선택'); const commit = await fixtureCommit(f.root);
    const registration = await registerLocal(f.app, f.root); expect(registration.status).toBe('import_required'); await expect(access(join(f.root, 'project.yaml'))).rejects.toThrow();
    const before = await repositoryGuard(f.root, false), bytes = fingerprint(await captureFiles(f.root, false));
    const operation = await importDocuments(f.app, registration.id, ['옛 기획.md']);
    expect(operation.status).toBe('completed'); const snapshot = await loadProject(operation.path);
    const entity = [...snapshot.entities.values()][0]!, revision = [...entity.revisions.values()][0]!;
    expect(snapshot.entities.size).toBe(1); expect(entity.value.kind).toBe('document'); expect(revision.meta.status).toBe('draft');
    expect(revision.meta.extensions['craft.import']).toMatchObject({ source_path: '옛 기획.md', source_commit: commit, source_digest: hash(original) });
    expect(revision.body).toContain('&#91;&#91;ref:literal]]'); expect(await readFile(join(operation.path, '옛 기획.md'))).toEqual(original);
    expect(await repositoryGuard(f.root, false)).toEqual(before); expect(fingerprint(await captureFiles(f.root, false))).toBe(bytes);
    expect(snapshot.files.has('reviews')).toBe(false);
  }, 90_000);

  it('imports into an existing project without changing its existing baseline or revisions', async () => {
    const f = await ready(); await writeFile(join(f.root, '추가.txt'), '명시 문서'); await fixtureCommit(f.root);
    const before = await loadProject(f.root); const operation = await importDocuments(f.app, f.registration.id, ['추가.txt']);
    const after = await loadProject(operation.path);
    expect(after.project.default_baseline_id).toBe(before.project.default_baseline_id);
    for (const [path, file] of before.files) if (/^(entities|baselines|reviews)\//.test(path)) expect(after.files.get(path)?.digest).toBe(file.digest);
    expect(after.entities.size).toBe(before.entities.size + 1);
  }, 90_000);

  it('registers an unborn repository without creating project files or a commit', async () => {
    const f = await setup(true), registration = await registerLocal(f.app, f.root);
    expect(registration.status).toBe('unborn'); expect(registration.head).toBeNull(); expect(await readdir(f.root)).toEqual(['.git']);
    await expect(importDocuments(f.app, registration.id, ['x.md'])).rejects.toThrow('IMPORT_REQUIRES_COMMITTED_SUPPORTED_REPOSITORY');
  });
});
