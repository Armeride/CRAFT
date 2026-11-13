import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises';
import { join, resolve, basename, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HttpCommands } from './commands.js';
const roots: string[] = [];
afterEach(async () => { const base = await realpath(resolve('.tmp')); for (const path of roots.splice(0)) { const target = await realpath(path); if (!target.startsWith(base + sep) || !basename(target).startsWith('HTTP command acceptance ')) throw Error('Unexpected command fixture'); await rm(target, { recursive: true, maxRetries: 10 }); } });
describe('durable HTTP command identities', () => {
  it('replays a completed result across restart and holds uncertain effects instead of repeating them', async () => {
    await mkdir(resolve('.tmp'), { recursive: true }); const root = await mkdtemp(join(resolve('.tmp'), 'HTTP command acceptance ')); roots.push(root); const first = new HttpCommands(root), key = randomUUID(); let executions = 0;
    expect(await first.execute(key, 'task:reg_a', { goal: '작업' }, async () => ({ run: ++executions }))).toEqual({ run: 1 });
    expect(await new HttpCommands(root).execute(key, 'task:reg_a', { goal: '작업' }, async () => ({ run: ++executions }))).toEqual({ run: 1 }); expect(executions).toBe(1);
    await expect(first.execute(key, 'task:reg_b', { goal: '작업' }, async () => ({}))).rejects.toThrow(/REQUEST_ID_REUSED/);
    const unknown = randomUUID(); await expect(first.execute(unknown, 'clone', {}, async () => { executions++; throw Error('response interrupted'); })).rejects.toThrow(/response interrupted/);
    await expect(new HttpCommands(root).execute(unknown, 'clone', {}, async () => { executions++; })).rejects.toThrow(/COMMAND_OUTCOME_UNKNOWN/); expect(executions).toBe(2);
  });
});
