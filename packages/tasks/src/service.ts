import { access, mkdir, readFile, realpath, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Registration, Run, Operation } from '../../workspace-runtime/src/generated.js';
import { atomicBytes, readState, writeState } from '../../workspace-runtime/src/state.js';
import type { Task, Checkpoint, ContextManifest, Proposal, Revision } from '../../schema/src/generated.js';
import { canonicalJson } from '../../domain/src/canonical.js';
import type { ProjectSnapshot, SourceFile } from '../../domain/src/model.js';
import { ValidationFailure } from '../../domain/src/model.js';
import { isProjectPath } from '../../domain/src/path.js';
import { checkImmutability, semanticDigest } from '../../project-fs/src/changes.js';
import type { FileChange } from '../../project-fs/src/changes.js';
import { objectFile, rawObject, textFile } from '../../project-fs/src/content.js';
import { captureFiles, fileFailure, fingerprint, hash, isCanonicalPath, newId, readSource } from '../../project-fs/src/files.js';
import { loadCommittedProject, readCommittedFiles } from '../../project-fs/src/git-baseline.js';
import { loadProject, parseProject } from '../../project-fs/src/project.js';
import { applyTransaction, assertNoPending, assertSavedRecords, pendingTransactions, recoverTransactions } from '../../project-fs/src/writer.js';
import type { WriteOptions } from '../../project-fs/src/writer.js';
import { assertOwnedPath, assertSourceUnchanged, checkedManagedRoot, repositoryGuard } from '../../git-workspace/src/worktree.js';
import type { ScratchWorkspace } from '../../git-workspace/src/worktree.js';
import { createOwnedWorkspace, preserveWorkspace } from '../../git-workspace/src/branches.js';
import { gitText, runGit } from '../../git-workspace/src/git.js';
import { gitLocations, withKernelLock, withMetadataLock, withWorktreeLock, worktreeScope } from '../../git-workspace/src/locks.js';
import type { Lease } from '../../git-workspace/src/locks.js';
import { discoverTasks } from './discovery.js';
import { getRegistration } from './projects.js';
import { assertIntegrationReady } from './integration-state.js';

export interface StartTaskOptions { goal: string; title?: string; acceptance?: string[]; baselineId?: string; targetRef?: string; includeWorkingPaths?: readonly string[]; expectedWorkingFingerprint?: string }
export interface FakeDraftOptions { entityId: string; body: string; signal?: AbortSignal; onPhase?: (phase: 'started' | 'saved') => Promise<void> }
const canonicalFiles = (files: ReadonlyMap<string, SourceFile>) => new Map([...files].filter(([path]) => isCanonicalPath(path)));
const delta = (before: ReadonlyMap<string, SourceFile>, after: ReadonlyMap<string, SourceFile>) => [...new Set([...before.keys(), ...after.keys()])].sort().flatMap(path => before.get(path)?.digest === after.get(path)?.digest ? [] : [{ path, file: after.get(path) ?? null }]);
export class TaskService {
  readonly appData: string;
  constructor(appData: string) { this.appData = resolve(appData); }
  private directory(runId: string): string { if (!/^run_[a-f0-9-]+$/.test(runId)) throw new Error('Invalid run ID'); return join(this.appData, 'runs', runId); }
  private async save(run: Run): Promise<void> { await writeState(this.appData, join(this.directory(run.runId), 'run.json'), 'Run', run); }
  private writeOptions(run: Run): WriteOptions { return { scopeId: run.runId, allowedPrefixes: [`tasks/${run.taskId}/`, 'entities/', 'baselines/', 'reviews/'] }; }
  private workspace(run: Run, registration: Registration): ScratchWorkspace { return { path: run.path, branch: run.branch, baseCommit: run.basisCommit, sourceRoot: registration.root }; }
  async run(runId: string, requireWorkspace = true): Promise<{ run: Run; registration: Registration }> {
    const run = await readState<Run>(this.appData, join(this.directory(runId), 'run.json'), 'Run');
    const registration = await getRegistration(this.appData, run.registrationId);
    if (run.runId !== runId || run.path !== join(this.appData, 'worktrees', runId) || run.branch !== `workbench/task/${run.taskId}/${runId}` || run.projectId !== registration.projectId) throw fileFailure('RUN_SCOPE_MISMATCH', 'Run identity/path/project mismatch', 'project.yaml');
    await assertOwnedPath(this.appData, run.path);
    if (requireWorkspace) {
      if (!['present', 'recovering'].includes(run.workspaceState)) throw fileFailure('WORKTREE_MISSING', 'Recreate the run from a preserved Git checkpoint', 'project.yaml');
      if ((await gitLocations(run.path)).commonDir !== (await gitLocations(registration.root)).commonDir || await gitText(run.path, ['symbolic-ref', '--short', 'HEAD']) !== run.branch) throw fileFailure('RUN_SCOPE_MISMATCH', 'Git workspace belongs to another scope', 'project.yaml');
    }
    return { run, registration };
  }
  async project(runId: string): Promise<ProjectSnapshot> {
    const { run } = await this.run(runId);
    await assertNoPending(this.directory(runId));
    const snapshot = await loadProject(run.path);
    if (snapshot.project.project_id !== run.projectId) throw new Error('RUN_PROJECT_CHANGED');
    if (run.headCommit) {
      const invalid = checkImmutability(await loadCommittedProject(run.path, run.headCommit), snapshot);
      if (invalid.length) throw new ValidationFailure(invalid);
    }
    await assertSavedRecords(this.directory(runId), snapshot.files);
    return snapshot;
  }

