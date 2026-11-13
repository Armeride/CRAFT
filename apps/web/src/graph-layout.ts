import type { GraphModel } from './graph-model.js';
export interface Point { x: number; y: number }
export interface GraphLayout { width: number; height: number; positions: ReadonlyMap<string, Point>; degrees: ReadonlyMap<string, number>; groups: readonly { id: number; keys: readonly string[]; x: number; y: number; width: number; height: number }[] }
export const nodeWidth = 160, nodeHeight = 64;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function topology(model: GraphModel) {
  const neighbours = new Map(model.nodes.map(node => [node.key, new Set<string>()]));
  for (const edge of model.edges) if (edge.source !== edge.target && neighbours.has(edge.source) && neighbours.has(edge.target)) { neighbours.get(edge.source)!.add(edge.target); neighbours.get(edge.target)!.add(edge.source); }
  return neighbours;
}
function bounds(positions: Map<string, Point>, degrees: Map<string, number>, clusters: string[][]): GraphLayout {
  const points = [...positions.values()], minX = Math.min(0, ...points.map(p => p.x)) - 55, minY = Math.min(0, ...points.map(p => p.y)) - 55;
  for (const p of points) { p.x -= minX; p.y -= minY; }
  return { positions, degrees, width: Math.max(260, ...points.map(p => p.x + nodeWidth + 55)), height: Math.max(200, ...points.map(p => p.y + nodeHeight + 55)), groups: clusters.filter(keys => keys.length > 1).map((keys, id) => { const group = keys.map(key => positions.get(key)!); const x = Math.min(...group.map(p => p.x)) - 24, y = Math.min(...group.map(p => p.y)) - 30; return { id: id + 1, keys, x, y, width: Math.max(...group.map(p => p.x)) + nodeWidth + 24 - x, height: Math.max(...group.map(p => p.y)) + nodeHeight + 24 - y }; }) };
}
export function columnLayout(model: GraphModel): GraphLayout {
  const groups = new Map<number, string[]>(), neighbours = topology(model);
  for (const node of model.nodes) { const rank = node.kind === 'state_model.scenario' ? 0 : node.kind.includes('occurrence') || node.kind.includes('state_event') ? 1 : node.kind.includes('transition') ? 2 : 3; const group = groups.get(rank) ?? []; group.push(node.key); groups.set(rank, group); }
  const ranks = [...groups.keys()].sort(), rows = Math.max(1, ...[...groups.values()].map(group => group.length)), positions = new Map<string, Point>();
  for (const [rank, group] of groups) for (const [index, key] of group.entries()) positions.set(key, { x: ranks.indexOf(rank) * 230, y: index * 94 + (rows - group.length) * 30 });
  return bounds(positions, new Map([...neighbours].map(([key, values]) => [key, values.size])), []);
}
export function networkLayout(model: GraphModel): GraphLayout {
  const neighbours = topology(model), keys = [...neighbours.keys()].sort(compare), degrees = new Map(keys.map(key => [key, neighbours.get(key)!.size]));
  const ranked = [...keys].sort((a, b) => degrees.get(b)! - degrees.get(a)! || compare(a, b)), hub = ranked[0];
  if (!hub) return bounds(new Map(), degrees, []);
  // Greedy positive modularity merges, on a simple undirected visual projection.
  // Reference direction, multiplicity and propagation remain intact in model.edges.
  const clusters = keys.map(key => [key]), m = [...degrees.values()].reduce((a, b) => a + b, 0) / 2;
  while (m > 0 && clusters.length > 1) {
    let best = 1e-9, pair: [number, number] | undefined;
    for (let a = 0; a < clusters.length; a++) for (let b = a + 1; b < clusters.length; b++) {
      const left = clusters[a]!, right = clusters[b]!, rightSet = new Set(right);
      const between = left.reduce((sum, key) => sum + [...neighbours.get(key)!].filter(other => rightSet.has(other)).length, 0);
      const degreeA = left.reduce((sum, key) => sum + degrees.get(key)!, 0), degreeB = right.reduce((sum, key) => sum + degrees.get(key)!, 0);
      const gain = between / m - degreeA * degreeB / (2 * m * m);
      if (gain > best) { best = gain; pair = [a, b]; }
    }
    if (!pair) break;
    clusters[pair[0]]!.push(...clusters[pair[1]]!); clusters.splice(pair[1], 1);
  }
  clusters.sort((a, b) => Number(b.includes(hub)) - Number(a.includes(hub)) || b.length - a.length || compare(a[0]!, b[0]!));
  const positions = new Map<string, Point>(), anchors = new Map<string, Point>(), maxDegree = Math.max(1, degrees.get(hub)!);
  for (const [index, cluster] of clusters.entries()) {
    const connected = cluster.some(key => degrees.get(key)! > 0), angle = (index - 1) * Math.PI * 2 / Math.max(1, clusters.length - 1);
    const radius = index === 0 ? 0 : connected ? 380 + clusters.length * 18 : 540 + clusters.length * 18;
    const anchor = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    cluster.sort((a, b) => degrees.get(b)! - degrees.get(a)! || compare(a, b));
    for (const [n, key] of cluster.entries()) { const theta = n * 2.399963229728653, distance = key === hub ? 0 : 110 + Math.sqrt(n) * 100; anchors.set(key, anchor); positions.set(key, key === hub ? { x: 0, y: 0 } : { x: anchor.x + Math.cos(theta) * distance, y: anchor.y + Math.sin(theta) * distance }); }
  }
  for (let tick = 0; tick < 180; tick++) {
    const forces = new Map(keys.map(key => [key, { x: 0, y: 0 }]));
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i]!, b = keys[j]!, p = positions.get(a)!, q = positions.get(b)!;
      const dx = q.x - p.x || .1, dy = q.y - p.y || .1, distance = Math.max(1, Math.hypot(dx, dy));
      let fx = dx / distance * 9000 / (distance * distance), fy = dy / distance * 9000 / (distance * distance);
      if (Math.abs(dx) < nodeWidth + 32 && Math.abs(dy) < nodeHeight + 26) {
        const overlapX = nodeWidth + 32 - Math.abs(dx), overlapY = nodeHeight + 26 - Math.abs(dy);
        if (overlapX < overlapY) fx += Math.sign(dx) * overlapX * .3; else fy += Math.sign(dy) * overlapY * .3;
      }
      forces.get(a)!.x -= fx; forces.get(a)!.y -= fy; forces.get(b)!.x += fx; forces.get(b)!.y += fy;
    }
    for (const a of keys) for (const b of neighbours.get(a)!) if (compare(a, b) < 0) {
      const p = positions.get(a)!, q = positions.get(b)!, dx = q.x - p.x, dy = q.y - p.y, distance = Math.max(1, Math.hypot(dx, dy)), spring = (distance - 205) * .018;
      forces.get(a)!.x += dx / distance * spring; forces.get(a)!.y += dy / distance * spring; forces.get(b)!.x -= dx / distance * spring; forces.get(b)!.y -= dy / distance * spring;
    }
    for (const key of keys) { if (key === hub) continue; const p = positions.get(key)!, anchor = anchors.get(key)!, force = forces.get(key)!; force.x += (anchor.x - p.x) * .012 - p.x * .004 * degrees.get(key)! / maxDegree; force.y += (anchor.y - p.y) * .012 - p.y * .004 * degrees.get(key)! / maxDegree; const cap = 12 * (1 - tick / 220), length = Math.max(1, Math.hypot(force.x, force.y) / cap); p.x += force.x / length; p.y += force.y / length; }
  }
  // Isolates have no attraction to a neighbourhood. Pack them along the outside
  // instead of letting them inflate the fit bounds and shrink every label.
  const connected = keys.filter(key => degrees.get(key)! > 0).map(key => positions.get(key)!), isolates = keys.filter(key => degrees.get(key) === 0);
  const minX = Math.min(0, ...connected.map(p => p.x)), maxX = Math.max(0, ...connected.map(p => p.x)), maxY = Math.max(0, ...connected.map(p => p.y));
  const columns = Math.max(1, Math.min(6, Math.max(Math.ceil(Math.sqrt(isolates.length)), Math.floor((maxX - minX + nodeWidth) / (nodeWidth + 36)))));
  for (const [index, key] of isolates.entries()) positions.set(key, { x: minX + index % columns * (nodeWidth + 36), y: (connected.length ? maxY + nodeHeight + 100 : 0) + Math.floor(index / columns) * (nodeHeight + 44) });
  return bounds(positions, degrees, clusters);
}
