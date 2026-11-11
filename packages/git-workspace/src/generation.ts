import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { hash, newId } from '../../project-fs/src/files.js';
import { atomicText } from '../../workspace-runtime/src/state.js';
import { gitLocations, type Lease } from './locks.js';

async function location(root: string) {
  const locations = await gitLocations(root), identity = relative(locations.commonDir, locations.gitDir) || '.';
  return { path: join(locations.commonDir, 'craft', 'generations', hash(identity)), commonDir: locations.commonDir, scope: `worktree:${locations.commonDir}:${identity}` };
}
export async function sourceEpoch(root: string): Promise<string | null> {
  const { path } = await location(root);
  return readEpochPath(path);
}
export async function sourceEpochAt(commonDir: string, gitDir: string): Promise<string | null> {
  return readEpochPath(join(commonDir, 'craft', 'generations', hash(relative(commonDir, gitDir) || '.')));
}
async function readEpochPath(path: string): Promise<string | null> {
  try { const value = (await readFile(path, 'utf8')).trim(); if (!/^source_[a-f0-9-]+$/.test(value)) throw new Error('SOURCE_EPOCH_INVALID'); return value; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
export async function markSourceChanged(root: string, lease: Lease): Promise<void> {
  const value = await location(root); lease.assert(value.scope);
  await atomicText(value.commonDir, value.path, newId('source') + '\n');
}
