import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Catalog, Edge } from '../../server/contracts.js';
import { categoryOf, labelOf } from './workspace-model.js';
import type { Collection } from './workspace-model.js';
import { Icon } from './Icon.js';
export function graphModel(catalog: Catalog, collection: Collection, dependenciesOnly: boolean) {
  const roots = new Set(catalog.entities.filter(entity => entity.selectedRevision && (collection === 'all' || categoryOf(entity.kind) === collection)).map(entity => entity.entityId + '/' + entity.selectedRevision));
  const selected = new Set(catalog.entities.filter(entity => entity.selectedRevision).map(entity => entity.entityId + '/' + entity.selectedRevision));
  const edges = (catalog.edges ?? []).filter(edge => selected.has(edge.source) && (!dependenciesOnly || edge.reference.relation === 'depends_on') && (roots.has(edge.source) || roots.has(edge.target)));
  const keys = [...new Set([...roots, ...edges.flatMap(edge => [edge.source, edge.target])])].sort().slice(0, 48);
  const nodes = keys.flatMap(key => { const [entityId, revisionId] = key.split('/'), entity = catalog.entities.find(value => value.entityId === entityId); if (!entity || !revisionId) return []; return [{ key, entityId: entity.entityId, revisionId, kind: entity.kind, title: labelOf(catalog, entity.entityId, revisionId), historical: entity.selectedRevision !== revisionId, external: collection !== 'all' && categoryOf(entity.kind) !== collection }]; });
  const allowed = new Set(nodes.map(node => node.key)), visibleEdges = edges.filter(edge => allowed.has(edge.source) && allowed.has(edge.target)).slice(0, 120);
  return { nodes, edges: visibleEdges, truncated: keys.length < roots.size || edges.length > visibleEdges.length };
}
export function Graph({ catalog, collection, choose }: { catalog: Catalog; collection: Collection; choose: (entity: string, revision?: string) => void }) {
  const { t } = useTranslation(), marker = useId().replaceAll(':', ''), [dependencies, setDependencies] = useState(true);
  const model = graphModel(catalog, collection, dependencies);
  const groups = new Map<number, typeof model.nodes>();
  for (const node of model.nodes) { const rank = node.kind === 'state_model.scenario' ? 0 : node.kind.includes('occurrence') || node.kind.includes('state_event') ? 1 : node.kind.includes('transition') ? 2 : 3; const group = groups.get(rank) ?? []; group.push(node); groups.set(rank, group); }
  const occupied = [...groups.keys()].sort(), maxRows = Math.max(1, ...[...groups.values()].map(group => group.length));
  const width = Math.max(560, occupied.length * 230 + 30), height = Math.max(240, maxRows * 88 + 40);
  const positions = new Map<string, { x: number; y: number }>();
  for (const [rank, group] of groups) for (const [index, node] of group.entries()) positions.set(node.key, { x: 20 + occupied.indexOf(rank) * 230, y: 25 + index * 88 + (maxRows - group.length) * 30 });
  const path = (edge: Edge) => { const a = positions.get(edge.source)!, b = positions.get(edge.target)!; const x = a.x + 184, y = a.y + 27, tx = b.x, ty = b.y + 27; return `M${x},${y} C${x + 44},${y} ${tx - 44},${ty} ${tx},${ty}`; };
  return <section className="dashboard-card graph-card"><div className="section-heading"><div><h2><Icon name="flow"/>{t('graph.title')}</h2><p>{t('graph.description')}</p></div><select aria-label={t('graph.title')} value={dependencies ? 'dependencies' : 'all'} onChange={event => setDependencies(event.target.value === 'dependencies')}><option value="dependencies">{t('graph.dependencies')}</option><option value="all">{t('graph.all')}</option></select></div>
    {model.nodes.length ? <div className="graph-scroll" role="group" aria-label={t('graph.title')}><div className="graph-canvas" style={{ width, height }}><svg width={width} height={height} aria-hidden="true"><defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>{model.edges.map(edge => <path key={edge.source + ':' + edge.reference.reference_id} d={path(edge)} className={edge.reference.propagation === 'blocking' ? 'graph-edge' : 'graph-edge advisory'} markerEnd={`url(#${marker})`}/>)}</svg>{model.nodes.map(node => { const position = positions.get(node.key)!; return <button key={node.key} className={`graph-node ${node.external ? 'external-node' : ''}`} style={{ left: position.x, top: position.y }} aria-label={t('graph.open', { title: node.title, revision: node.revisionId })} onClick={() => choose(node.entityId, node.revisionId)}><strong lang={catalog.project.language}>{node.title}</strong><small>{node.historical ? t('graph.historical') : node.external ? t('graph.external') : t('kind.' + node.kind, { defaultValue: t('kind.other') })}</small></button>; })}</div></div> : <p className="empty-message">{t('graph.empty')}</p>}
    <div className="graph-legend"><span><i/>{t('graph.blocking')}</span><span><i className="dashed"/>{t('graph.other')}</span></div>{model.truncated && <p className="helper-text">{t('graph.limit')}</p>}
    <details className="relationship-list"><summary>{t('graph.list')}</summary>{model.edges.length ? model.edges.map(edge => <div key={edge.source + edge.reference.reference_id}><button onClick={() => { const [entity, revision] = edge.source.split('/'); choose(entity!, revision); }}>{labelOf(catalog, ...edge.source.split('/') as [string, string])}</button><span aria-hidden="true">→</span><button onClick={() => choose(edge.reference.target.entity_id, edge.reference.target.revision_id)}>{labelOf(catalog, edge.reference.target.entity_id, edge.reference.target.revision_id)}</button><span className="badge">{t('relation.' + edge.reference.relation, { defaultValue: edge.reference.relation })}</span></div>) : <p>{t('graph.empty')}</p>}</details>
  </section>;
}
