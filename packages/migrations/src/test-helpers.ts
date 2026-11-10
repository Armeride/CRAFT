import { cp, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { runGit } from '../../git-workspace/src/git.js';
import { repositoryGuard } from '../../git-workspace/src/worktree.js';

export interface FixtureRepository { home: string; root: string; managed: string }
export async function fixtureRepository(name = 'v1-input'): Promise<FixtureRepository> {
  const temp = resolve('.tmp');
  await mkdir(temp, { recursive: true });
  const home = await mkdtemp(join(temp, 'stage2 검증 '));
  const root = join(home, '프로젝트 원본');
  await cp(resolve('fixtures/migrations', name), root, { recursive: true });
  await runGit(root, ['init']);
  await runGit(root, ['add', '.']);
  await runGit(root, ['-c', 'user.name=CRAFT fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'fixture basis']);
  return { home, root, managed: join(home, '관리 공간') };
}
export async function removeTestRepository(fixture: FixtureRepository): Promise<void> {
  const base = await realpath(resolve('.tmp'));
  const target = await realpath(fixture.home);
  if (!target.startsWith(base + sep) || !basename(target).startsWith('stage2 검증 ')) throw new Error('Unexpected test cleanup target');
  const commonDir = (await repositoryGuard(fixture.root, false)).commonDir;
  if (!commonDir.startsWith(target + sep)) throw new Error('Test Git metadata is outside its owned directory');
  // This removes an entire disposable repository, not a user run. Verify every linked tree
  // belongs to the same test directory, then let Node retry Windows transient handles.
  // Production removePreservedMigration still requires a clean, completed result.
  const { stdout } = await runGit(fixture.root, ['worktree', 'list', '--porcelain']);
  for (const match of stdout.toString('utf8').matchAll(/^worktree (.+)$/gm)) {
    const path = await realpath(match[1]!);
    if (!path.startsWith(target + sep)) throw new Error('Refusing to remove a non-test worktree');
  }
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
export async function commitFixtureEdit(root: string): Promise<void> {
  await runGit(root, ['add', '.']);
  await runGit(root, ['-c', 'user.name=CRAFT fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'fixture setup edit']);
  await repositoryGuard(root);
}