  async start(registrationId: string, options: StartTaskOptions): Promise<Run> {
    const registration = await getRegistration(this.appData, registrationId);
    await assertIntegrationReady(this.appData, registrationId);
    if (registration.status !== 'ready' || !registration.projectId) throw new Error('PROJECT_NOT_READY');
    if (!options.goal.trim()) throw new Error('Task goal is required');
    return withWorktreeLock(registration.root, async () => {
      await assertIntegrationReady(this.appData, registrationId);
      const source = await repositoryGuard(registration.root, false);
      if (options.expectedWorkingFingerprint && hash(canonicalJson(source)) !== options.expectedWorkingFingerprint) throw fileFailure('BASE_CHANGED', 'Selected working files changed before task creation', 'project.yaml');
      const targetRef = options.targetRef ?? await gitText(registration.root, ['symbolic-ref', '--short', 'HEAD']).catch(() => source.commit);
      let basisCommit = await gitText(registration.root, ['rev-parse', '--verify', '--end-of-options', `${targetRef}^{commit}`]);
      let snapshotRef: string | undefined;
      if (options.includeWorkingPaths?.length) {
        if (basisCommit !== source.commit) throw new Error('DIRTY_SELECTION_BASIS_MISMATCH');
        const selected = await this.snapshot(registration, basisCommit, options.includeWorkingPaths);
        basisCommit = selected.resultCommit!; snapshotRef = selected.branch;
      }
      const result = await this.prepare(registration, basisCommit, targetRef, options, undefined, snapshotRef, !!source.status);
      await assertSourceUnchanged(source);
      return result;
    });
  }
  async resume(registrationId: string, taskId: string, ref: string, commit: string): Promise<Run> {
    const registration = await getRegistration(this.appData, registrationId);
    return withWorktreeLock(registration.root, async () => {
    await assertIntegrationReady(this.appData, registrationId);
    if (!registration.projectId) throw new Error('PROJECT_NOT_READY');
    if (!/^task_[a-z0-9_-]+$/.test(taskId) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) throw new Error('Invalid task/checkpoint identity');
    const location = (await discoverTasks(registration.root, registration.projectId)).find(item => item.taskId === taskId && item.ref === ref);
    if (!location && !new RegExp(`^(?:refs/heads|refs/remotes/[^/]+)/workbench/task/${taskId}/run_[a-f0-9-]+$`).test(ref)) throw new Error('TASK_CHECKPOINT_NOT_FOUND');
    await runGit(registration.root, ['merge-base', '--is-ancestor', commit, ref]);
    const snapshot = await loadCommittedProject(registration.root, commit);
    const task = rawObject<Task>(snapshot.files, `tasks/${taskId}/task.yaml`);
    if (snapshot.project.project_id !== registration.projectId || !snapshot.writable) throw new Error('TASK_CHECKPOINT_NOT_RUNNABLE');
    const immutable = checkImmutability(await loadCommittedProject(registration.root, task.base.commit), snapshot);
    if (immutable.length) throw new ValidationFailure(immutable);
    const targetRef = await gitText(registration.root, ['symbolic-ref', '--short', 'HEAD']);
    return this.prepare(registration, commit, targetRef, { goal: task.goal }, task, undefined, false, { ref, commit, checkpointId: task.latest_checkpoint });
    });
  }

