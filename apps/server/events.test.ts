import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises';
import { join, resolve, sep, basename } from 'node:path';
import { WorkspaceEvents } from './events.js';
import type { WorkspaceEvent } from './events.js';
const homes: string[] = [];
afterEach(async () => { const base = await realpath(resolve('.tmp')); for (const path of homes.splice(0)) { const target = await realpath(path); if (!target.startsWith(base + sep) || !basename(target).startsWith('SSE acceptance ')) throw Error('Unexpected event fixture'); await rm(target, { recursive: true, maxRetries: 10 }); } });
describe('durable project-scoped SSE cursor', () => {
  it('allocates unique event sequences across two publishers sharing one journal', async () => {
    await mkdir(resolve('.tmp'), { recursive: true }); const root = await mkdtemp(join(resolve('.tmp'), 'SSE acceptance ')); homes.push(root); const first = new WorkspaceEvents(root), second = new WorkspaceEvents(root); await Promise.all([first.init(), second.init()]);
    await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? first : second).publish('reg_a', 'task.changed')));
    const replay: WorkspaceEvent[] = [], stop = await second.subscribe('reg_a', 1, event => replay.push(event)); expect(replay.map(event => event.sequence)).toEqual(Array.from({ length: 11 }, (_, index) => index + 2)); stop(); await Promise.all([first.close(), second.close()]);
  });
  it('preserves increasing sequence across restart, filters projects and resynchronizes expired cursors', async () => {
    await mkdir(resolve('.tmp'), { recursive: true }); const root = await mkdtemp(join(resolve('.tmp'), 'SSE acceptance ')); homes.push(root); const first = new WorkspaceEvents(root); await first.init();
    await first.publish('reg_a', 'project.changed'); await first.publish('reg_b', 'task.changed'); const received: WorkspaceEvent[] = [], off = await first.subscribe('reg_a', 1, event => received.push(event)); await first.publish('reg_a', 'task.changed', 'run_a'); expect(received).toMatchObject([{ sequence: 3, projectId: 'reg_a', runId: 'run_a' }]); off(); await first.close();
    const restored = new WorkspaceEvents(root); await restored.init(); const after: WorkspaceEvent[] = [], stop = await restored.subscribe('reg_a', 2, event => after.push(event)); expect(after.map(event => event.sequence)).toEqual([3]); await restored.publish('reg_a', 'project.changed'); expect(after.at(-1)?.sequence).toBe(4); stop();
    for (let n = 0; n < 202; n++) await restored.publish('reg_b', 'task.changed'); const stale: WorkspaceEvent[] = [], finish = await restored.subscribe('reg_a', 1, event => stale.push(event)); expect(stale).toMatchObject([{ sequence: 206, projectId: 'reg_a', type: 'sync.required' }]); finish(); await restored.close();
  }, 30000);
});
