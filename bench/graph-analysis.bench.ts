// Performance baseline for the dependency-graph hot path (cycle detection runs on
// every baseline analysis). Run with `npm run bench` (Vitest 5 `bench` fixture;
// `vitest run` ignores *.bench.ts files). No absolute thresholds are asserted:
// timings vary by machine, so use the printed table for before/after comparison.
import { expect, test } from 'vitest';
import { stronglyConnected } from '../packages/domain/src/analysis.js';
import type { Edge } from '../packages/domain/src/analysis.js';

function edge(source: string, target: string, index: number): Edge {
  return {
    source,
    target,
    path: `entities/${source}.yaml`,
    pointer: `/references/${String(index)}`,
    reference: {
      reference_id: `ref_${String(index)}`,
      target: { entity_id: target, revision_id: 'rev_1' },
      relation: 'depends_on',
      propagation: 'blocking',
      update_policy: 'pinned',
    },
  };
}

/** Long chain plus a back-edge every `cycleEvery` nodes and a skip edge per node. */
function graph(size: number, cycleEvery: number): { keys: string[]; edges: Edge[] } {
  const keys = Array.from({ length: size }, (_, i) => `node_${String(i)}`);
  const edges: Edge[] = [];
  keys.forEach((key, i) => {
    const next = keys[i + 1];
    const skip = keys[i + 7];
    if (next !== undefined) edges.push(edge(key, next, edges.length));
    if (skip !== undefined) edges.push(edge(key, skip, edges.length));
    const back = keys[i - cycleEvery + 1];
    if (i % cycleEvery === cycleEvery - 1 && back !== undefined) edges.push(edge(key, back, edges.length));
  });
  return { keys, edges };
}

const small = graph(1_000, 25);
const large = graph(20_000, 50);

// Each back-edge closes one block of `cycleEvery` nodes; forward edges never merge blocks.
test('stronglyConnected: 1k nodes, cycles every 25', async ({ bench }) => {
  expect(stronglyConnected(small.keys, small.edges)).toHaveLength(1_000 / 25);
  await bench('1k nodes', () => { stronglyConnected(small.keys, small.edges); }).run();
});

test('stronglyConnected: 20k nodes, cycles every 50', async ({ bench }) => {
  expect(stronglyConnected(large.keys, large.edges)).toHaveLength(20_000 / 50);
  await bench('20k nodes', () => { stronglyConnected(large.keys, large.edges); }).run();
});