  private async prepare(registration: Registration, basisCommit: string, targetRef: string, options: StartTaskOptions, previous?: Task, selectedSnapshotRef?: string, dirty = false, resumedFrom?: Run['resumedFrom']): Promise<Run> {
    await checkedManagedRoot(this.appData, registration.root);
    const basis = await loadCommittedProject(registration.root, basisCommit);
    if (basis.project.project_id !== registration.projectId || !basis.writable) throw new Error('PROJECT_SCOPE_UNSUPPORTED');
    const baselineId = options.baselineId ?? previous?.base.baseline_id ?? basis.project.default_baseline_id;
    const baseline = basis.baselines.get(baselineId);
    if (!baseline) throw new Error('BASELINE_MISSING');
    const taskId = previous?.id ?? newId('task');
    const runId = newId('run');
    const run: Run = { protocol: 1, registrationId: registration.id, projectId: basis.project.project_id, taskId, runId, worktreeId: newId('wt'), branch: `workbench/task/${taskId}/${runId}`, path: join(this.appData, 'worktrees', runId), basisCommit, targetRef, status: 'starting', workspaceState: 'present', cancelRequested: false, omittedWorkingChanges: dirty && !selectedSnapshotRef, createdAt: new Date().toISOString(), ...(selectedSnapshotRef ? { selectedSnapshotRef } : {}), ...(resumedFrom ? { resumedFrom } : {}) };
    await mkdir(this.directory(runId), { recursive: true });
    await this.save(run); // preparation journal precedes worktree creation
    try {
      await withMetadataLock(registration.root, () => createOwnedWorkspace(registration.root, this.appData, run.path, run.branch, basisCommit));
      await withWorktreeLock(run.path, async lease => {
        const checkpointId = newId('cp');
        const task: Task = previous ? { ...previous, status: 'planned', latest_checkpoint: checkpointId } : { id: taskId, title: options.title ?? options.goal.slice(0, 80), status: 'planned', goal: options.goal, acceptance: options.acceptance ?? ['결과를 보존하고 사용자 검토를 받는다.'], base: { commit: basisCommit, schema_versions: { core: basis.project.schema_version, ...Object.fromEntries(Object.entries(basis.project.extensions).map(([name, value]) => [name, value.schema_version])) }, baseline_id: baselineId, baseline_fingerprint: basis.files.get(baseline.path)!.digest }, latest_checkpoint: checkpointId, skills: [], integration_profile: 'project-default', outputs: [], consumed_proposals: [] };
        const cp = this.checkpointRecords(run, task, basis, checkpointId, previous ? '보존된 작업을 새 run으로 재개할 준비를 했다.' : '작업 목표와 초기 기준을 보존했다.');
        const files = [objectFile(`tasks/${taskId}/task.yaml`, task), ...cp];
        if (!previous) files.push(textFile(`tasks/${taskId}/brief.md`, `# ${task.title}\n\n${task.goal}\n`));
        const current = await loadProject(run.path);
        await this.write(run, lease, current, files);
        const head = await this.commit(run, registration, basisCommit, 'task: preserve goal, brief and initial checkpoint', lease);
        run.status = 'queued'; run.initialCommit = head; run.headCommit = head; run.checkpointId = checkpointId; run.validation = { valid: true, codes: [] };
        await this.save(run);
      });
      return run;
    } catch (error) {
      run.status = 'failed'; run.error = String(error); run.validation = { valid: false, codes: ['PREPARATION_FAILED'] };
      await this.save(run); throw error;
    }
  }

