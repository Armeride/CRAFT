import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Catalog } from '../../server/contracts.js';
import { labelOf } from './workspace-model.js';
import type { Collection } from './workspace-model.js';
import { Icon } from './Icon.js';
import { graphModel } from './graph-model.js';
import { resolveGraphEngine } from './graph-engines.js';
import type { GraphEngineId } from './graph-engines.js';
export { graphModel } from './graph-model.js';
export function Graph({ catalog, collection, choose, engineId }: { catalog: Catalog; collection: Collection; choose: (entity: string, revision?: string) => void; engineId: GraphEngineId }) {
  const { t } = useTranslation(), [dependencies, setDependencies] = useState(true);
  const model = useMemo(() => graphModel(catalog, collection, dependencies), [catalog, collection, dependencies]);
  const engine = resolveGraphEngine(engineId), View = engine.View;
  return <section className="dashboard-card graph-card" data-engine={engine.id}><div className="section-heading"><div><h2><Icon name="flow"/>{t('graph.title')}</h2><p>{t('graph.description')}</p></div><select aria-label={t('graph.title')} value={dependencies ? 'dependencies' : 'all'} onChange={event => setDependencies(event.target.value === 'dependencies')}><option value="dependencies">{t('graph.dependencies')}</option><option value="all">{t('graph.all')}</option></select></div>
    <p className="graph-layout-note">{t('option.' + engine.id)} · {t(engine.helpKey)}</p>
    {model.nodes.length ? <View key={engine.id} model={model} language={catalog.project.language} choose={choose}/> : <p className="empty-message">{t('graph.empty')}</p>}
    <div className="graph-legend"><span><i/>{t('graph.blocking')}</span><span><i className="dashed"/>{t('graph.other')}</span></div>{model.truncated && <p className="helper-text">{t('graph.limit')}</p>}
    <details className="relationship-list"><summary>{t('graph.list')}</summary>{model.edges.length ? model.edges.map(edge => <div key={edge.source + edge.reference.reference_id}><button onClick={() => { const [entity, revision] = edge.source.split('/'); choose(entity!, revision); }}>{labelOf(catalog, ...edge.source.split('/') as [string, string])}</button><span aria-hidden="true">→</span><button onClick={() => choose(edge.reference.target.entity_id, edge.reference.target.revision_id)}>{labelOf(catalog, edge.reference.target.entity_id, edge.reference.target.revision_id)}</button><span className="badge">{t('relation.' + edge.reference.relation, { defaultValue: edge.reference.relation })}</span></div>) : <p>{t('graph.empty')}</p>}</details>
  </section>;
}
