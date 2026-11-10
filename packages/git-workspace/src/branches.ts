import { mkdir, realpath } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileFailure } from '../../project-fs/src/files.js';
import type { SourceFile } from '../../domain/src/model.js';
import { readCommittedFiles } from '../../project-fs/src/git-baseline.js';
import { assertOwnedPath, commitMigration, materializeFiles } from './worktree.js';
import type { ScratchWorkspace } from './worktree.js';
import { gitText, runGit } from './git.js';

export function ownedBranch(branch: string): boolean {
  return /^workbench\/(?:task\/task_[a-z0-9_-]+\/run_[a-f0-9-]+|snapshot\/snap_[a-f0-9-]+|import\/op_[a-f0-9-]+|integration\/op_[a-f0-9-]+)$/.test(branch);
}
export async function createOwnedWorkspace(sourceRoot: string, managedRoot: string, path: string, branch: string, commit: string): Promise<ScratchWorkspace> {
  if (!ownedBranch(branch) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) throw new Error('Invalid app workspace identity');
  await assertOwnedPath(managedRoot, path);
  const files = await readCommittedFiles(sourceRoot, commit, false);
  await mkdir(dirname(path), { recursive: true });
  await runGit(sourceRoot, ['worktree', 'add', '--no-checkout', '-b', branch, path, commit]);
  await runGit(path, ['read-tree', commit]);
  await materializeFiles(path, files);
  return { sourceRoot: await realpath(sourceRoot), path, branch, baseCommit: commit };
}
export async function preserveWorkspace(workspace: ScratchWorkspace, expectedHead: string, changes: readonly { path: string; file: SourceFile | null }[], message: string): Promise<string> {
  if (!ownedBranch(workspace.branch) || await gitText(workspace.path, ['symbolic-ref', '--short', 'HEAD']) !== workspace.branch) throw fileFailure('RUN_SCOPE_CHANGED', 'Workspace branch does not match its app scope', 'project.yaml');
  return commitMigration({ ...workspace, baseCommit: expectedHead }, changes, message);
}