  private checkpointRecords(run: Run, task: Task, basis: ProjectSnapshot, id: string, summary: string): SourceFile[] {
    const inputPath = `tasks/${task.id}/checkpoints/${id}-inputs.yaml`;
    const selected = basis.baselines.get(task.base.baseline_id)!;
    const inputs: ContextManifest['inputs'] = Object.entries(selected.value.selected).map(([entityId, revisionId]) => {
      const record = basis.entities.get(entityId)?.revisions.get(revisionId);
      if (!record?.writable) throw new Error('CONTEXT_UNSUPPORTED');
      return { target: { entity_id: entityId, revision_id: revisionId }, source_path: record.bodyPath, source_digest: basis.files.get(record.bodyPath)!.digest, semantic_digest: semanticDigest(basis, entityId, revisionId) };
    });
    const manifest: ContextManifest = { snapshot_token: `git:${run.basisCommit}`, view: 'basis', baseline_id: task.base.baseline_id, baseline_fingerprint: basis.files.get(selected.path)!.digest, schema_versions: { core: basis.project.schema_version, ...Object.fromEntries(Object.entries(basis.project.extensions).map(([name, declaration]) => [name, declaration.schema_version])) }, builder_version: 'stage3-files-1', query: { perspective: 'author', run_id: run.runId }, inputs, skills: task.skills, omissions: [] };
    const checkpoint: Checkpoint = { id, task_id: task.id, created_at: new Date().toISOString(), summary, working_files: task.outputs, decisions: [], open_questions: ['사용자 검토와 정본 통합은 아직 수행하지 않았다.'], next_actions: ['보존된 결과와 현재 기준을 검토한다.'], input_manifest_path: inputPath, provider_hint: { type: 'fake', session_id: run.runId } };
    return [objectFile(inputPath, manifest), objectFile(`tasks/${task.id}/checkpoints/${id}.yaml`, checkpoint)];
  }
  private async write(run: Run, lease: Lease, current: ProjectSnapshot, files: readonly SourceFile[], onPhase?: WriteOptions['onPhase']): Promise<void> {
    const changes: FileChange[] = files.map(file => ({ path: file.path, expectedDigest: current.files.get(file.path)?.digest ?? null, content: file.text! }));
    await applyTransaction(run.path, this.directory(run.runId), lease, { expectedSnapshot: current.fingerprint, changes }, { ...this.writeOptions(run), ...(onPhase ? { onPhase } : {}) });
  }
  private async commit(run: Run, registration: Registration, expectedHead: string, message: string, lease: Lease): Promise<string> {
    lease.assert(await worktreeScope(run.path));
    const before = await readCommittedFiles(run.path, expectedHead, false);
    const after = await captureFiles(run.path, false);
    return withMetadataLock(registration.root, () => preserveWorkspace(this.workspace(run, registration), expectedHead, delta(before, after), message));
  }

  async saveDraft(runId: string, file: string, text: string, expectedDigest: string | null, onPhase?: WriteOptions['onPhase']): Promise<void> {
    const { run } = await this.run(runId);
    if (!isProjectPath(file)) throw new Error('Invalid working file path');
    await withWorktreeLock(run.path, async lease => {
      const current = await this.project(runId);
      const path = `tasks/${run.taskId}/working/${file}`;
      const task = rawObject<Task>(current.files, `tasks/${run.taskId}/task.yaml`);
      if ((current.files.get(path)?.digest ?? null) !== expectedDigest) throw fileFailure('FILE_CHANGED_EXTERNALLY', 'Draft was edited externally', path);
      if (!task.outputs.includes(path)) task.outputs = [...task.outputs, path];
      await this.write(run, lease, current, [textFile(path, text), objectFile(`tasks/${task.id}/task.yaml`, task)], onPhase);
    });
  }

