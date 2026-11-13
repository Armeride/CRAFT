import type { Catalog, Edge } from '../../server/contracts.js';
import { categoryOf, labelOf } from './workspace-model.js';
import type { Collection } from './workspace-model.js';

export interface GraphNode { readonly key: string; readonly entityId: string; readonly revisionId: string; readonly kind: string; readonly title: string; readonly historical: boolean; readonly external: boolean }
export interface GraphModel { readonly nodes: readonly GraphNode[]; readonly edges: readonly Edge[]; readonly truncated: boolean }
export function graphModel(catalog: Catalog, collection: Collection, dependenciesOnly: boolean): GraphModel {
  const roots = new Set(catalog.entities.filter(entity => entity.selectedRevision && (collection === 'all' || categoryOf(entity.kind) === collection)).map(entity => entity.entityId + '/' + entity.selectedRevision));
  const selected = new Set(catalog.entities.filter(entity => entity.selectedRevision).map(entity => entity.entityId + '/' + entity.selectedRevision));
  const edges = (catalog.edges ?? []).filter(edge => selected.has(edge.source) && (!dependenciesOnly || edge.reference.relation === 'depends_on') && (roots.has(edge.source) || roots.has(edge.target)));
  const allKeys = [...new Set([...roots, ...edges.flatMap(edge => [edge.source, edge.target])])].sort(), keys = allKeys.slice(0, 48);
  const nodes = keys.flatMap(key => { const [entityId, revisionId] = key.split('/'), entity = catalog.entities.find(value => value.entityId === entityId); if (!entity || !revisionId) return []; return [{ key, entityId: entity.entityId, revisionId, kind: entity.kind, title: labelOf(catalog, entity.entityId, revisionId), historical: entity.selectedRevision !== revisionId, external: collection !== 'all' && categoryOf(entity.kind) !== collection }]; });
  const allowed = new Set(nodes.map(node => node.key)), visibleEdges = edges.filter(edge => allowed.has(edge.source) && allowed.has(edge.target)).slice(0, 120);
  // Engine adapters own their data; simulation libraries must never mutate the catalog.
  return { nodes, edges: structuredClone(visibleEdges), truncated: allKeys.length > nodes.length || edges.length > visibleEdges.length };
}
