import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:net';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createWebApp } from './app.js';
import { indexFixture, removeIndexFixture } from '../../packages/indexer/src/test-helpers.js';
import type { IndexFixture } from '../../packages/indexer/src/test-helpers.js';
import { registerLocal } from '../../packages/tasks/src/projects.js';
const fixtures: IndexFixture[] = [], apps: Awaited<ReturnType<typeof createWebApp>>[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); for (const fixture of fixtures.splice(0)) await removeIndexFixture(fixture); });
describe('authenticated live workspace events', () => {
  it('streams real file-change hints only for the authorized registration and closes cleanly', async () => {
    const first = await indexFixture(), second = await indexFixture(); fixtures.push(first, second); const a = await registerLocal(first.app, first.root), b = await registerLocal(first.app, second.root);
    const probe = createServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = (probe.address() as { port: number }).port; await new Promise<void>(resolve => probe.close(() => resolve()));
    const app = await createWebApp({ appData: first.app, port }); apps.push(app); await app.listen({ port, host: '127.0.0.1' });
    const root = `http://127.0.0.1:${port}`, session = await fetch(root + '/api/session'), csrf = (await session.json() as { csrf: string }).csrf, cookie = session.headers.get('set-cookie')!.split(';')[0]!, headers = { Cookie: cookie, 'X-Craft-CSRF': csrf };
    expect((await fetch(root + '/api/events?projectId=' + a.id)).status).toBe(401); expect((await fetch(root + '/api/events?projectId=reg_00000000-0000-4000-8000-000000000000', { headers })).status).toBe(403);
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 10000); let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch(root + '/api/events?projectId=' + a.id + '&cursor=0', { headers, signal: abort.signal }); expect(response.headers.get('content-type')).toContain('text/event-stream'); reader = response.body!.getReader(); const decoder = new TextDecoder(); let buffer = '';
      async function event() { while (true) { const boundary = buffer.indexOf('\n\n'); if (boundary >= 0) { const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2); const data = frame.split('\n').find(line => line.startsWith('data: ')); if (data) return JSON.parse(data.slice(6)) as { projectId: string; type: string; sequence: number }; continue; } const value = await reader!.read(); if (value.done) throw Error('Stream closed before the expected event'); buffer += decoder.decode(value.value, { stream: true }); } }
      const initial = await event(); expect(initial.type).toBe('sync.required'); await writeFile(join(second.root, 'README.md'), '다른 프로젝트 변경'); await writeFile(join(first.root, 'README.md'), '현재 프로젝트 변경');
      const changed = await event(); expect(changed).toMatchObject({ projectId: a.id, type: 'project.changed' }); expect(changed.projectId).not.toBe(b.id); expect(changed.sequence).toBeGreaterThan(initial.sequence);
    } finally { clearTimeout(timer); abort.abort(); await reader?.cancel().catch(() => {}); }
  }, 30000);
});