  async checkpoint(runId: string, taskStatus: Task['status'] = 'paused', summary = '중간 결과를 보존했다.', runStatus: Run['status'] = 'interrupted'): Promise<Run> {
    const { run, registration } = await this.run(runId);
    return withWorktreeLock(run.path, async lease => {
      await assertNoPending(this.directory(runId));
      const current = await this.project(runId);
      const task = rawObject<Task>(current.files, `tasks/${run.taskId}/task.yaml`);
      const id = newId('cp'); task.latest_checkpoint = id; task.status = taskStatus;
      const basis = await loadCommittedProject(registration.root, run.basisCommit);
      await this.write(run, lease, current, [objectFile(`tasks/${task.id}/task.yaml`, task), ...this.checkpointRecords(run, task, basis, id, summary)]);
      const immutable = checkImmutability(await loadCommittedProject(run.path, run.initialCommit!), await this.project(runId));
      if (immutable.length) throw new ValidationFailure(immutable);
      const head = await this.commit(run, registration, run.headCommit!, 'task: preserve checkpoint', lease);
      run.headCommit = head; run.checkpointId = id; run.status = runStatus; run.validation = { valid: true, codes: [] };
      await this.save(run); return run;
    });
  }

  async fakeDraft(runId: string, options: FakeDraftOptions): Promise<Run> {
    const initial = await this.run(runId);
    const executePath = join(this.directory(runId), 'execution.lock');
    return withKernelLock(executePath, `execution:${runId}`, async () => {
      if (!['queued', 'interrupted', 'cancelling'].includes((await this.run(runId)).run.status)) throw new Error('RUN_NOT_EXECUTABLE');
      const checkCancelled = async (): Promise<void> => { if (options.signal?.aborted || (await this.run(runId)).run.cancelRequested) throw new Error('FAKE_CANCELLED'); };
      try {
        await withWorktreeLock(initial.run.path, async lease => {
          const { run } = await this.run(runId);
          await checkCancelled();
          if (!['queued', 'interrupted'].includes(run.status)) throw new Error('RUN_NOT_EXECUTABLE');
          await assertNoPending(this.directory(runId));
          run.status = 'running'; await this.save(run);
          const snapshot = await this.project(runId);
          const task = rawObject<Task>(snapshot.files, `tasks/${run.taskId}/task.yaml`); task.status = 'active';
          await this.write(run, lease, snapshot, [objectFile(`tasks/${run.taskId}/task.yaml`, task)]);
        });
        await options.onPhase?.('started'); await checkCancelled();
        const file = `draft-${newId('draft')}.md`;
        await this.saveDraft(runId, file, options.body, null);
        await options.onPhase?.('saved'); await checkCancelled();
        const { run } = await this.run(runId);
        await withWorktreeLock(run.path, async lease => {
          const current = await this.project(runId);
          const task = rawObject<Task>(current.files, `tasks/${run.taskId}/task.yaml`);
          const parent = current.baselines.get(task.base.baseline_id)?.value.selected[options.entityId];
          const revision = parent ? current.entities.get(options.entityId)?.revisions.get(parent) : undefined;
          if (!revision?.writable) throw new Error('ENTITY_NOT_SELECTED_OR_READ_ONLY');
          const id = newId('rev');
          const meta: Revision = { ...revision.meta, revision_id: id, parents: [parent!], status: 'draft', body_path: 'content.md', created_at: new Date().toISOString(), created_by: { type: 'agent', id: 'fake', task_id: run.taskId } };
          const proposal: Proposal = { id: newId('proposal'), task_id: run.taskId, base_commit: run.basisCommit, expected_baseline_fingerprint: task.base.baseline_fingerprint, input_revisions: [{ entity_id: options.entityId, revision_id: parent! }], changes: [{ action: 'add_revision', entity_id: options.entityId, revision_id: id }] };
          await this.write(run, lease, current, [objectFile(`entities/${options.entityId}/revisions/${id}/meta.yaml`, meta), textFile(`entities/${options.entityId}/revisions/${id}/content.md`, options.body), objectFile(`tasks/${run.taskId}/proposals/${proposal.id}.yaml`, proposal)]);
        });
        await checkCancelled();
        return await this.checkpoint(runId, 'ready_for_review', 'fake 실행기의 새 초안과 변경안을 보존했다.', 'completed');
      } catch (error) {
        const cancelled = String(error).includes('FAKE_CANCELLED');
        const { run } = await this.run(runId); run.error = String(error); await this.save(run);
        if ((await pendingTransactions(this.directory(runId))).length) { run.status = 'interrupted'; run.workspaceState = 'recovering'; await this.save(run); return run; }
        try { return await this.checkpoint(runId, cancelled ? 'cancelled' : 'failed', cancelled ? '중단을 확인하고 작성 중 결과를 보존했다.' : `실패 결과를 보존했다: ${String(error)}`, cancelled ? 'cancelled' : 'failed'); }
        catch (preservationError) {
          run.status = 'failed'; run.validation = { valid: false, codes: [preservationError instanceof ValidationFailure ? preservationError.diagnostics[0]?.code ?? 'PRESERVATION_FAILED' : 'PRESERVATION_FAILED'] }; run.error = String(preservationError);
          await this.save(run); return run; // Keep the complete dirty folder. Never claim it is committed/cleanable.
        }
      }
    });
  }

