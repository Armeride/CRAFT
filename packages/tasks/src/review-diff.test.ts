import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { gitText } from '../../git-workspace/src/git.js';
import { commitFixture, indexFixture, removeIndexFixture } from '../../indexer/src/test-helpers.js';
import type { IndexFixture } from '../../indexer/src/test-helpers.js';
import { reviewDiff, SUMMARY_HEADER } from './review-diff.js';

const fixtures: IndexFixture[] = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map(removeIndexFixture)); });

const manifest = (entities: number) => ['snapshot_token: git:abc', 'inputs:', ...Array.from({ length: entities }, (_, n) => `  - semantic_digest: ${String(n).padStart(64, '0')}`)].join('\n') + '\n';

it('lists checkpoint input manifests by Git object and keeps every other change as a full diff', async () => {
  const fixture = await indexFixture(); fixtures.push(fixture);
  const root = fixture.root, target = await gitText(root, ['rev-parse', 'HEAD']);
  await mkdir(join(root, 'tasks/task_a/checkpoints'), { recursive: true });
  await writeFile(join(root, 'tasks/task_a/checkpoints/cp_1-inputs.yaml'), manifest(2000));
  await writeFile(join(root, 'tasks/task_a/checkpoints/cp_1.yaml'), 'summary: 사람이 읽는 체크포인트\n');
  await writeFile(join(root, 'README.md'), '검토할 변경\n');
  await commitFixture(root);
  const candidate = await gitText(root, ['rev-parse', 'HEAD']);
  const object = await gitText(root, ['rev-parse', `${candidate}:tasks/task_a/checkpoints/cp_1-inputs.yaml`]);

  const summarized = await reviewDiff(root, target, candidate, 'task-record-summary');
  expect(summarized).toContain('검토할 변경');
  expect(summarized).toContain('사람이 읽는 체크포인트');
  expect(summarized).not.toContain('semantic_digest');
  expect(summarized).toContain(`${SUMMARY_HEADER}\nA 100644 ${object} ${String(Buffer.byteLength(manifest(2000)))} tasks/task_a/checkpoints/cp_1-inputs.yaml\n`);
  expect(Buffer.byteLength(summarized)).toBeLessThan(4096);
  expect(await reviewDiff(root, target, candidate, 'task-record-summary')).toBe(summarized);

  // Records prepared before this format must recompute the identical full diff on apply.
  const full = await reviewDiff(root, target, candidate, 'binary-summary');
  expect(full).toContain('semantic_digest');
  expect(full).not.toContain(SUMMARY_HEADER);
  expect(full).toBe(await gitText(root, ['diff', '--no-ext-diff', '--no-textconv', '--full-index', target, candidate, '--']) + '\n');

  await rm(join(root, 'tasks/task_a/checkpoints/cp_1-inputs.yaml'));
  await commitFixture(root);
  const removed = await reviewDiff(root, candidate, await gitText(root, ['rev-parse', 'HEAD']), 'task-record-summary');
  expect(removed).toBe(`${SUMMARY_HEADER}\nD 100644 ${object} ${String(Buffer.byteLength(manifest(2000)))} tasks/task_a/checkpoints/cp_1-inputs.yaml\n`);
}, 60_000);

it('adds no summary when no task record is summarized', async () => {
  const fixture = await indexFixture(); fixtures.push(fixture);
  const root = fixture.root, target = await gitText(root, ['rev-parse', 'HEAD']);
  await writeFile(join(root, 'README.md'), '변경\n');
  await commitFixture(root);
  const candidate = await gitText(root, ['rev-parse', 'HEAD']);
  expect(await reviewDiff(root, target, candidate, 'task-record-summary')).toBe(await reviewDiff(root, target, candidate, 'binary-summary'));
}, 60_000);
