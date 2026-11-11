import { access, mkdir, realpath } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { canonicalJson } from '../../domain/src/canonical.js';
import { ValidationFailure } from '../../domain/src/model.js';
import type { Diagnostic } from '../../domain/src/model.js';
import { captureFiles, fingerprint, hash, newId } from '../../project-fs/src/files.js';
import { readCommittedFiles } from '../../project-fs/src/git-baseline.js';
import { assertNoPending, assertSavedRecords } from '../../project-fs/src/writer.js';
import { assertOwnedPath, checkedManagedRoot } from '../../git-workspace/src/worktree.js';
import { gitText, runGit } from '../../git-workspace/src/git.js';
import { gitLocations, withKernelLock, withWorktreeLock } from '../../git-workspace/src/locks.js';
import { sourceEpochAt } from '../../git-workspace/src/generation.js';
import { renameWithRetry } from '../../git-workspace/src/fs.js';
import { getRegistration } from '../../tasks/src/projects.js';
import { TaskService } from '../../tasks/src/service.js';
import { INDEX_FORMAT } from './types.js';
import { sourceFingerprint } from './fingerprint.js';
import type { CapturedSource, IndexFailure, IndexManifest, IndexStatus, QueryEnvelope, QueryOptions, ScopeIdentity, WorkerReply } from './types.js';