  async cancel(runId: string): Promise<Run> {
    const { run } = await this.run(runId);
    return withWorktreeLock(run.path, async () => {
      const value = (await this.run(runId)).run;
      if (['completed', 'failed', 'cancelled'].includes(value.status)) return value;
      value.cancelRequested = true; value.status = 'cancelling'; await this.save(value); return value;
    });
  }
  async recover(runId: string): Promise<Run> {
    const { run, registration } = await this.run(runId);
    return withKernelLock(join(this.directory(runId), 'execution.lock'), `execution:${runId}`, async () => {
      await withWorktreeLock(run.path, async lease => {
        await recoverTransactions(run.path, this.directory(runId), lease, this.writeOptions(run));
        const actual = await gitText(run.path, ['rev-parse', 'HEAD']);
        if (actual !== (run.headCommit ?? run.basisCommit)) {
          // Git may have committed successfully immediately before the local journal write crashed.
          await runGit(run.path, ['merge-base', '--is-ancestor', run.headCommit ?? run.basisCommit, actual]);
          const committed = await loadCommittedProject(run.path, actual);
          const task = rawObject<Task>(committed.files, `tasks/${run.taskId}/task.yaml`);
          const checkpoint = rawObject<Checkpoint>(committed.files, `tasks/${run.taskId}/checkpoints/${task.latest_checkpoint}.yaml`);
          if (committed.project.project_id !== run.projectId || checkpoint.provider_hint?.session_id !== runId || fingerprint(await captureFiles(run.path, false)) !== fingerprint(await readCommittedFiles(run.path, actual, false))) throw new Error('COMMIT_RECOVERY_REQUIRES_EXPLICIT_RESUME');
          const invalid = checkImmutability(await loadCommittedProject(run.path, run.headCommit ?? run.basisCommit), committed);
          if (invalid.length) throw new ValidationFailure(invalid);
          run.headCommit = actual; run.initialCommit ??= actual; run.checkpointId = task.latest_checkpoint;
        } else if (!run.initialCommit) {
          const current = await loadProject(run.path);
          const task = rawObject<Task>(current.files, `tasks/${run.taskId}/task.yaml`);
          const checkpoint = rawObject<Checkpoint>(current.files, `tasks/${run.taskId}/checkpoints/${task.latest_checkpoint}.yaml`);
          if (checkpoint.provider_hint?.session_id !== runId) throw new Error('INITIAL_CHECKPOINT_MISSING');
          run.headCommit = await this.commit(run, registration, run.basisCommit, 'task: recover initial checkpoint', lease);
          run.initialCommit = run.headCommit; run.checkpointId = task.latest_checkpoint;
        }
        run.workspaceState = 'present'; run.status = 'interrupted'; await this.save(run);
      });
      return this.checkpoint(runId, 'paused', '중단된 실행의 보존 가능한 파일을 복구했다. 새 실행은 사용자 선택 후 시작한다.', 'interrupted');
    });
  }

