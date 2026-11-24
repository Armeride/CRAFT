import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runGit } from '../packages/git-workspace/src/git.js';
import { ProjectIndex } from '../packages/indexer/src/service.js';
import { loadCommittedProject } from '../packages/project-fs/src/git-baseline.js';
import { registerLocal } from '../packages/tasks/src/projects.js';
import type { Baseline, Entity, Revision } from '../packages/schema/src/generated.js';

const entities = 1_000;
const revisions = 10;
const samples = 20;
const entityId = (number: number) => `ent_scale_${String(number)}`;
const revisionId = (entity: number, revision: number) => `rev_scale_${String(entity)}_${String(revision)}`;

async function writeEntity(root: string, number: number): Promise<void> {
  const id = entityId(number);
  const folder = join(root, 'entities', id);
  await mkdir(join(folder, 'revisions'), { recursive: true });
  await writeFile(join(folder, 'entity.yaml'), JSON.stringify({ id, kind: 'document' } satisfies Entity));
  await Promise.all(Array.from({ length: revisions }, async (_, revision) => {
    const path = join(folder, 'revisions', revisionId(number, revision));
    await mkdir(path);
    const meta: Revision = {
      entity_id: id, revision_id: revisionId(number, revision), title: `기획 항목 ${String(number)} · ${String(revision)}`,
      status: 'draft', body_path: 'content.md', parents: revision ? [revisionId(number, revision - 1)] : [],
      scope: {}, extensions: {}, references: number % 5 ? [{ reference_id: 'ref_neighbor',
        relation: 'related_to', propagation: 'none', update_policy: 'pinned',
        target: { entity_id: entityId(number - 1), revision_id: revisionId(number - 1, revision) } }] : [],
      created_at: '2026-11-10T04:00:00Z', created_by: { id: 'scale-fixture', type: 'user' },
    };
    await Promise.all([
      writeFile(join(path, 'meta.yaml'), JSON.stringify(meta)),
      writeFile(join(path, 'content.md'), `# ${meta.title}\n\n국경과 교역로의 배경. 장면과 게임 기획에서 참고한다.\n`),
    ]);
  }));
}

const home = await mkdtemp(join(tmpdir(), 'craft-index-scale-'));
try {
  const root = join(home, 'project'), appData = join(home, 'app');
  await cp(resolve('fixtures/valid-minimal'), root, { recursive: true });
  await Promise.all(['entities/ent_overview', 'reviews', 'tasks'].map(path => rm(join(root, path), { recursive: true })));
  const batch = 16;
  const offsets = Array.from({ length: Math.ceil(entities / batch) }, (_, i) => i * batch);
  await offsets.reduce(async (previous, first) => {
    await previous;
    await Promise.all(Array.from({ length: Math.min(batch, entities - first) }, (_, i) => writeEntity(root, first + i)));
  }, Promise.resolve());
  const baseline: Baseline = { id: 'baseline_main', kind: 'working', name: 'Scale', scope: {},
    closure_policy: 'require_selected_dependencies',
    selected: Object.fromEntries(Array.from({ length: entities }, (_, i) => [entityId(i), revisionId(i, revisions - 1)])),
  };
  await writeFile(join(root, 'baselines/baseline_main.yaml'), JSON.stringify(baseline));
  await runGit(root, ['init']);
  await runGit(root, ['add', '.']);
  await runGit(root, ['-c', 'user.name=CRAFT Scale', '-c', 'user.email=scale@localhost', 'commit', '-m', 'index scale fixture']);
  const registration = await registerLocal(appData, root);
  if (registration.status !== 'ready') {
    await loadCommittedProject(root, 'HEAD');
    throw new Error(`Fixture registration failed: ${registration.status}`);
  }
  const index = await ProjectIndex.registered(appData, registration.id);
  try {
    const started = performance.now();
    const full = await index.rebuild(index.scopeToken, { full: true });
    const fullMs = performance.now() - started;
    if (full.counts.revisions !== entities * revisions) throw new Error('Incorrect revision count');
    const durations: number[] = [];
    await Array.from({ length: samples }).reduce<Promise<void>>(async (previous, _, sample) => {
      await previous;
      const exactStart = performance.now();
      const entity = sample * 47;
      const result = await index.query('exact', { entityId: entityId(entity), revisionId: revisionId(entity, revisions - 1) }, { scopeToken: index.scopeToken });
      durations.push(performance.now() - exactStart);
      if (!result.data || result.freshness !== 'fresh') throw new Error('Expected a fresh exact result');
    }, Promise.resolve());
    await writeFile(join(root, 'README.md'), 'Incremental source change\n');
    const incrementalStart = performance.now();
    const incremental = await index.rebuild(index.scopeToken);
    const incrementalMs = performance.now() - incrementalStart;
    if (incremental.mode !== 'incremental' || incremental.changedFiles.length !== 1 || incremental.updatedRevisions.length !== 0) throw new Error('Expected a one-file incremental update');
    durations.sort((a, b) => a - b);
    console.log(JSON.stringify({ platform: process.platform, node: process.version, entities, ...full.counts,
      exact: { samples, p50Ms: durations[9], p95Ms: durations[18] },
      full: { elapsedMs: fullMs, ...full.timings }, incremental: { elapsedMs: incrementalMs, ...incremental.timings },
    }, null, 2));
  } finally { await index.close(); }
} finally { await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
