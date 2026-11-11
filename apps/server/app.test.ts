import { afterEach, describe, expect, it } from 'vitest';
import { createWebApp } from './app.js';
import { indexFixture, removeIndexFixture } from '../../packages/indexer/src/test-helpers.js';
import type { IndexFixture } from '../../packages/indexer/src/test-helpers.js';
import { registerLocal } from '../../packages/tasks/src/projects.js';
import { repositoryGuard } from '../../packages/git-workspace/src/worktree.js';
import type { Draft, EntityDetail, Catalog } from './contracts.js';
import type { QueryEnvelope } from '../../packages/indexer/src/types.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TaskService } from '../../packages/tasks/src/service.js';
import { randomUUID } from 'node:crypto';
const fixtures: IndexFixture[] = [], apps: Awaited<ReturnType<typeof createWebApp>>[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); for (const f of fixtures.splice(0)) await removeIndexFixture(f); });
async function setup() {
  const f = await indexFixture('state-model'); fixtures.push(f); const registration = await registerLocal(f.app, f.root);
  const app = await createWebApp({ appData: f.app, port: 4173, examples: [registration.id] }); apps.push(app);
  const headers: Record<string, string> = { host: '127.0.0.1:4173' }, response = await app.inject({ url: '/api/session', headers });
  headers['cookie'] = response.cookies[0]!.name + '=' + response.cookies[0]!.value; headers['x-craft-csrf'] = response.json<{ csrf: string }>().csrf;
  const query = (operation: string, args: Record<string, unknown> = {}) => app.inject({ method: 'POST', url: `/api/projects/${registration.id}/query`, headers, payload: { operation, args } });
  return { ...f, appData: f.app, app, registration, headers, query };
}
describe('local UI service boundary', () => {
  it('binds working requests to exact elements, preserves them and rejects conflicts or duplicate identity reuse', async () => {
    const f = await setup(), before = await repositoryGuard(f.root);
    async function create(entityId: string, revisionId: string) { const source = (await f.query('exact', { entityId, revisionId })).json<QueryEnvelope<EntityDetail>>(); const response = await f.app.inject({ method: 'POST', url: `/api/projects/${f.registration.id}/drafts`, headers: f.headers, payload: { entityId, revisionId, expectedSnapshot: source.snapshotToken, baselineId: 'baseline_main', goal: '요소별 작업' } }); expect(response.statusCode).toBe(200); return response.json<Draft>(); }
    const a = await create('ent_border', 'rev_border'), b = await create('ent_gate', 'rev_gate');
    expect(a.source?.entityId).toBe('ent_border'); expect(b.source?.entityId).toBe('ent_gate');
    const requestId = randomUUID(), payload = { requestId, text: '국경의 영향 검토 <원문>', expectedDigest: null };
    const first = await f.app.inject({ method: 'POST', url: `/api/runs/${a.runId}/requests`, headers: f.headers, payload }); expect(first.statusCode).toBe(200); expect(first.json<Draft>().requests).toHaveLength(1);
    const repeated = await f.app.inject({ method: 'POST', url: `/api/runs/${a.runId}/requests`, headers: f.headers, payload }); expect(repeated.json<Draft>().requests).toEqual(first.json<Draft>().requests);
    const conflict = await f.app.inject({ method: 'POST', url: `/api/runs/${a.runId}/requests`, headers: f.headers, payload: { ...payload, requestId: randomUUID() } }); expect(conflict.statusCode).toBe(409);
    const reused = await f.app.inject({ method: 'POST', url: `/api/runs/${a.runId}/requests`, headers: f.headers, payload: { ...payload, text: '다른 내용' } }); expect(reused.json().code).toBe('REQUEST_ID_REUSED');
    expect((await f.app.inject({ url: `/api/runs/${b.runId}/draft`, headers: f.headers })).json<Draft>().requests).toEqual([]);
    const listed = await f.app.inject({ url: `/api/projects/${f.registration.id}/drafts`, headers: f.headers }); expect(listed.json<{ drafts: Draft[] }>().drafts.map(value => value.source?.entityId).sort()).toEqual(['ent_border', 'ent_gate']);
    expect(await repositoryGuard(f.root)).toEqual(before);
  }, 60_000);
  it('preserves earlier drafts without assigning guessed element context and rejects malformed context', async () => {
    const f = await setup(), service = new TaskService(f.appData), run = await service.start(f.registration.id, { goal: '기존 UI 초안' }); await service.saveDraft(run.runId, 'ui-draft.md', '보존할 기존 원문', null);
    const value = (await f.app.inject({ url: `/api/runs/${run.runId}/draft`, headers: f.headers })).json<Draft>(); expect(value.source).toBeNull(); expect(value.text).toBe('보존할 기존 원문'); expect(value.requests).toEqual([]);
    await service.saveDraft(run.runId, 'ui-context.json', '{"version":900,"source":{}}', null);
    expect((await f.app.inject({ url: `/api/runs/${run.runId}/draft`, headers: f.headers })).json().code).toBe('WORKING_CONTEXT_INVALID');
    expect((await service.project(run.runId)).files.get(`tasks/${run.taskId}/working/ui-draft.md`)?.text).toBe('보존할 기존 원문');
  }, 60_000);
  it('rejects forged hosts, cross-origin requests and absent or malformed sessions', async () => {
    const f = await setup(), url = `/api/projects/${f.registration.id}/query`, payload = { operation: 'catalog' };
    expect((await f.app.inject({ method: 'POST', url, headers: { host: '127.0.0.1:4173' }, payload })).statusCode).toBe(401);
    for (const overrides of [{ host: 'evil.example:4173' }, { origin: 'https://evil.example' }, { 'sec-fetch-site': 'cross-site' }]) expect((await f.app.inject({ method: 'POST', url, headers: { ...f.headers, ...overrides }, payload })).statusCode).toBe(403);
    expect((await f.app.inject({ method: 'POST', url, headers: { ...f.headers, 'x-craft-csrf': 'é'.repeat(64) }, payload })).statusCode).toBe(401);
    const response = await f.query('catalog'); expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'"); expect(response.headers['cache-control']).toBe('no-store');
  });
  it('reads one bound catalog and exact source while rejecting unbound projects and unexpected input', async () => {
    const f = await setup(), before = await repositoryGuard(f.root);
    const catalog = (await f.query('catalog')).json<QueryEnvelope<Catalog>>(); expect(catalog.data.entities).toHaveLength(11); expect(catalog.data.project.project_id).toBe('prj_state_model');
    const exact = (await f.query('exact', { entityId: 'ent_border', revisionId: 'rev_border' })).json<QueryEnvelope<EntityDetail>>(); expect(exact.data.meta.title).toBe('국경 지역'); expect(exact.data.references.map(ref => ref.target.entity_id)).toEqual(['ent_faction_a', 'ent_faction_b']); expect(exact.snapshotToken).toBe(catalog.snapshotToken);
    expect((await f.app.inject({ method: 'POST', url: '/api/projects/reg_00000000-0000-4000-8000-000000000000/query', headers: f.headers, payload: { operation: 'catalog' } })).statusCode).toBe(403);
    expect((await f.app.inject({ method: 'POST', url: `/api/projects/${f.registration.id}/query`, headers: f.headers, payload: { operation: 'catalog', perspective: 'reader' } })).json().code).toBe('REQUEST_INVALID');
    expect(await repositoryGuard(f.root)).toEqual(before);
  });
  it('saves and restores a separate working draft and refuses an outdated content digest', async () => {
    const f = await setup(), before = await repositoryGuard(f.root);
    const source = (await f.query('exact', { entityId: 'ent_border', revisionId: 'rev_border' })).json<QueryEnvelope<EntityDetail>>();
    const created = await f.app.inject({ method: 'POST', url: `/api/projects/${f.registration.id}/drafts`, headers: f.headers, payload: { entityId: 'ent_border', revisionId: 'rev_border', expectedSnapshot: source.snapshotToken, baselineId: 'baseline_main', goal: 'UI에서 새 지역 초안을 검토한다.' } });
    expect(created.statusCode).toBe(200); const draft = created.json<Draft>(); expect(draft.text).toBe(source.data.body);
    const text = 'UI에서 보존한 초안\n<script>사용자 원문</script>\n';
    const saved = await f.app.inject({ method: 'PUT', url: `/api/runs/${draft.runId}/draft`, headers: f.headers, payload: { text, expectedDigest: draft.digest } }); expect(saved.statusCode).toBe(200);
    const restored = await f.app.inject({ url: `/api/runs/${draft.runId}/draft`, headers: f.headers }); expect(restored.json<Draft>().text).toBe(text);
    const conflict = await f.app.inject({ method: 'PUT', url: `/api/runs/${draft.runId}/draft`, headers: f.headers, payload: { text: '덮어쓰면 안 됨', expectedDigest: draft.digest } }); expect(conflict.statusCode).toBe(409); expect(conflict.json().code).toBe('FILE_CHANGED_EXTERNALLY');
    expect((await f.app.inject({ url: `/api/runs/${draft.runId}/draft`, headers: f.headers })).json<Draft>().text).toBe(text);
    expect(await repositoryGuard(f.root)).toEqual(before);
    const run = (await new TaskService(f.appData).run(draft.runId)).run; expect(run.initialCommit).toBeTruthy();
  }, 60_000);
  it('refuses stale source before creating a worktree and keeps invalid registrations from breaking startup', async () => {
    const f = await setup(), source = (await f.query('exact', { entityId: 'ent_border', revisionId: 'rev_border' })).json<QueryEnvelope<EntityDetail>>();
    await writeFile(join(f.root, 'README.md'), '외부 변경\n');
    const response = await f.app.inject({ method: 'POST', url: `/api/projects/${f.registration.id}/drafts`, headers: f.headers, payload: { entityId: 'ent_border', revisionId: 'rev_border', expectedSnapshot: source.snapshotToken, baselineId: 'baseline_main', goal: '보류해야 한다' } });
    expect(response.statusCode).toBe(409); expect(response.json().code).toBe('BASE_CHANGED');
    const invalid = await indexFixture(); fixtures.push(invalid); await writeFile(join(invalid.root, 'project.yaml'), 'broken: true\n');
    const opened = await f.app.inject({ method: 'POST', url: '/api/projects/open', headers: f.headers, payload: { root: invalid.root } }); expect(opened.statusCode).not.toBe(200);
    await f.app.close(); const restarted = await createWebApp({ appData: f.appData, port: 4173 }); apps.push(restarted); expect((await restarted.inject({ url: '/api/session', headers: { host: '127.0.0.1:4173' } })).statusCode).toBe(200);
  }, 60_000);
});