  async cleanup(runId: string): Promise<void> {
    const { run, registration } = await this.run(runId);
    await withKernelLock(join(this.directory(runId), 'execution.lock'), `execution:${runId}`, () => withWorktreeLock(run.path, async () => {
      if (!['completed', 'cancelled', 'failed', 'interrupted'].includes(run.status) || !run.headCommit || !run.checkpointId) throw new Error('WORKTREE_UNPRESERVED');
      await assertNoPending(this.directory(runId));
      if (await gitText(run.path, ['rev-parse', 'HEAD']) !== run.headCommit) throw new Error('WORKTREE_UNPRESERVED');
      const expected = await readCommittedFiles(run.path, run.headCommit, false);
      if (fingerprint(await captureFiles(run.path, false)) !== fingerprint(expected)) throw new Error('WORKTREE_UNPRESERVED');
      const task = rawObject<Task>(expected, `tasks/${run.taskId}/task.yaml`);
      if (task.latest_checkpoint !== run.checkpointId || !expected.has(`tasks/${run.taskId}/checkpoints/${run.checkpointId}.yaml`)) throw new Error('WORKTREE_UNPRESERVED');
      await withMetadataLock(registration.root, () => runGit(registration.root, ['worktree', 'remove', '--', run.path]).then(() => undefined));
      run.workspaceState = 'removed'; await this.save(run); // branch and checkpoint refs remain
    }));
  }

