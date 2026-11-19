import { access, cp, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { objectFile } from '../../project-fs/src/content.js';
import { hash } from '../../project-fs/src/files.js';
import { parseYaml } from '../../project-fs/src/yaml.js';
import { runGit } from '../../git-workspace/src/git.js';
import { cloneProject, registerLocal } from '../../tasks/src/projects.js';
import { TaskService } from '../../tasks/src/service.js';
import { ValidationFailure } from '../../domain/src/model.js';
import type { BaselineAnalysis } from '../../domain/src/analysis.js';
import { ProjectIndex, IndexError } from './service.js';
import type { IndexFixture } from './test-helpers.js';
import { indexFixture, commitFixture, removeIndexFixture } from './test-helpers.js';

const used: IndexFixture[] = [], open: ProjectIndex[] = [];
async function fixture(name?: string) { const result = await indexFixture(name); used.push(result); return result; }
async function registered(name?: string) { const f = await fixture(name), registration = await registerLocal(f.app, f.root), index = await ProjectIndex.registered(f.app, registration.id); open.push(index); return { ...f, registration, index, options: { scopeToken: index.scopeToken } }; }
afterEach(async () => { for (const index of open.splice(0)) await index.close(); for (const f of used.splice(0)) await removeIndexFixture(f); });
const metaPath = 'entities/ent_overview/revisions/rev_overview_a/meta.yaml';
async function child(root: string, id = 'rev_other', text = '독립된 새로운 원고입니다.\n') {
  const meta = parseYaml(await readFile(join(root, metaPath), 'utf8'), metaPath).value as Record<string, unknown>;
  const folder = join(root, 'entities/ent_overview/revisions', id); await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'meta.yaml'), objectFile('meta.yaml', { ...meta, revision_id: id, parents: ['rev_overview_a'], title: '새로운 개요', status: 'draft' }).text!);
  await writeFile(join(folder, 'content.md'), text);
}
async function code(action: Promise<unknown>, expected: string) {
  try { await action; expect.fail(`Expected ${expected}`); }
  catch (error) { if (error instanceof ValidationFailure) expect(error.diagnostics.map(d => d.code)).toContain(expected); else expect((error as IndexError).code).toBe(expected); }
}
type Search = { hits: { type: string; entityId?: string; revisionId?: string; snippet: string; path?: string; match: string }[]; strategy: string };

