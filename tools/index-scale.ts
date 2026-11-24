import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { metricsSnapshot, resetMetrics } from '../packages/domain/src/instrumentation.js';
import { ProjectIndex } from '../packages/indexer/src/service.js';
import { loadCommittedProject } from '../packages/project-fs/src/git-baseline.js';
import { registerLocal } from '../packages/tasks/src/projects.js';
import { commitAll, entityId, revisionId, writeScaleProject } from './scale-fixture.js';

const entities = 1_000;
const revisions = 10;
const samples = 20;

const home = await mkdtemp(join(tmpdir(), 'craft-index-scale-'));
try {
  const root = join(home, 'project'), appData = join(home, 'app');
  await writeScaleProject(root, { entities, revisions });
  await commitAll(root, 'index scale fixture');
  const registration = await registerLocal(appData, root);
  if (registration.status !== 'ready') {
    await loadCommittedProject(root, 'HEAD');
    throw new Error(`Fixture registration failed: ${registration.status}`);
  }
  const index = await ProjectIndex.registered(appData, registration.id);
  try {
    resetMetrics();
    const started = performance.now();
    const full = await index.rebuild(index.scopeToken, { full: true });
    const fullMs = performance.now() - started;
    const fullMetrics = metricsSnapshot();
    if (full.counts.revisions !== entities * revisions) throw new Error('Incorrect revision count');
    const durations: number[] = [];
    resetMetrics();
    await Array.from({ length: samples }).reduce<Promise<void>>(async (previous, _, sample) => {
      await previous;
      const exactStart = performance.now();
      const entity = sample * 47;
      const result = await index.query('exact', { entityId: entityId(entity), revisionId: revisionId(entity, revisions - 1) }, { scopeToken: index.scopeToken });
      durations.push(performance.now() - exactStart);
      if (!result.data || result.freshness !== 'fresh') throw new Error('Expected a fresh exact result');
    }, Promise.resolve());
    const exactMetrics = metricsSnapshot();
    await writeFile(join(root, 'README.md'), 'Incremental source change\n');
    resetMetrics();
    const incrementalStart = performance.now();
    const incremental = await index.rebuild(index.scopeToken);
    const incrementalMs = performance.now() - incrementalStart;
    const incrementalMetrics = metricsSnapshot();
    if (incremental.mode !== 'incremental' || incremental.changedFiles.length !== 1 || incremental.updatedRevisions.length !== 0) throw new Error('Expected a one-file incremental update');
    durations.sort((a, b) => a - b);
    console.log(JSON.stringify({ platform: process.platform, node: process.version, entities, ...full.counts,
      exact: { samples, p50Ms: durations[9], p95Ms: durations[18], metrics: exactMetrics },
      full: { elapsedMs: fullMs, ...full.timings, metrics: fullMetrics },
      incremental: { elapsedMs: incrementalMs, ...incremental.timings, metrics: incrementalMetrics },
      maxRssMb: Math.round(process.resourceUsage().maxRSS / 1024),
    }, null, 2));
  } finally { await index.close(); }
} finally { await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
