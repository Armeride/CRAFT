import { afterEach, expect, it } from 'vitest';
import { metricsSnapshot, resetMetrics } from '../../domain/src/instrumentation.js';
import { ValidationFailure } from '../../domain/src/model.js';
import type { SourceFile } from '../../domain/src/model.js';
import { captureFiles, hash } from './files.js';
import { parseProject } from './project.js';
import { fixtureCopy, removeFixture } from './test-helpers.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(removeFixture)); });
const files = async (name: string) => { const root = await fixtureCopy(name); roots.push(root); return new Map(await captureFiles(root)); };
const reused = () => metricsSnapshot()['project.parse.reused']?.calls ?? 0;
const textFile = (path: string, text: string): SourceFile => ({ path, text, digest: hash(text), contentBase64: Buffer.from(text).toString('base64') });
const failure = (action: () => unknown) => {
  try { action(); }
  catch (error) {
    if (error instanceof ValidationFailure) { return error.diagnostics; }
    throw error;
  }
  throw new Error('Expected a validation failure');
};

it('reuses a snapshot for the same files and keeps its own copy of the files map', async () => {
  const input = await files('valid-minimal');
  resetMetrics();
  const first = parseProject(input);
  const again = parseProject(new Map(input));
  expect(again).toBe(first);
  expect(reused()).toBe(1);
  // A caller changing its map afterwards must not change the shared snapshot.
  input.set('README.md', textFile('README.md', '바뀐 안내\n'));
  expect(first.files.get('README.md')?.text).not.toBe('바뀐 안내\n');
  const changed = parseProject(input);
  expect(changed).not.toBe(first);
  expect(changed.fingerprint).not.toBe(first.fingerprint);
  expect(changed.files.get('README.md')?.text).toBe('바뀐 안내\n');
});

it('reports the same located diagnostics on every call for invalid input', async () => {
  const input = await files('valid-minimal');
  const meta = 'entities/ent_overview/revisions/rev_overview_a/meta.yaml';
  input.set(meta, textFile(meta, 'entity_id: ent_overview\nrevision_id: [unterminated\n'));
  const first = failure(() => parseProject(input));
  expect(first.length).toBeGreaterThan(0);
  expect(failure(() => parseProject(new Map(input)))).toEqual(first);
});

it('validates projects with custom extension schemas the same way across calls', async () => {
  const input = await files('state-model');
  const first = parseProject(input);
  expect(first.writable).toBe(true);
  const other = await files('valid-minimal');
  parseProject(other);
  // Same custom schema set again after a core-only project: reused validator, identical result.
  const copy = new Map(input), readme = copy.get('README.md');
  if (!readme?.text) throw new Error('Fixture README missing');
  copy.set('README.md', textFile('README.md', readme.text + '\n'));
  const second = parseProject(copy);
  expect(second).not.toBe(first);
  expect(second.diagnostics).toEqual(first.diagnostics);
  expect([...second.entities.keys()]).toEqual([...first.entities.keys()]);
});
