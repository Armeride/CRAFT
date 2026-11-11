import { cp, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { runGit } from '../../git-workspace/src/git.js';
export interface IndexFixture { home: string; root: string; app: string }
export async function indexFixture(name = 'valid-minimal'): Promise<IndexFixture> {
  await mkdir(resolve('.tmp'), { recursive: true }); const home = await mkdtemp(join(resolve('.tmp'), 'stage4 검증 '));
  const root = join(home, '기획 원본'), app = join(home, '앱 데이터');
  await cp(resolve('fixtures', name), root, { recursive: true }); await runGit(root, ['init']); await commitFixture(root);
  return { home, root, app };
}
export async function commitFixture(root: string) { await runGit(root, ['add', '.']); await runGit(root, ['-c', 'user.name=CRAFT fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'stage 4 fixture basis']); }
export async function removeIndexFixture(f: IndexFixture) {
  const base = await realpath(resolve('.tmp')), target = await realpath(f.home);
  if (!target.startsWith(base + sep) || !basename(target).startsWith('stage4 검증 ')) throw new Error('Unexpected cleanup target');
  for (const match of (await runGit(f.root, ['worktree', 'list', '--porcelain'])).stdout.toString().matchAll(/^worktree (.+)$/gm)) if (!resolve(match[1]!).startsWith(target + sep)) throw new Error('External fixture worktree');
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
