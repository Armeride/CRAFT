import { readFile, rename, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { metricsSnapshot, resetMetrics } from '../../domain/src/instrumentation.js';
import { ValidationFailure } from '../../domain/src/model.js';
import { captureFiles } from './files.js';
import { fixtureCopy, removeFixture } from './test-helpers.js';

const roots: string[] = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(roots.splice(0).map(removeFixture)); });
const project = async () => { const root = await fixtureCopy('valid-minimal'); roots.push(root); return root; };
const counts = () => { const metrics = metricsSnapshot(); return { hit: metrics['fs.sourceCache.hit']?.calls ?? 0, miss: metrics['fs.sourceCache.miss']?.calls ?? 0 }; };
/** Pretends the fixture files were written long ago, outside the racy-clean window. */
const later = (seconds: number) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + seconds * 1000); };

it('reuses unchanged files and reads every changed one again', async () => {
  const root = await project(), readme = join(root, 'README.md');
  // A whole-second mtime can be restored exactly; Date-based utimes would truncate sub-millisecond parts.
  const mtime = Math.floor(Date.now() / 1000) - 100;
  await utimes(readme, mtime, mtime);
  later(10);
  const first = await captureFiles(root);
  resetMetrics();
  const second = await captureFiles(root);
  expect(counts()).toEqual({ hit: first.size, miss: 0 });
  expect([...second.values()]).toEqual([...first.values()]);

  // Same size, original mtime restored: only ctime shows the change, and it is enough.
  const original = await readFile(readme), times = await stat(readme, { bigint: true });
  await writeFile(readme, Buffer.from(original.toString('utf8').replace(/./u, character => character === 'X' ? 'Y' : 'X')));
  await utimes(readme, mtime, mtime);
  const restored = await stat(readme, { bigint: true });
  expect([restored.size, restored.mtimeNs]).toEqual([times.size, times.mtimeNs]);
  expect(restored.ctimeNs).not.toBe(times.ctimeNs);
  later(20);
  resetMetrics();
  const changed = await captureFiles(root);
  expect(counts()).toEqual({ hit: first.size - 1, miss: 1 });
  expect(changed.get('README.md')?.digest).not.toBe(first.get('README.md')?.digest);
  expect(changed.get('README.md')?.text).toBe((await readFile(readme, 'utf8')));
});

it('does not cache files changed within the racy-clean window', async () => {
  const root = await project();
  await captureFiles(root);
  resetMetrics();
  const again = await captureFiles(root);
  expect(counts()).toEqual({ hit: 0, miss: again.size });
});

it('rejects a cached file that was replaced by a symlink', async () => {
  const root = await project(), readme = join(root, 'README.md');
  later(10);
  await captureFiles(root);
  await rename(readme, join(root, 'README.real'));
  await symlink(join(root, 'README.real'), readme);
  const failure = await captureFiles(root).then(() => undefined, (error: unknown) => error);
  expect(failure).toBeInstanceOf(ValidationFailure);
  expect((failure as ValidationFailure).diagnostics.map(issue => issue.code)).toContain('PATH_SYMLINK');
});