export class IndexError extends Error { constructor(readonly code: string, message = code) { super(message); this.name = 'IndexError'; } }
type RebuildOptions = { full?: boolean; failBeforeCommit?: boolean; onPhase?: (phase: 'captured' | 'prepared' | 'published') => Promise<void> };
/** Application-bound scope. A query cannot choose another path/project/run by changing its arguments. */
export class ProjectIndex {
  readonly scopeToken = newId('scope');
  readonly scopeKey: string;
  readonly databasePath: string;
  private readonly cacheRoot: string;
  private worker: Worker | undefined;
  private requestId = 0;
  private waiting = new Map<number, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>();
  private closed = false;
  private stopping = false;
  private rebuilding = false;
  private constructor(readonly appData: string, readonly scope: Readonly<ScopeIdentity>) {
    this.scope = Object.freeze({ ...scope });
    this.scopeKey = hash(canonicalJson({ ...scope, indexFormat: INDEX_FORMAT }));
    this.cacheRoot = join(appData, 'caches', this.scopeKey);
    this.databasePath = join(this.cacheRoot, 'index.sqlite');
  }
  static async registered(appData: string, registrationId: string): Promise<ProjectIndex> {
    const storage = await realpath(appData), registration = await getRegistration(storage, registrationId);
    if (!registration.projectId || !['ready', 'unsupported'].includes(registration.status)) throw new IndexError('PROJECT_NOT_READY');
    if (registration.root.startsWith(join(storage, 'worktrees') + sep)) throw new IndexError('RUN_SCOPE_REQUIRED');
    await checkedManagedRoot(storage, registration.root);
    const locations = await gitLocations(registration.root);
    if (registration.id !== registrationId || locations.commonDir !== registration.commonDir) throw new IndexError('CONTEXT_FORBIDDEN');
    const index = new ProjectIndex(storage, { registrationId, projectId: registration.projectId, root: locations.root, commonDir: locations.commonDir, gitDir: locations.gitDir, worktreeId: 'checkout_' + hash(locations.gitDir), view: 'working' });
    await index.prepareDirectory(); return index;
  }
  static async run(appData: string, runId: string, view: 'basis' | 'working' = 'working'): Promise<ProjectIndex> {
    if (!['basis', 'working'].includes(view)) throw new IndexError('CONTEXT_FORBIDDEN');
    const storage = await realpath(appData), { run, registration } = await new TaskService(storage).run(runId, view === 'working');
    const root = view === 'basis' ? registration.root : run.path, locations = await gitLocations(root);
    const index = new ProjectIndex(storage, { registrationId: registration.id, projectId: run.projectId, root, commonDir: locations.commonDir, gitDir: locations.gitDir, worktreeId: run.worktreeId, taskId: run.taskId, runId, view, ...(view === 'basis' ? { basisCommit: run.basisCommit } : {}) });
    await index.prepareDirectory(); return index;
  }
  static async committed(appData: string, registrationId: string, commit: string): Promise<ProjectIndex> {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) throw new IndexError('GIT_INVALID_COMMIT');
    const registered = await ProjectIndex.registered(appData, registrationId);
    await gitText(registered.scope.root, ['rev-parse', '--verify', '--end-of-options', `${commit}^{commit}`]);
    const index = new ProjectIndex(registered.appData, { ...registered.scope, view: 'basis', basisCommit: commit }); await index.prepareDirectory(); return index;
  }
  private async prepareDirectory(): Promise<void> { await assertOwnedPath(this.appData, this.databasePath); await mkdir(this.cacheRoot, { recursive: true }); await assertOwnedPath(this.appData, this.databasePath); }
  private authorize(token: string): void { if (this.closed || token !== this.scopeToken) throw new IndexError('CONTEXT_FORBIDDEN'); }
  private async binding(): Promise<{ immutableCommit?: string }> {
    const registration = await getRegistration(this.appData, this.scope.registrationId);
    if (registration.projectId !== this.scope.projectId || registration.commonDir !== this.scope.commonDir) throw new IndexError('CONTEXT_FORBIDDEN');
    if (this.scope.runId) {
      const { run, registration: current } = await new TaskService(this.appData).run(this.scope.runId, this.scope.view === 'working');
      if (run.worktreeId !== this.scope.worktreeId || run.taskId !== this.scope.taskId || (this.scope.view === 'working' ? run.path : current.root) !== this.scope.root || (this.scope.view === 'basis' && run.basisCommit !== this.scope.basisCommit)) throw new IndexError('CONTEXT_FORBIDDEN');
      if (this.scope.view === 'working') { await assertNoPending(join(this.appData, 'runs', run.runId)); return { immutableCommit: run.headCommit ?? run.basisCommit }; }
    } else if (registration.root !== this.scope.root) throw new IndexError('CONTEXT_FORBIDDEN');
    return {};
  }
  private async captureUnlocked(includeImmutable: boolean): Promise<CapturedSource> {
    const binding = await this.binding();
    if (this.scope.view === 'basis') {
      const files = await readCommittedFiles(this.scope.root, this.scope.basisCommit!);
      const source = { fileFingerprint: fingerprint(files), headCommit: this.scope.basisCommit!, reference: 'basis', epoch: null };
      return { files: [...files.values()], immutableFiles: [], source, sourceFingerprint: sourceFingerprint(this.scopeKey, source) };
    }
    const metadata = (await runGit(this.scope.root, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--absolute-git-dir', '--git-common-dir', 'HEAD'])).stdout.toString('utf8').trim().split(/\r?\n/);
    if (metadata.length !== 4 || await realpath(metadata[0]!) !== this.scope.root || await realpath(metadata[1]!) !== this.scope.gitDir || await realpath(metadata[2]!) !== this.scope.commonDir) throw new IndexError('CONTEXT_FORBIDDEN');
    const files = await captureFiles(this.scope.root), headCommit = metadata[3]!;
    if (this.scope.runId) await assertSavedRecords(join(this.appData, 'runs', this.scope.runId), files);
    const immutableFiles = includeImmutable ? await readCommittedFiles(this.scope.root, binding.immutableCommit ?? headCommit) : new Map();
    const source = { fileFingerprint: fingerprint(files), headCommit, reference: 'HEAD', epoch: await sourceEpochAt(this.scope.commonDir, this.scope.gitDir) };
    return { files: [...files.values()], immutableFiles: [...immutableFiles.values()], source, sourceFingerprint: sourceFingerprint(this.scopeKey, source) };
  }
  private async sourceLock<T>(action: () => Promise<T>): Promise<T> {
    // Identity is bound at factory creation and revalidated inside captureUnlocked before file reads.
    // Reuse the exact shared worktree lock key without launching Git again just to calculate it.
    await access(this.scope.root); await access(this.scope.gitDir);
    const identity = relative(this.scope.commonDir, this.scope.gitDir) || '.';
    return withKernelLock(join(this.scope.commonDir, 'craft', 'locks', `worktree-${hash(identity)}.lock`), `worktree:${this.scope.commonDir}:${identity}`, action);
  }
  private capture(includeImmutable = false): Promise<CapturedSource> { return this.scope.view === 'basis' ? this.captureUnlocked(includeImmutable) : this.sourceLock(() => this.captureUnlocked(includeImmutable)); }
  private rpc<T>(operation: string, payload: unknown = {}): Promise<T> {
    if ((this.closed || this.stopping) && operation !== 'close') return Promise.reject(new IndexError('CONTEXT_FORBIDDEN'));
    if (!this.worker) {
      const url = import.meta.url.endsWith('.ts') ? pathToFileURL(resolve('dist/packages/indexer/src/worker.js')) : new URL('./worker.js', import.meta.url);
      this.worker = new Worker(url, { workerData: { path: this.databasePath, scopeKey: this.scopeKey, projectId: this.scope.projectId }, resourceLimits: { maxOldGenerationSizeMb: 1024 } });
      const worker = this.worker;
      worker.on('message', (message: WorkerReply) => {
        if (this.worker !== worker) return;
        const listener = this.waiting.get(message.id); if (!listener) return; this.waiting.delete(message.id);
        if (message.error) listener.reject(message.error.diagnostics ? new ValidationFailure(message.error.diagnostics) : new IndexError(message.error.code, message.error.message)); else listener.resolve(message.result);
      });
      const fail = (error: unknown) => { if (this.worker !== worker) return; for (const listener of this.waiting.values()) listener.reject(error); this.waiting.clear(); this.worker = undefined; };
      worker.on('error', fail); worker.on('exit', () => fail(new IndexError('INDEX_WORKER_FAILED')));
    }
    const id = ++this.requestId;
    return new Promise<T>((resolve, reject) => { this.waiting.set(id, { resolve: value => resolve(value as T), reject }); this.worker!.postMessage({ id, operation, payload }); });
  }
  private async stopWorker(): Promise<void> { const worker = this.worker; if (!worker) return; this.stopping = true; try { await this.rpc('close'); } finally { await worker.terminate(); if (this.worker === worker) this.worker = undefined; this.stopping = false; } }
  private async quarantine(): Promise<void> {
    await this.stopWorker();
    for (const suffix of ['', '-wal', '-shm']) {
      const path = this.databasePath + suffix; await assertOwnedPath(this.appData, path);
      try { await access(path); await renameWithRetry(path, join(this.cacheRoot, newId('quarantine') + suffix + '.sqlite')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }
  async status(scopeToken: string): Promise<IndexStatus> {
    this.authorize(scopeToken);
    const state = await this.rpc<{ manifest: IndexManifest | null; failure: IndexFailure | null }>('manifest');
    try {
      const source = await this.capture();
      return { ...state, currentSourceFingerprint: source.sourceFingerprint, freshness: this.rebuilding ? 'rebuilding' : state.manifest?.sourceFingerprint === source.sourceFingerprint ? 'fresh' : state.failure?.sourceFingerprint === source.sourceFingerprint && state.failure.code === 'SOURCE_INVALID' ? 'invalid_source' : 'stale' };
    } catch (error) {
      if (error instanceof IndexError && error.code === 'CONTEXT_FORBIDDEN' || error instanceof ValidationFailure && error.diagnostics.some(d => ['RECOVERY_REQUIRED', 'RUN_SCOPE_MISMATCH', 'RUN_SCOPE_CHANGED', 'WORKTREE_MISSING'].includes(d.code))) throw error;
      return { ...state, currentSourceFingerprint: null, freshness: this.rebuilding || error instanceof ValidationFailure && error.diagnostics.some(d => d.code === 'WORKTREE_BUSY') ? 'rebuilding' : 'invalid_source', failure: { sourceFingerprint: null, code: error instanceof IndexError ? error.code : 'SOURCE_INVALID', diagnostics: error instanceof ValidationFailure ? error.diagnostics : [] } };
    }
  }
  async rebuild(scopeToken: string, options: RebuildOptions = {}): Promise<IndexManifest> {
    this.authorize(scopeToken);
    if (this.rebuilding) throw new IndexError('WORKTREE_BUSY');
    this.rebuilding = true;
    let captured: CapturedSource | undefined;
    try { return await withKernelLock(join(this.cacheRoot, 'index.lock'), `index:${this.scopeKey}`, async lease => {
      try { await this.rpc('manifest'); } catch (error) { if (!(error instanceof IndexError) || error.code !== 'INDEX_CORRUPT') throw error; await this.quarantine(); }
      captured = await this.capture(true); await options.onPhase?.('captured');
      const prepared = await this.rpc<{ noop: boolean; token?: string; manifest: IndexManifest }>('prepare', { ...captured, full: options.full ?? false });
      await options.onPhase?.('prepared');
      const publish = async () => {
        lease.assert(`index:${this.scopeKey}`);
        const now = await this.captureUnlocked(false);
        if (now.sourceFingerprint !== captured!.sourceFingerprint) throw new IndexError('SOURCE_CHANGED');
        const manifest = prepared.noop ? prepared.manifest : await this.rpc<IndexManifest>('publish', { token: prepared.token, failBeforeCommit: options.failBeforeCommit ?? false });
        if ((await this.captureUnlocked(false)).sourceFingerprint !== manifest.sourceFingerprint) throw new IndexError('SOURCE_CHANGED');
        return manifest;
      };
      const manifest = this.scope.view === 'basis' ? await publish() : await this.sourceLock(publish);
      await options.onPhase?.('published'); return manifest;
    }); } catch (error) {
      await this.rpc('discard').catch(() => {});
      await this.rpc('failure', { sourceFingerprint: captured?.sourceFingerprint ?? null, code: error instanceof IndexError ? error.code : 'SOURCE_INVALID', diagnostics: error instanceof ValidationFailure ? error.diagnostics : [] } satisfies IndexFailure).catch(() => {});
      throw error;
    } finally { this.rebuilding = false; }
  }
  async query<T = unknown>(operation: 'catalog' | 'exact' | 'selected' | 'search' | 'analyze' | 'reverse' | 'diff' | 'tasks' | 'state' | 'state-input', args: Record<string, unknown>, options: QueryOptions): Promise<QueryEnvelope<T>> {
    this.authorize(options.scopeToken);
    if (options.perspective !== undefined && options.perspective !== 'author') throw new IndexError('CONTEXT_FORBIDDEN');
    if (operation === 'analyze' && options.allowStale) throw new IndexError('INDEX_STALE');
    let state: IndexStatus;
    try { state = await this.status(options.scopeToken); }
    catch (error) { if (!(error instanceof IndexError) || error.code !== 'INDEX_CORRUPT' || options.autoRebuild === false) throw error; await this.rebuild(options.scopeToken); state = await this.status(options.scopeToken); }
    if (state.freshness !== 'fresh' && (!options.allowStale || !state.manifest)) {
      if (options.autoRebuild === false) throw new IndexError('INDEX_STALE');
      await this.rebuild(options.scopeToken); state = await this.status(options.scopeToken);
      if (state.freshness !== 'fresh') throw new IndexError(state.freshness === 'rebuilding' ? 'WORKTREE_BUSY' : 'SOURCE_CHANGED');
    }
    const result = await this.rpc<{ data: T; baselineFingerprint: string; baselineId: string; manifest: IndexManifest }>('query', { operation, args, ...(options.baselineId ? { baselineId: options.baselineId } : {}), ...(options.scope ? { scope: options.scope } : {}), perspective: options.perspective ?? 'author' });
    const snapshotToken = hash(canonicalJson({ scopeKey: this.scopeKey, generationId: result.manifest.generationId, sourceFingerprint: result.manifest.sourceFingerprint, baselineId: result.baselineId, baselineFingerprint: result.baselineFingerprint }));
    if (options.expectedSnapshot && options.expectedSnapshot !== snapshotToken) throw new IndexError('BASE_CHANGED');
    await options.onPhase?.('queried');
    const final = await this.status(options.scopeToken);
    if (final.currentSourceFingerprint !== result.manifest.sourceFingerprint && !options.allowStale) throw new IndexError('SOURCE_CHANGED');
    return { data: result.data, scope: this.scope, snapshotToken, sourceFingerprint: result.manifest.sourceFingerprint, currentSourceFingerprint: final.currentSourceFingerprint, baselineFingerprint: result.baselineFingerprint, generationId: result.manifest.generationId, freshness: final.currentSourceFingerprint === result.manifest.sourceFingerprint ? 'fresh' : final.freshness === 'invalid_source' ? 'invalid_source' : 'stale' };
  }
  async close(): Promise<void> { if (this.closed) return; this.closed = true; await this.stopWorker(); }
}
