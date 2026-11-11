import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { parse, stringify } from 'yaml';

export const testRoot = resolve('.tmp');
export async function fixtureCopy(name: string): Promise<string> {
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(join(testRoot, 'stage1 검증 '));
  const root = join(directory, '프로젝트 공간');
  await cp(resolve('fixtures', name), root, { recursive: true });
  return root;
}
export async function removeFixture(root: string): Promise<void> {
  const target = await realpath(dirname(root));
  const base = await realpath(testRoot);
  if (!target.startsWith(base + sep) || !basename(target).startsWith('stage1 검증 ')) throw new Error('Unexpected cleanup target');
  await rm(target, { recursive: true, maxRetries: 10, retryDelay: 100 });
}
export async function editYaml(path: string, update: (value: Record<string, any>) => void): Promise<void> {
  // This helper deliberately simulates an external editor; it bypasses product change guards.
  const value = parse(await readFile(path, 'utf8')) as Record<string, any>;
  update(value);
  await writeFile(path, stringify(value, { lineWidth: 0, aliasDuplicateObjects: false }));
}
