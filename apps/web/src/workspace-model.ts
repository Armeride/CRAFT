import type { Catalog } from '../../server/contracts.js';
export const categories = ['world', 'changes', 'scenarios', 'documents'] as const;
export type Category = typeof categories[number];
export type Collection = Category | 'all';
export type CatalogEntity = Catalog['entities'][number];
export function categoryOf(kind: string): Category { return ['location', 'item', 'world.fact', 'state_model.definition', 'narrative.character'].includes(kind) ? 'world' : ['state_model.transition', 'state_model.occurrence', 'narrative.state_event'].includes(kind) ? 'changes' : kind === 'state_model.scenario' || kind.startsWith('game.') ? 'scenarios' : 'documents'; }
export function titleOf(entity: CatalogEntity): string { return entity.revisions.find(revision => revision.revisionId === entity.selectedRevision)?.title ?? entity.revisions[0]?.title ?? entity.entityId; }
export function currentRevision(entity: CatalogEntity) { return entity.revisions.find(revision => revision.revisionId === entity.selectedRevision) ?? entity.revisions[0]; }
export function labelOf(catalog: Catalog | null, entityId: string, revisionId?: string) { const entity = catalog?.entities.find(value => value.entityId === entityId); return entity?.revisions.find(revision => revision.revisionId === (revisionId ?? entity.selectedRevision))?.title ?? entityId; }
export function workingKey(registrationId: string, baselineId: string, entityId: string, revisionId: string) { return JSON.stringify([registrationId, baselineId, entityId, revisionId]); }
