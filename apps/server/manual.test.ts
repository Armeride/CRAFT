import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createWebApp } from './app.js';
import { commitFixture, indexFixture, removeIndexFixture } from '../../packages/indexer/src/test-helpers.js';
import type { IndexFixture } from '../../packages/indexer/src/test-helpers.js';
import { registerLocal } from '../../packages/tasks/src/projects.js';
import { repositoryGuard } from '../../packages/git-workspace/src/worktree.js';
import type { Draft, Catalog } from './contracts.js';
import type { QueryEnvelope } from '../../packages/indexer/src/types.js';
import type { ManualInspection, ManualResult } from '../../packages/tasks/src/manual-contracts.js';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TaskService } from '../../packages/tasks/src/service.js';
const fixtures: IndexFixture[] = [], apps: Awaited<ReturnType<typeof createWebApp>>[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); for (const fixture of fixtures.splice(0)) await removeIndexFixture(fixture); });
async function setup() {
  const fixture = await indexFixture(); fixtures.push(fixture); const registration = await registerLocal(fixture.app, fixture.root), app = await createWebApp({ appData: fixture.app, port: 4173 }); apps.push(app);
  const session = await app.inject({ url: '/api/session', headers: { host: '127.0.0.1:4173' } }), headers = { host: '127.0.0.1:4173', cookie: session.cookies[0]!.name + '=' + session.cookies[0]!.value, 'x-craft-csrf': session.json<{ csrf: string }>().csrf };
  const send = (url: string, payload?: unknown, method: 'GET' | 'POST' | 'PUT' = payload === undefined ? 'GET' : 'POST', identity = randomUUID()) => app.inject({ method, url, headers: { ...headers, 'content-type': 'application/json', 'x-craft-request-id': identity }, ...(payload === undefined ? {} : { payload: JSON.stringify(payload)! }) });
  const create = async () => { const response = await send(`/api/projects/${registration.id}/tasks`, { goal: '웹 수동 작업', baselineId: 'baseline_main' }); expect(response.statusCode, response.body).toBe(200); return response.json<{ runId: string }>().runId; };
  return { ...fixture, appData: fixture.app, app, registration, send, create };
}
describe('manual HTTP boundary and recovery', () => {
  it('starts from HEAD by default and snapshots only explicitly selected local changes with a freshness token', async () => {
    const f = await setup(); await writeFile(join(f.root, 'README.md'), 'selected local bytes'); const before = await repositoryGuard(f.root, false), changes = await f.send(`/api/projects/${f.registration.id}/working-changes`); expect(changes.statusCode, changes.body).toBe(200); const value = changes.json<{ paths: string[]; token: string }>(); expect(value.paths).toContain('README.md');
    const original = await f.create(), tasks = new TaskService(f.appData); expect((await tasks.run(original)).run.omittedWorkingChanges).toBe(true);
    const body = { goal: 'Selected local basis', baselineId: 'baseline_main', includeWorkingPaths: ['README.md'], expectedWorkingFingerprint: value.token }, identity = randomUUID(), selected = await f.send(`/api/projects/${f.registration.id}/tasks`, body, 'POST', identity); expect(selected.statusCode, selected.body).toBe(200); expect(selected.json().selectedSnapshotRef).toMatch(/^workbench\/snapshot\//); expect((await f.send(`/api/projects/${f.registration.id}/tasks`, body, 'POST', identity)).json().runId).toBe(selected.json().runId); expect(await repositoryGuard(f.root, false)).toEqual(before);
    await writeFile(join(f.root, 'README.md'), 'newer local bytes'); expect((await f.send(`/api/projects/${f.registration.id}/tasks`, body)).json().code).toBe('BASE_CHANGED');
  }, 120000);
  it('binds manual commands and basis/working views, preserves request identity and rejects unknown fields', async () => {
    const f = await setup(), before = await repositoryGuard(f.root), runId = await f.create(), inspection = (await f.send(`/api/runs/${runId}/manual`)).json<ManualInspection>(), requestId = randomUUID();
    const body = { requestId, expectedSnapshot: inspection.snapshot, command: { type: 'revision', value: { title: '수동 HTTP 규칙', status: 'draft', scope: {}, references: [], extensions: {}, tags: [], body: '독립 작업 내용', baselineId: 'baseline_main', select: true } } };
    const invalid = await f.send(`/api/runs/${runId}/manual`, { ...body, root: f.root }); expect(invalid.json().code).toBe('REQUEST_INVALID');
    const response = await f.send(`/api/runs/${runId}/manual`, body); expect(response.statusCode, response.body).toBe(200); const created = response.json<ManualResult>();
    expect((await f.send(`/api/runs/${runId}/manual`, body)).json()).toEqual(created);
    const basis = (await f.send(`/api/runs/${runId}/query`, { view: 'basis', operation: 'catalog' })).json<QueryEnvelope<Catalog>>(), working = (await f.send(`/api/runs/${runId}/query`, { view: 'working', operation: 'catalog' })).json<QueryEnvelope<Catalog>>();
    expect(basis.data.entities.some(entity => entity.entityId === created.entityId)).toBe(false); expect(working.data.entities.some(entity => entity.entityId === created.entityId)).toBe(true);
    expect((await f.send(`/api/runs/${runId}/query`, { view: 'outside', operation: 'catalog' })).json().code).toBe('REQUEST_INVALID'); expect(await repositoryGuard(f.root)).toEqual(before);
  }, 120000);
  it('preserves both body versions, forks an independent run once and archives overwritten property drafts', async () => {
    const f = await setup(), runId = await f.create(), draft = (await f.send(`/api/runs/${runId}/draft`)).json<Draft>();
    const remote = (await f.send(`/api/runs/${runId}/draft`, { text: '다른 창의 원고', expectedDigest: draft.digest }, 'PUT')).json<Draft>();
    const requestId = randomUUID(), body = { resource: 'body', mode: 'fork', localText: '내 미저장 원고', expectedDigest: remote.digest }, forked = await f.send(`/api/runs/${runId}/conflict-resolution`, body, 'POST', requestId); expect(forked.statusCode, forked.body).toBe(200);
    const result = forked.json<{ runId: string; backup: string }>(); expect(result.runId).not.toBe(runId); expect((await f.send(`/api/runs/${runId}/conflict-resolution`, body, 'POST', requestId)).json()).toEqual(result);
    expect((await f.send(`/api/runs/${runId}/draft`)).json<Draft>().text).toBe('다른 창의 원고'); expect((await f.send(`/api/runs/${result.runId}/draft`)).json<Draft>().text).toBe('내 미저장 원고'); expect((await f.send(`/api/runs/${runId}/artifact?path=${encodeURIComponent(result.backup)}`)).json<{ text: string }>().text).toBe('내 미저장 원고');
    const first = await f.send(`/api/runs/${runId}/editor`, { text: '{"version":1,"form":{"title":"다른 속성"}}', expectedDigest: null }, 'PUT'); expect(first.statusCode, first.body).toBe(200);
    const resolved = await f.send(`/api/runs/${runId}/conflict-resolution`, { resource: 'editor', mode: 'overwrite', localText: '{"version":1,"form":{"title":"내 속성"}}', expectedDigest: first.json<{ digest: string }>().digest }); expect(resolved.statusCode, resolved.body).toBe(200);
    const artifact = await f.send(`/api/runs/${runId}/artifact?path=${encodeURIComponent(resolved.json<{ backup: string }>().backup)}`); expect(artifact.json<{ text: string }>().text).toContain('다른 속성');
    expect((await f.send(`/api/runs/${runId}/artifact?path=project.yaml`)).statusCode).toBe(403);
  }, 120000);
  it('discovers and imports uppercase committed documents, and exposes the production migration plan', async () => {
    const f = await setup(), paths = ['설정 초안.MD', '기획 노트.TXT'], original = Buffer.from('\ufeff한국어 원문\r\n');
    await Promise.all(paths.map(path => writeFile(join(f.root, path), original)));
    await commitFixture(f.root);
    const before = await repositoryGuard(f.root), inspected = await f.send('/api/library/inspect', { root: f.root });
    expect(inspected.statusCode, inspected.body).toBe(200);
    const documents = inspected.json<{ documents: string[] }>().documents;
    for (const path of paths) expect(documents).toContain(path);
    const missing = '이동한 원문.MD';
    const invalid = await f.send('/api/library/import', { registrationId: f.registration.id, paths: [missing], name: '선택 문서 가져오기' });
    expect(invalid.statusCode).toBe(400);
    const error = invalid.json<{ code: string; details: { diagnostics: { path: string }[] } }>();
    expect(error.code).toBe('IMPORT_SOURCE_INVALID');
    expect(error.details.diagnostics[0]?.path).toBe(missing);
    const imported = await f.send('/api/library/import', { registrationId: f.registration.id, paths, name: '선택 문서 가져오기' });
    expect(imported.statusCode, imported.body).toBe(200);
    const value = imported.json<{ operation: { path: string }; choice: { id: string }; baselineId: string }>();
    expect(value.choice.id).not.toBe(f.registration.id);
    expect(value.baselineId).toMatch(/^baseline_/);
    const preserved = await Promise.all(paths.map(path => readFile(join(value.operation.path, path))));
    expect(preserved).toEqual([original, original]);
    const catalog = await f.send(`/api/projects/${value.choice.id}/query`, { operation: 'catalog', baselineId: value.baselineId }); expect(catalog.statusCode, catalog.body).toBe(200); expect(catalog.json<QueryEnvelope<Catalog>>().data.baselines.some(baseline => baseline.id === value.baselineId)).toBe(true);
    const migration = await f.send(`/api/projects/${f.registration.id}/migration`); expect(migration.statusCode, migration.body).toBe(200); const current = migration.json<{ current: Record<string, number>; plan: { steps: unknown[] } }>(); expect(current.plan.steps).toEqual([]);
    const noop = await f.send(`/api/projects/${f.registration.id}/migration`, { target: current.current, run: true }); expect(noop.statusCode, noop.body).toBe(200); expect(noop.json().state).toBe('noop');
    expect((await f.send(`/api/projects/${f.registration.id}/migration`, { target: { core: 2 }, run: false })).json().code).toBe('SCHEMA_UNSUPPORTED'); expect(await repositoryGuard(f.root)).toEqual(before);
    expect((await f.send('/api/library/clone', { url: 'file:///D:/untrusted' })).statusCode).toBe(400);
  }, 120000);
});
