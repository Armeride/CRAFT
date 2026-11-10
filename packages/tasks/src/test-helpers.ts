import { cp, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { gitText, runGit } from '../../git-workspace/src/git.js';

export interface WorkspaceFixture { home: string; root: string; app: string }
export async function workspaceFixture(empty = false): Promise<WorkspaceFixture> {
  await mkdir(resolve('.tmp'), { recursive: true });
  const home = await mkdtemp(join(resolve('.tmp'), 'stage3 검증 '));
  const root = join(home, '소설 게임 원본');
  if (empty) await mkdir(root); else await cp(resolve('fixtures/valid-minimal'), root, { recursive: true });
  await runGit(root, ['init']);
  if (!empty) await fixtureCommit(root);
  return { home, root, app: join(home, '앱 관리 공간') };
}
export async function fixtureCommit(root: string): Promise<string> {
  await runGit(root, ['add', '.']);
  await runGit(root, ['-c', 'user.name=CRAFT fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'fixture basis']);
  return gitText(root, ['rev-parse', 'HEAD']);
}
export async function removeWorkspaceFixture(fixture: WorkspaceFixture): Promise<void> {
  const base = await realpath(resolve('.tmp')), target = await realpath(fixture.home);
  if (!target.startsWith(base + sep) || !basename(target).startsWith('stage3 검증 ')) throw new Error('Unexpected test cleanup target');
  const common = await gitText(fixture.root, ['rev-parse', '--absolute-git-dir']);
  if (!resolve(common).startsWith(target + sep)) throw new Error('External Git metadata');
  for (const match of (await gitText(fixture.root, ['worktree', 'list', '--porcelain'])).matchAll(/^worktree (.+)$/gm)) {
    if (!resolve(match[1]!).startsWith(target + sep)) throw new Error('External test worktree');
  }
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
