import { describe, expect, it } from 'vitest';
import type { Edge } from '../../server/contracts.js';
import type { GraphModel } from './graph-model.js';
import { columnLayout, networkLayout, nodeHeight, nodeWidth } from './graph-layout.js';
function model(ids: string[], links: [string, string][]): GraphModel {
  return { nodes: ids.map(entityId => ({ key: entityId + '/rev_1', entityId, revisionId: 'rev_1', title: entityId, kind: 'core.document', historical: false, external: false })), edges: links.map(([from, to], index): Edge => ({ source: from + '/rev_1', target: to + '/rev_1', path: 'test', pointer: '/references/' + index, reference: { reference_id: 'ref_' + index, target: { entity_id: to, revision_id: 'rev_1' }, relation: 'depends_on', propagation: 'blocking', update_policy: 'pinned' } })), truncated: false };
}
describe('relationship layout contract', () => {
  it('keeps the most-connected node inside its surrounding star and never changes reference data', () => {
    const value = model(['hub', 'a', 'b', 'c', 'd', 'e', 'f'], ['a', 'b', 'c', 'd', 'e', 'f'].map(key => [key, 'hub'])), before = JSON.stringify(value), layout = networkLayout(value), hub = layout.positions.get('hub/rev_1')!;
    expect(layout.degrees.get('hub/rev_1')).toBe(6);
    const leaves = [...layout.positions].filter(([key]) => key !== 'hub/rev_1').map(([, p]) => p);
    expect(hub.x).toBeGreaterThan(Math.min(...leaves.map(p => p.x))); expect(hub.x).toBeLessThan(Math.max(...leaves.map(p => p.x)));
    expect(hub.y).toBeGreaterThan(Math.min(...leaves.map(p => p.y))); expect(hub.y).toBeLessThan(Math.max(...leaves.map(p => p.y)));
    expect(JSON.stringify(value)).toBe(before);
  });
  it('keeps two densely connected neighbourhoods distinct despite a bridge', () => {
    const ids = ['a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'b3', 'b4'], links: [string, string][] = [['a1', 'b1']];
    for (const prefix of ['a', 'b']) for (let a = 1; a <= 4; a++) for (let b = a + 1; b <= 4; b++) links.push([prefix + a, prefix + b]);
    const layout = networkLayout(model(ids, links));
    expect(layout.groups.some(group => group.keys.length === 4 && group.keys.every(key => key.startsWith('a')))).toBe(true);
    expect(layout.groups.some(group => group.keys.length === 4 && group.keys.every(key => key.startsWith('b')))).toBe(true);
    const a = layout.positions.get('a2/rev_1')!, b = layout.positions.get('b2/rev_1')!; expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(nodeWidth);
  });
  it('handles self-loops, parallel pins, cycles, isolates and empty graphs with finite deterministic positions', () => {
    const value = model(['a', 'b', 'c', 'alone'], [['a', 'b'], ['a', 'b'], ['b', 'a'], ['b', 'c'], ['c', 'a'], ['a', 'a']]);
    const layout = networkLayout(value); expect(layout.degrees.get('a/rev_1')).toBe(2); expect(layout.degrees.get('alone/rev_1')).toBe(0);
    expect([...networkLayout({ ...value, nodes: [...value.nodes].reverse(), edges: [...value.edges].reverse() }).positions]).toEqual([...layout.positions]);
    for (const engine of [networkLayout, columnLayout]) { const result = engine(value); expect(result.positions.size).toBe(4); for (const point of result.positions.values()) { expect(Number.isFinite(point.x + point.y)).toBe(true); expect(point.x + nodeWidth).toBeLessThanOrEqual(result.width); expect(point.y + nodeHeight).toBeLessThanOrEqual(result.height); } expect(engine(model([], [])).positions.size).toBe(0); }
  });
});