describe('rebuildable scoped SQLite index', () => {
  it('makes the actual stage-3 reader refuse writes to the new required state contract', async () => {
    const f = await fixture('state-model'), legacy = join(f.home, 'legacy-reader'), archive = join(f.home, 'legacy.tar');
    await mkdir(legacy);
    await runGit(process.cwd(), ['archive', '--format=tar', `--output=${archive}`, '2220dc5', 'packages']);
    const execute = promisify(execFile);
    await execute('tar', ['-xf', archive, '-C', legacy]);
    const config = join(legacy, 'tsconfig.json');
    await writeFile(config, JSON.stringify({ extends: resolve('tsconfig.json'), compilerOptions: { rootDir: legacy, outDir: join(legacy, 'dist'), declaration: false, sourceMap: false }, include: ['packages/**/*.ts'], exclude: ['**/*.test.ts', '**/test-helpers.ts'] }));
    await execute(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '-p', config]);
    const moduleUrl = pathToFileURL(join(legacy, 'dist/packages/project-fs/src/project.js')).href;
    const script = `const {loadProject}=await import(${JSON.stringify(moduleUrl)});const p=await loadProject(${JSON.stringify(f.root)});console.log(JSON.stringify({writable:p.writable,codes:p.diagnostics.map(d=>d.code)}));`;
    const result = JSON.parse((await execute(process.execPath, ['--input-type=module', '-e', script])).stdout) as { writable: boolean; codes: string[] };
    expect(result.writable).toBe(false); expect(result.codes).toContain('UNSUPPORTED_REQUIRED_EXTENSION');
    expect((await runGit(f.root, ['status', '--porcelain'])).stdout.toString()).toBe('');
  }, 60_000);

  it('builds in a worker and restores identical canonical results after deleting the DB', async () => {
    const f = await registered(), manifest = await f.index.rebuild(f.index.scopeToken);
    expect(manifest.timings.workerThreadId).toBeGreaterThan(0); expect(manifest.counts.revisions).toBe(1);
    const before = await f.index.query('exact', { entityId: 'ent_overview', revisionId: 'rev_overview_a' }, f.options);
    const analysis = await f.index.query<BaselineAnalysis>('analyze', {}, f.options); expect(analysis.data.releaseEligible).toBe(true);
    const tasks = await f.index.query('tasks', {}, f.options);
    await f.index.close(); await unlink(f.index.databasePath);
    const restored = await ProjectIndex.registered(f.app, f.registration.id); open.push(restored);
    const options = { scopeToken: restored.scopeToken };
    const after = await restored.query('exact', { entityId: 'ent_overview', revisionId: 'rev_overview_a' }, options);
    expect(after.data).toEqual(before.data); expect(after.sourceFingerprint).toBe(before.sourceFingerprint); expect(after.snapshotToken).not.toBe(before.snapshotToken);
    expect((await restored.query('tasks', {}, options)).data).toEqual(tasks.data);
    expect((await restored.query<BaselineAnalysis>('analyze', {}, options)).data).toEqual(analysis.data);
  }, 60_000);

  it('incrementally adds/removes revisions without moving a baseline or inventing latest', async () => {
    const f = await registered(); const first = await f.index.rebuild(f.index.scopeToken);
    await child(f.root);
    expect((await f.index.status(f.index.scopeToken)).freshness).toBe('stale');
    await code(f.index.query('search', { text: '새로운' }, { ...f.options, autoRebuild: false }), 'INDEX_STALE');
    const next = await f.index.rebuild(f.index.scopeToken);
    expect(next.mode).toBe('incremental'); expect(next.updatedRevisions).toEqual(['ent_overview/rev_other']); expect(next.changedFiles).toHaveLength(2);
    expect((await f.index.query<Search>('search', { text: '독립된', includeHistory: true }, f.options)).data.hits.map(hit => hit.revisionId)).toEqual(['rev_other']);
    expect((await f.index.query<Search>('search', { text: '독립된' }, f.options)).data.hits).toEqual([]);
    const selected = await f.index.query<{ revisionId: string }>('selected', { entityId: 'ent_overview' }, f.options); expect(selected.data.revisionId).toBe('rev_overview_a');
    const diff = await f.index.query<{ body: { changed: boolean }; semanticBefore: string; semanticAfter: string }>('diff', { entityId: 'ent_overview', before: 'rev_overview_a', after: 'rev_other' }, f.options); expect(diff.data.body.changed).toBe(true); expect(diff.data.semanticBefore).not.toBe(diff.data.semanticAfter);
    await unlink(join(f.root, 'entities/ent_overview/revisions/rev_other/meta.yaml')); await unlink(join(f.root, 'entities/ent_overview/revisions/rev_other/content.md'));
    const removed = await f.index.rebuild(f.index.scopeToken); expect(removed.removedRevisions).toEqual(['ent_overview/rev_other']);
    expect(removed.generation).toBe(first.generation + 2);
    expect((await f.index.query<Search>('search', { text: '독립된', includeHistory: true }, f.options)).data.hits).toEqual([]);
  }, 60_000);

  it('preserves the previous committed generation on a source race and a SQLite rollback', async () => {
    const f = await registered(), first = await f.index.rebuild(f.index.scopeToken);
    await code(f.index.rebuild(f.index.scopeToken, { onPhase: async phase => { if (phase === 'prepared') await writeFile(join(f.root, 'README.md'), 'source race\n'); } }), 'SOURCE_CHANGED');
    expect((await f.index.status(f.index.scopeToken)).manifest!.generationId).toBe(first.generationId);
    await child(f.root, 'rev_other', '오류 후에도 이전 색인을 보존합니다.\n');
    await code(f.index.rebuild(f.index.scopeToken, { failBeforeCommit: true }), 'SIMULATED_SQLITE_FAILURE');
    const status = await f.index.status(f.index.scopeToken); expect(status.manifest!.generationId).toBe(first.generationId); expect(status.freshness).toBe('stale');
    const stale = await f.index.query('exact', { entityId: 'ent_overview', revisionId: 'rev_overview_a' }, { ...f.options, allowStale: true }); expect(stale.freshness).toBe('stale'); expect(stale.generationId).toBe(first.generationId);
    await code(f.index.query('analyze', {}, { ...f.options, allowStale: true }), 'INDEX_STALE');
    expect((await f.index.rebuild(f.index.scopeToken)).generation).toBe(first.generation + 1);
  }, 60_000);

  it('blocks invalid immutable source, retains a stale view and refuses a read race or old snapshot', async () => {
    const f = await registered(); const old = await f.index.query('exact', { entityId: 'ent_overview', revisionId: 'rev_overview_a' }, f.options);
    const path = join(f.root, 'entities/ent_overview/revisions/rev_overview_a/content.md'), original = await readFile(path);
    await writeFile(path, '수동 덮어쓰기 금지\n'); await code(f.index.rebuild(f.index.scopeToken), 'IMMUTABLE_RECORD_CHANGED');
    expect((await f.index.status(f.index.scopeToken)).freshness).toBe('invalid_source');
    const stale = await f.index.query('exact', { entityId: 'ent_overview', revisionId: 'rev_overview_a' }, { ...f.options, allowStale: true }); expect(stale.data).toEqual(old.data); expect(stale.freshness).toBe('invalid_source');
    await writeFile(path, original);
    await code(f.index.query('exact', { entityId: 'ent_overview', revisionId: 'rev_overview_a' }, { ...f.options, onPhase: async () => { await writeFile(join(f.root, 'README.md'), 'changed while querying'); } }), 'SOURCE_CHANGED');
    await code(f.index.query('exact', { entityId: 'ent_overview', revisionId: 'rev_overview_a' }, { ...f.options, expectedSnapshot: old.snapshotToken }), 'BASE_CHANGED');
  }, 60_000);

  it('uses NFC exact aliases for short names and FTS5 for real Korean manuscript substrings', async () => {
    const f = await registered();
    const meta = parseYaml(await readFile(join(f.root, metaPath), 'utf8'), metaPath).value as Record<string, unknown>;
    await writeFile(join(f.root, metaPath), objectFile(metaPath, { ...meta, aliases: ['가', '가람', 'é'] }).text!);
    await writeFile(join(f.root, 'entities/ent_overview/revisions/rev_overview_a/content.md'), '😀'.repeat(90) + '\u1100\u1161'.repeat(40) + '\n가람은 젖은 외투를 벗었다.\n서쪽 성벽 너머에서 종소리가 들렸다.\n그는 비밀 통로가 아직 열려 있음을 확인했다.\n'); await commitFixture(f.root);
    for (const text of ['가', '가람', 'e\u0301']) { const result = await f.index.query<Search>('search', { text }, f.options); expect(result.data.hits).toHaveLength(1); expect(result.data.strategy).toBe('nfc_exact'); }
    const found = await f.index.query<Search>('search', { text: '성벽 너머' }, f.options); expect(found.data.strategy).toBe('fts5_trigram'); expect(found.data.hits[0]!.snippet).toContain('비밀 통로'); expect(found.data.hits[0]).not.toHaveProperty('body');
    expect((await f.index.query<Search>('search', { text: '종소리" OR "' }, f.options)).data.hits).toEqual([]);
    const empty = 'tasks/task_outline/working/empty.md'; await writeFile(join(f.root, empty), '');
    const emptyHit = await f.index.query<Search>('search', { text: empty, mode: 'exact', includeFiles: true }, f.options); expect(emptyHit.data.hits[0]!.snippet).toBe('');
  }, 60_000);

  it('isolates registrations and run working/basis views, including pending-journal blocking', async () => {
    const f = await registered(), tasks = new TaskService(f.app);
    const a = await tasks.start(f.registration.id, { goal: 'A' }), b = await tasks.start(f.registration.id, { goal: 'B' });
    const ia = await ProjectIndex.run(f.app, a.runId), ib = await ProjectIndex.run(f.app, b.runId), basis = await ProjectIndex.run(f.app, a.runId, 'basis'); open.push(ia, ib, basis);
    await tasks.saveDraft(a.runId, 'draft.md', '은밀한 A 작업 원고\n', null); await tasks.saveDraft(b.runId, 'draft.md', '독립된 B 작업 원고\n', null);
    const search = (index: ProjectIndex, text: string) => index.query<Search>('search', { text, includeFiles: true }, { scopeToken: index.scopeToken });
    expect((await search(ia, '은밀한 A')).data.hits).toHaveLength(1); expect((await search(ib, '은밀한 A')).data.hits).toHaveLength(0); expect((await search(basis, '은밀한 A')).data.hits).toHaveLength(0);
    await code(ib.query('tasks', {}, { scopeToken: ia.scopeToken }), 'CONTEXT_FORBIDDEN');
    await expect(tasks.saveDraft(a.runId, 'draft.md', '새 내용\n', hash('은밀한 A 작업 원고\n'), async phase => { if (phase === 'prepared') throw new Error('INTERRUPT'); })).rejects.toThrow('INTERRUPT');
    await code(search(ia, '은밀한 A'), 'RECOVERY_REQUIRED');
    await code(ia.query('tasks', {}, { scopeToken: ia.scopeToken, allowStale: true }), 'RECOVERY_REQUIRED');
    expect((await search(basis, '은밀한 A')).freshness).toBe('fresh');
    const { runGit } = await import('../../git-workspace/src/git.js');
    const remote = join(f.home, '다른 clone 원격.git'); await runGit(f.home, ['clone', '--bare', '--', f.root, remote]);
    const otherReg = await cloneProject(f.app, pathToFileURL(remote).href, true), other = await ProjectIndex.registered(f.app, otherReg.id); open.push(other);
    expect(other.scope.projectId).toBe(f.index.scope.projectId); expect(other.scopeKey).not.toBe(f.index.scopeKey);
    await code(other.query('tasks', {}, f.options), 'CONTEXT_FORBIDDEN');
    expect((await search(other, '은밀한 A')).data.hits).toHaveLength(0);
  }, 90_000);

  it('indexes state inputs and reverse dependencies without claiming an evaluator exists', async () => {
    const f = await registered('state-model');
    const states = await f.index.query<{ records: { recordType: string }[]; evaluatorAvailable: boolean }>('state', {}, f.options); expect(states.data.evaluatorAvailable).toBe(true); expect(states.data.records.filter(r => r.recordType === 'definition')).toHaveLength(3);
    const reverse = await f.index.query<{ results: { source: string }[] }>('reverse', { entityId: 'ent_actor', revisionId: 'rev_actor' }, f.options);
    expect(reverse.data.results.map(result => result.source)).toContain('ent_gate_rule/rev_gate_rule');
    expect((await f.index.query<Search>('search', { text: '국경 지역', mode: 'exact' }, f.options)).data.hits[0]!.entityId).toBe('ent_border');
    expect((await f.index.query<Search>('search', { text: '조건부 입장' }, f.options)).data.hits[0]!.entityId).toBe('ent_gate_rule');
  }, 60_000);

  it('binds state input digests to actor, scenario and source while leaving source untouched', async () => {
    const f = await registered('state-model'), args = { entityId: 'ent_gate_scenario', revisionId: 'rev_gate_scenario', actor: 'player' };
    const first = await f.index.query<{ inputDigest: string; scopeCacheKey: string; evaluatorAvailable: boolean }>('state-input', args, f.options);
    const again = await f.index.query<{ inputDigest: string }>('state-input', args, f.options), npc = await f.index.query<{ inputDigest: string }>('state-input', { ...args, actor: 'npc' }, f.options);
    expect(first.data.inputDigest).toBe(again.data.inputDigest); expect(first.data.inputDigest).not.toBe(npc.data.inputDigest); expect(first.data.evaluatorAvailable).toBe(true);
    expect(again.sourceFingerprint).toBe(first.sourceFingerprint);
    await code(f.index.query('state-input', { ...args, actor: 'missing' }, f.options), 'STATE_ACTOR_MISSING');
    await code(f.index.query('state-input', { ...args, overrides: { undeclared: true } }, f.options), 'STATE_INPUT_MISSING');
    await code(f.index.query('state', {}, { ...f.options, perspective: 'character' as any }), 'CONTEXT_FORBIDDEN');
    const { runGit } = await import('../../git-workspace/src/git.js'), remote = join(f.home, '입력 재현 원격.git'); await runGit(f.home, ['clone', '--bare', '--', f.root, remote]);
    const cloned = await cloneProject(f.app, pathToFileURL(remote).href, true), cloneIndex = await ProjectIndex.registered(f.app, cloned.id); open.push(cloneIndex);
    const restored = await cloneIndex.query<{ inputDigest: string; scopeCacheKey: string }>('state-input', args, { scopeToken: cloneIndex.scopeToken });
    expect(restored.data.inputDigest).toBe(first.data.inputDigest); expect(restored.data.scopeCacheKey).not.toBe(first.data.scopeCacheKey);
  }, 60_000);

  it('reads a pinned commit independently of current working files', async () => {
    const f = await registered(), { gitText } = await import('../../git-workspace/src/git.js'), commit = await gitText(f.root, ['rev-parse', 'HEAD']);
    const basis = await ProjectIndex.committed(f.app, f.registration.id, commit); open.push(basis);
    const initial = await basis.query('selected', { entityId: 'ent_overview' }, { scopeToken: basis.scopeToken });
    await child(f.root, 'rev_future', '미래 원고');
    expect((await basis.query('selected', { entityId: 'ent_overview' }, { scopeToken: basis.scopeToken })).snapshotToken).toBe(initial.snapshotToken);
    expect((await basis.query<Search>('search', { text: '미래 원고', includeHistory: true }, { scopeToken: basis.scopeToken })).data.hits).toHaveLength(0);
  }, 60_000);

  it('quarantines a corrupt cache and rebuilds canonical content from files', async () => {
    const f = await registered(), before = await f.index.query('selected', { entityId: 'ent_overview' }, f.options);
    await f.index.close(); await writeFile(f.index.databasePath, 'not a SQLite database');
    const recovered = await ProjectIndex.registered(f.app, f.registration.id); open.push(recovered);
    const after = await recovered.query('selected', { entityId: 'ent_overview' }, { scopeToken: recovered.scopeToken }); expect(after.data).toEqual(before.data); expect(after.freshness).toBe('fresh');
  }, 60_000);

  it('serializes writers from two app instances while allowing a labelled old read', async () => {
    const f = await registered(), first = await f.index.rebuild(f.index.scopeToken), other = await ProjectIndex.registered(f.app, f.registration.id); open.push(other);
    expect(other.scopeKey).toBe(f.index.scopeKey); expect(other.scopeToken).not.toBe(f.index.scopeToken);
    await child(f.root);
    const next = await f.index.rebuild(f.index.scopeToken, { onPhase: async phase => {
      if (phase !== 'prepared') return;
      const old = await other.query('selected', { entityId: 'ent_overview' }, { scopeToken: other.scopeToken, allowStale: true }); expect(old.generationId).toBe(first.generationId); expect(old.freshness).toBe('stale');
      await code(other.rebuild(other.scopeToken), 'WORKTREE_BUSY');
    } });
    const result = await other.query<Search>('search', { text: '독립된', includeHistory: true }, { scopeToken: other.scopeToken }); expect(result.generationId).toBe(next.generationId); expect(result.data.hits[0]!.revisionId).toBe('rev_other');
  }, 60_000);

  it('does not execute configured Git content filters while inspecting metadata or indexing', async () => {
    const f = await registered(), { runGit } = await import('../../git-workspace/src/git.js');
    const sentinel = join(f.home, 'filter-executed'), script = join(f.home, 'filter-spy.mjs');
    await writeFile(script, `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(sentinel)}, 'unexpected'); process.stdout.write('changed');`);
    const quote = (value: string) => '"' + value.replaceAll('\\', '/') + '"';
    await runGit(f.root, ['config', 'filter.spy.clean', quote(process.execPath) + ' ' + quote(script)]); await runGit(f.root, ['config', 'filter.spy.required', 'true']);
    await writeFile(join(f.root, '.gitattributes'), '*.md filter=spy\n');
    expect((await f.index.query('selected', { entityId: 'ent_overview' }, f.options)).freshness).toBe('fresh');
    await expect(access(sentinel)).rejects.toThrow();
  }, 60_000);
});