  private async snapshot(registration: Registration, commit: string, paths: readonly string[]): Promise<Operation> {
    const id = newId('snap');
    const op: Operation = { protocol: 1, id, kind: 'snapshot', registrationId: registration.id, path: join(this.appData, 'snapshots', id), branch: `workbench/snapshot/${id}`, basisCommit: commit, status: 'starting' };
    await writeState(this.appData, join(this.appData, 'operations', id + '.json'), 'Operation', op);
    const files = new Map(await readCommittedFiles(registration.root, commit, false));
    const before = parseProject(canonicalFiles(files));
    const seen = new Set<string>();
    for (const path of paths) {
      if (!isProjectPath(path) || path.split('/').some(part => part.toLowerCase() === '.git') || seen.has(path)) throw new Error('DIRTY_SELECTION_INVALID');
      seen.add(path);
      let file: SourceFile | undefined;
      try { file = await readSource(registration.root, path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (!file && !files.has(path)) throw new Error('DIRTY_SELECTION_INVALID');
      if (file) files.set(path, file); else files.delete(path);
    }
    const portable = new Set<string>();
    for (const path of files.keys()) {
      const key = path.normalize('NFC').toLowerCase();
      if (portable.has(key)) throw new Error('DIRTY_SELECTION_PATH_COLLISION');
      portable.add(key);
    }
    const after = parseProject(canonicalFiles(files));
    const invalid = checkImmutability(before, after); if (invalid.length) throw new ValidationFailure(invalid);
    try {
    const workspace = await withMetadataLock(registration.root, () => createOwnedWorkspace(registration.root, this.appData, op.path, op.branch, commit));
    await withWorktreeLock(workspace.path, async () => {
      const base = await readCommittedFiles(workspace.path, commit, false);
      for (const { path, file } of delta(base, files)) {
        const target = join(workspace.path, ...path.split('/'));
        await assertOwnedPath(workspace.path, target);
        if (file) {
          await atomicBytes(workspace.path, target, Buffer.from(file.contentBase64, 'base64'));
        } else await unlink(target);
      }
      op.resultCommit = await withMetadataLock(registration.root, () => preserveWorkspace(workspace, commit, delta(base, files), 'snapshot: preserve explicitly selected working files'));
      op.status = 'completed'; await writeState(this.appData, join(this.appData, 'operations', id + '.json'), 'Operation', op);
    });
    return op;
    } catch (error) { op.status = 'failed'; op.error = String(error); await writeState(this.appData, join(this.appData, 'operations', id + '.json'), 'Operation', op); throw error; }
  }

  /** Trusted manual commands share the same lease, journal and checkpoint boundary. */
  async edit<T>(runId: string, expectedSnapshot: string, build: (current: ProjectSnapshot, run: Run) => Promise<{ files: readonly SourceFile[]; result: T }> | { files: readonly SourceFile[]; result: T }): Promise<T> {
    const { run, registration } = await this.run(runId);
    return withWorktreeLock(run.path, async lease => {
      const current = await this.project(runId), value = await build(current, run);
      if (!value.files.length) return value.result; // Persisted, verified idempotent replay.
      if (current.fingerprint !== expectedSnapshot) throw fileFailure('BASE_CHANGED', 'Working snapshot changed before manual command', 'project.yaml');
      const task = rawObject<Task>(current.files, `tasks/${run.taskId}/task.yaml`), id = newId('cp');
      if (value.files.some(file => file.path === `tasks/${run.taskId}/task.yaml` || !this.writeOptions(run).allowedPrefixes.some(prefix => file.path.startsWith(prefix)))) throw fileFailure('WRITE_SCOPE_FORBIDDEN', 'Manual command is outside its task', 'project.yaml');
      task.status = 'ready_for_review'; task.latest_checkpoint = id;
      task.outputs = [...new Set([...task.outputs, ...value.files.map(file => file.path)])];
      const basis = await loadCommittedProject(registration.root, run.basisCommit);
      await this.write(run, lease, current, [...value.files, objectFile(`tasks/${task.id}/task.yaml`, task), ...this.checkpointRecords(run, task, basis, id, 'Manual changes preserved for user review.')]);
      run.headCommit = await this.commit(run, registration, run.headCommit!, 'task: preserve manual changes', lease);
      run.checkpointId = id; run.status = 'interrupted'; run.validation = { valid: true, codes: [] }; await this.save(run);
      return value.result;
    });
  }

  async prepareIntegration(registrationId: string, resultCommit: string, targetRef?: string): Promise<Operation> {
    const registration = await getRegistration(this.appData, registrationId);
    const ref = targetRef ?? await gitText(registration.root, ['symbolic-ref', '--short', 'HEAD']);
    const commit = await gitText(registration.root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
    const result = await loadCommittedProject(registration.root, resultCommit);
    if (result.project.project_id !== registration.projectId) throw new Error('PROJECT_SCOPE_MISMATCH');
    const id = newId('op');
    const op: Operation = { protocol: 1, id, kind: 'integration', registrationId, path: join(this.appData, 'integrations', id), branch: `workbench/integration/${id}`, basisCommit: commit, inputCommit: resultCommit, status: 'starting' };
    await writeState(this.appData, join(this.appData, 'operations', id + '.json'), 'Operation', op);
    try {
    await withMetadataLock(registration.root, () => createOwnedWorkspace(registration.root, this.appData, op.path, op.branch, commit));
    op.status = 'ready'; await writeState(this.appData, join(this.appData, 'operations', id + '.json'), 'Operation', op);
    return op;
    } catch (error) { op.status = 'failed'; op.error = String(error); await writeState(this.appData, join(this.appData, 'operations', id + '.json'), 'Operation', op); throw error; }
  }
}
