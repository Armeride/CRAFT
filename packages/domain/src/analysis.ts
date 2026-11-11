import { canonicalJson, normalizedScope } from './canonical.js';
import { revisionKey, ValidationFailure } from './model.js';
import type { Diagnostic } from './model.js';
import type { ProjectSnapshot, Reference, RevisionRecord, Scope, SnapshotTarget } from './model.js';
import type { JsonValue, Review, ContextManifest } from '../../schema/src/generated.js';
import { scopesOverlap } from './validate.js';

function compatible(...scopes: Scope[]): boolean {
  if (new Set(scopes.map(scope => scope.continuity ?? 'main')).size > 1) return false;
  return (['platform', 'mode'] as const).every(dimension => {
    const constraints = scopes.flatMap(scope => scope[dimension] ? [scope[dimension]!] : []);
    return constraints.length === 0 || constraints[0]!.some(value => constraints.every(list => list.includes(value)));
  });
}

export interface Issue extends Diagnostic { messageKey: string; params: Record<string, JsonValue>; blocksApproval: boolean }
export function issue(code: string, path: string, pointer = '', params: Record<string, JsonValue> = {}, blocksApproval = false): Issue {
  return { code, message: code, messageKey: `diagnostics.${code}`, params, path, pointer, severity: blocksApproval ? 'error' : 'warning', blocksApproval };
}
export interface Digests { semantic(entity: string, revision: string): string; dependency(entity: string, revision: string): string }
export interface Edge { source: string; target: string; reference: Reference; path: string; pointer: string }
export interface Cause { code: string; origin: string; hops: number; path: Edge[]; truncated: boolean }
export interface UpdateNotice { source: string; referenceId: string; policy: Reference['update_policy']; level: 'information' | 'review'; candidates: string[]; divergent: string[] }
export interface NodeState { target: SnapshotTarget; directStatus: RevisionRecord['meta']['status']; blockers: Cause[]; advisories: Cause[]; truncated: boolean; review: 'valid' | 'missing' | 'stale' | 'rejected' | 'unsupported' }
export interface BaselineAnalysis { baselineId: string; releaseEligible: boolean; diagnostics: Issue[]; nodes: Record<string, NodeState>; updates: UpdateNotice[]; components: string[][]; contexts: { path: string; valid: boolean; diagnostics: Issue[] }[] }
export interface QueryScope { continuity?: string; platform?: string; mode?: string }
export const records = (snapshot: ProjectSnapshot) => new Map([...snapshot.entities.values()].flatMap(entity => [...entity.revisions.values()].map(record => [revisionKey(entity.value.id, record.meta.revision_id), record] as const)));
export function graphEdges(snapshot: ProjectSnapshot): Edge[] {
  const edges: Edge[] = [];
  for (const [source, record] of records(snapshot)) for (const ref of record.references) edges.push({ source, target: revisionKey(ref.value.target.entity_id, ref.value.target.revision_id), reference: ref.value, path: ref.path, pointer: ref.pointer });
  for (const [path, value] of snapshot.documents) if (path.startsWith('narrative/sequences/')) {
    const sequence = value as { id: string; chapters: { scenes: Reference[] }[] };
    for (const [chapterIndex, chapter] of sequence.chapters.entries()) for (const [sceneIndex, reference] of chapter.scenes.entries()) edges.push({ source: `sequence:${sequence.id}`, target: revisionKey(reference.target.entity_id, reference.target.revision_id), reference, path, pointer: `/chapters/${chapterIndex}/scenes/${sceneIndex}` });
  }
  return edges.sort((a, b) => canonicalJson([a.source, a.reference.reference_id]).localeCompare(canonicalJson([b.source, b.reference.reference_id]), 'en'));
}

export function resolveScope(snapshot: ProjectSnapshot, baselineId: string, query: QueryScope = {}): QueryScope {
  const baseline = snapshot.baselines.get(baselineId)?.value;
  if (!baseline) throw new ValidationFailure([issue('BASELINE_MISSING', 'project.yaml', '', { baselineId })]);
  const result: QueryScope = { continuity: query.continuity ?? baseline.scope.continuity ?? 'main' };
  if (result.continuity !== (baseline.scope.continuity ?? 'main')) throw new ValidationFailure([issue('SCOPE_MISMATCH', 'project.yaml')]);
  for (const dimension of ['platform', 'mode'] as const) {
    const value = query[dimension], allowed = baseline.scope[dimension];
    if (value && allowed && !allowed.includes(value)) throw new ValidationFailure([issue('SCOPE_MISMATCH', 'project.yaml', '', { dimension, value })]);
    if (value) result[dimension] = value;
    else if (allowed?.length === 1) result[dimension] = allowed[0]!;
    else if (Object.entries(baseline.selected).some(([entity, revision]) => snapshot.entities.get(entity)?.revisions.get(revision)?.meta.scope[dimension])) throw new ValidationFailure([issue('AMBIGUOUS_SCOPE', 'project.yaml', '', { dimension })]);
  }
  return result;
}
export function applies(scope: Scope, query: QueryScope): boolean {
  return (scope.continuity ?? 'main') === (query.continuity ?? 'main') && (['platform', 'mode'] as const).every(key => query[key] === undefined || scope[key] === undefined || scope[key]!.includes(query[key]!));
}

/** Iterative Kosaraju avoids call-stack overflow on long dependency chains. */
export function stronglyConnected(keys: readonly string[], edges: readonly Edge[]): string[][] {
  const forward = new Map<string, string[]>(), reverse = new Map<string, string[]>();
  for (const edge of edges) if (edge.reference.propagation === 'blocking') { const a = forward.get(edge.source) ?? []; a.push(edge.target); forward.set(edge.source, a); const b = reverse.get(edge.target) ?? []; b.push(edge.source); reverse.set(edge.target, b); }
  const visited = new Set<string>(), order: string[] = [];
  for (const key of keys) {
    const stack: [string, boolean][] = [[key, false]];
    while (stack.length) { const [node, exit] = stack.pop()!; if (exit) { order.push(node); continue; } if (visited.has(node)) continue; visited.add(node); stack.push([node, true]); for (const child of forward.get(node) ?? []) if (!visited.has(child)) stack.push([child, false]); }
  }
  visited.clear(); const components: string[][] = [];
  for (const key of order.reverse()) {
    if (visited.has(key)) continue;
    const component: string[] = [], stack = [key]; visited.add(key);
    while (stack.length) { const node = stack.pop()!; component.push(node); for (const child of reverse.get(node) ?? []) if (!visited.has(child)) { visited.add(child); stack.push(child); } }
    if (component.length > 1 || (forward.get(key) ?? []).includes(key)) components.push(component.sort());
  }
  return components.sort((a, b) => a[0]!.localeCompare(b[0]!, 'en'));
}

function reviewCovers(review: Scope, subject: Scope, baseline: Scope): boolean {
  if ((review.continuity ?? 'main') !== (subject.continuity ?? 'main')) return false;
  return (['platform', 'mode'] as const).every(key => {
    const effective = subject[key] && baseline[key] ? subject[key]!.filter(value => baseline[key]!.includes(value)) : subject[key] ?? baseline[key];
    return review[key] === undefined || (effective !== undefined && effective.length > 0 && effective.every(value => review[key]!.includes(value)));
  });
}

export function analyzeProject(snapshot: ProjectSnapshot, baselineId: string, digests: Digests): BaselineAnalysis {
  const baseline = snapshot.baselines.get(baselineId)?.value;
  if (!baseline) throw new ValidationFailure([issue('BASELINE_MISSING', 'project.yaml', '', { baselineId })]);
  const all = records(snapshot), edges = graphEdges(snapshot).filter(edge => all.has(edge.source) && all.has(edge.target));
  const reverse = new Map<string, Edge[]>();
  for (const edge of edges) if (edge.reference.propagation !== 'none') { const list = reverse.get(edge.target) ?? []; list.push(edge); reverse.set(edge.target, list); }
  const nodes: Record<string, NodeState> = Object.create(null) as Record<string, NodeState>;
  for (const [key, record] of all) nodes[key] = { target: { entity_id: record.meta.entity_id, revision_id: record.meta.revision_id }, directStatus: record.meta.status, blockers: [], advisories: [], truncated: false, review: record.writable ? 'missing' : 'unsupported' };
  const components = stronglyConnected([...all.keys()], edges);
  const roots: { code: string; origin: string }[] = [];
  for (const [key, record] of all) {
    if (!record.writable) roots.push({ code: 'REFERENCE_CHECK_INCOMPLETE', origin: key });
    if (snapshot.project.policies.approval_blocks_on_dependency_states.includes(record.meta.status as 'draft' | 'discussing' | 'in_review') || record.meta.status === 'deprecated') roots.push({ code: record.meta.status === 'deprecated' ? 'DEPRECATED_TARGET' : 'UNRESOLVED_DEPENDENCY', origin: key });
  }
  for (const component of components) roots.push({ code: 'BLOCKING_DEPENDENCY_CYCLE', origin: component[0]! });
  for (const root of roots.sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b), 'en'))) {
    const queue: { node: string; mode: 'blockers' | 'advisories'; cause: Cause }[] = [{ node: root.origin, mode: 'blockers', cause: { ...root, hops: 0, path: [], truncated: false } }];
    const seen = new Set<string>();
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const item = queue[cursor]!, identity = item.node + ':' + item.mode;
      if (seen.has(identity)) continue; seen.add(identity);
      const state = nodes[item.node]!;
      if (state[item.mode].length >= 32) { state.truncated = true; continue; }
      state[item.mode].push(item.cause);
      for (const edge of reverse.get(item.node) ?? []) queue.push({ node: edge.source, mode: edge.reference.propagation === 'advisory' ? 'advisories' : item.mode, cause: { ...item.cause, hops: item.cause.hops + 1, path: [edge, ...item.cause.path].slice(0, 64), truncated: item.cause.truncated || item.cause.hops >= 64 } });
    }
  }
  const diagnostics: Issue[] = snapshot.diagnostics.map(d => ({ ...d, messageKey: d.messageKey ?? `diagnostics.${d.code}`, params: { ...d.params, path: d.path, pointer: d.pointer }, blocksApproval: d.severity === 'error' }));
  const updates: UpdateNotice[] = [];
  const parents = new Map<string, Set<string>>();
  const ancestors = (key: string): Set<string> => {
    const cached = parents.get(key); if (cached) return cached;
    const result = new Set<string>(), queue = [key];
    for (let index = 0; index < queue.length; index++) { const node = queue[index]!; if (result.has(node)) continue; result.add(node); const record = all.get(node); for (const id of record?.meta.parents ?? []) queue.push(revisionKey(record!.meta.entity_id, id)); }
    parents.set(key, result); return result;
  };
  const reviews = [...snapshot.documents.entries()].filter(([path]) => path.startsWith('reviews/')).map(([, value]) => value as Review);
  for (const [entityId, revisionId] of Object.entries(baseline.selected)) {
    const key = revisionKey(entityId, revisionId), record = all.get(key)!;
    if (!record) continue;
    const state = nodes[key]!;
    const subjectReviews = reviews.filter(review => review.subject.entity_id === entityId && review.subject.revision_id === revisionId);
    if (record.writable) {
      state.review = subjectReviews.length ? 'stale' : 'missing';
      for (const review of subjectReviews) {
        if (review.outcome !== 'accepted') { if (state.review !== 'valid') state.review = 'rejected'; continue; }
        try { if (review.reviewer.type === 'user' && review.semantic_model_version === 1 && review.subject_semantic_digest === digests.semantic(entityId, revisionId) && review.dependency_manifest_digest === digests.dependency(entityId, revisionId) && reviewCovers(review.scope, record.meta.scope, baseline.scope)) state.review = 'valid'; }
        catch { if (state.review !== 'valid') state.review = 'unsupported'; }
      }
    }
    if (record.meta.status !== 'approved') diagnostics.push(issue('APPROVAL_STATUS_REQUIRED', record.path, '/status', { entityId, revisionId, status: record.meta.status }, true));
    if (state.review !== 'valid') diagnostics.push(issue('REVIEW_REQUIRED', record.path, '', { entityId, revisionId, reviewState: state.review }, true));
    if (!scopesOverlap(record.meta.scope, baseline.scope)) diagnostics.push(issue('SCOPE_MISMATCH', record.path, '/scope', { entityId, revisionId }, true));
    if (state.blockers.length) diagnostics.push(issue('UNRESOLVED_DEPENDENCY', record.path, '', { entityId, revisionId, causes: state.blockers.map(cause => ({ code: cause.code, origin: cause.origin, hops: cause.hops })), truncated: state.truncated }, true));
    if (state.advisories.length) diagnostics.push(issue('ADVISORY_DEPENDENCY', record.path, '', { entityId, revisionId, origins: state.advisories.map(cause => cause.origin) }));
    for (const component of components) if (state.blockers.some(cause => cause.code === 'BLOCKING_DEPENDENCY_CYCLE' && cause.origin === component[0])) diagnostics.push(issue('BLOCKING_DEPENDENCY_CYCLE', record.path, '', { entityId, revisionId, members: component.slice(0, 32), truncated: component.length > 32 }, true));
    for (const ref of record.references) {
      const reference = ref.value, target = all.get(revisionKey(reference.target.entity_id, reference.target.revision_id));
      if (!target) continue;
      if (reference.relation === 'depends_on') {
        if (baseline.selected[reference.target.entity_id] !== reference.target.revision_id) diagnostics.push(issue('BASELINE_DEPENDENCY_MISMATCH', ref.path, ref.pointer, { entityId, revisionId, referenceId: reference.reference_id, target: { ...reference.target } }, true));
        if (!compatible(record.meta.scope, target.meta.scope, baseline.scope)) diagnostics.push(issue('SCOPE_MISMATCH', ref.path, ref.pointer, { referenceId: reference.reference_id, target: { ...reference.target } }, true));
        const selected = baseline.selected[reference.target.entity_id], selectedRecord = selected && all.get(revisionKey(reference.target.entity_id, selected));
        if (selectedRecord && selectedRecord.meta.status === 'deprecated' && compatible(record.meta.scope, selectedRecord.meta.scope, baseline.scope)) diagnostics.push(issue('DEPRECATED_IN_BASELINE', ref.path, ref.pointer, { referenceId: reference.reference_id, target: { ...reference.target } }, true));
      }
      const targetKey = revisionKey(reference.target.entity_id, reference.target.revision_id);
      const candidates: string[] = [], divergent: string[] = [];
      for (const candidate of snapshot.entities.get(reference.target.entity_id)?.revisions.values() ?? []) {
        const next = revisionKey(candidate.meta.entity_id, candidate.meta.revision_id);
        if (next === targetKey || !candidate.writable || !compatible(record.meta.scope, baseline.scope, target.meta.scope, candidate.meta.scope) || (reference.update_policy === 'track_approved' && candidate.meta.status !== 'approved')) continue;
        if (ancestors(next).has(targetKey)) candidates.push(candidate.meta.revision_id);
        else if (!ancestors(targetKey).has(next) && [...ancestors(next)].some(ancestor => ancestors(targetKey).has(ancestor))) divergent.push(candidate.meta.revision_id);
      }
      for (const a of candidates) for (const b of candidates) if (a !== b && !ancestors(revisionKey(reference.target.entity_id, a)).has(revisionKey(reference.target.entity_id, b)) && !ancestors(revisionKey(reference.target.entity_id, b)).has(revisionKey(reference.target.entity_id, a))) { if (!divergent.includes(a)) divergent.push(a); }
      if (candidates.length || divergent.length) {
        updates.push({ source: key, referenceId: reference.reference_id, policy: reference.update_policy, level: reference.update_policy === 'pinned' ? 'information' : 'review', candidates: candidates.sort(), divergent: divergent.sort() });
        if (reference.update_policy !== 'pinned' && candidates.length) diagnostics.push(issue(reference.update_policy === 'track_approved' ? 'NEW_APPROVED_REVISION' : 'NEW_REVISION', ref.path, ref.pointer, { referenceId: reference.reference_id, candidates }));
        if (divergent.length) diagnostics.push(issue('DIVERGENT_REVISIONS', ref.path, ref.pointer, { referenceId: reference.reference_id, candidates: divergent }));
      }
    }
  }
  if (!snapshot.writable) diagnostics.push(issue('PROJECT_READ_ONLY', 'project.yaml', '', {}, true));
  const contexts: BaselineAnalysis['contexts'] = [];
  for (const [path, value] of snapshot.documents) if (value && typeof value === 'object' && 'builder_version' in value && 'inputs' in value) {
    const manifest = value as ContextManifest, issues: Issue[] = [];
    for (const [index, input] of manifest.inputs.entries()) {
      const record = all.get(revisionKey(input.target.entity_id, input.target.revision_id));
      if (!record?.writable || manifest.schema_versions['core'] !== 1 || input.semantic_digest !== digests.semantic(input.target.entity_id, input.target.revision_id)) issues.push(issue('CONTEXT_SEMANTIC_MISMATCH', path, `/inputs/${index}`, { target: { ...input.target } }));
      if (snapshot.files.get(input.source_path)?.digest !== input.source_digest) issues.push(issue('CONTEXT_SOURCE_MISMATCH', path, `/inputs/${index}`, { sourcePath: input.source_path }));
    }
    if (snapshot.files.get(snapshot.baselines.get(manifest.baseline_id)?.path ?? '')?.digest !== manifest.baseline_fingerprint) issues.push(issue('CONTEXT_BASELINE_CHANGED', path));
    contexts.push({ path, valid: issues.length === 0, diagnostics: issues });
  }
  const unique = new Map(diagnostics.map(diagnostic => [canonicalJson([diagnostic.code, diagnostic.path, diagnostic.pointer, diagnostic.params]), diagnostic]));
  const sorted = [...unique.entries()].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([, diagnostic]) => diagnostic);
  return { baselineId, releaseEligible: !sorted.some(d => d.blocksApproval), diagnostics: sorted, nodes, updates, components, contexts };
}

export function reverseReferences(snapshot: ProjectSnapshot, baselineId: string, target: SnapshotTarget, options: { maxDepth?: number; maxResults?: number; includeHistory?: boolean; scope?: QueryScope } = {}) {
  const baseline = snapshot.baselines.get(baselineId)?.value;
  if (!baseline) throw new ValidationFailure([issue('BASELINE_MISSING', 'project.yaml')]);
  const all = records(snapshot), start = revisionKey(target.entity_id, target.revision_id);
  if (!all.has(start)) throw new ValidationFailure([issue('MISSING_TARGET', 'project.yaml', '', { target: { ...target } })]);
  const depth = options.maxDepth ?? 8, limit = options.maxResults ?? 100;
  if (!Number.isInteger(depth) || depth < 1 || depth > 64 || !Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('QUERY_LIMIT_INVALID');
  const queryScope = options.scope ? resolveScope(snapshot, baselineId, options.scope) : undefined;
  const edges = graphEdges(snapshot), reachable = new Set(Object.entries(baseline.selected).filter(([e, r]) => !queryScope || applies(all.get(revisionKey(e, r))!.meta.scope, queryScope)).map(([e, r]) => revisionKey(e, r)));
  const forward = new Map<string, string[]>();
  for (const edge of edges) { const list = forward.get(edge.source) ?? []; list.push(edge.target); forward.set(edge.source, list); }
  const closure = [...reachable];
  for (let index = 0; index < closure.length; index++) for (const next of forward.get(closure[index]!) ?? []) if (!reachable.has(next)) { reachable.add(next); closure.push(next); }
  const incoming = new Map<string, Edge[]>();
  for (const edge of edges) if (options.includeHistory && (!queryScope || !all.has(edge.source) || applies(all.get(edge.source)!.meta.scope, queryScope)) || reachable.has(edge.source) || edge.source.startsWith('sequence:') && reachable.has(edge.target)) { const list = incoming.get(edge.target) ?? []; list.push(edge); incoming.set(edge.target, list); }
  const queue = [{ key: start, path: [] as Edge[] }], visited = new Set([start]), results: { source: string; path: Edge[] }[] = [];
  let truncated = false;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor]!;
    for (const edge of incoming.get(current.key) ?? []) {
      if (visited.has(edge.source)) continue;
      if (current.path.length >= depth || results.length >= limit) { truncated = true; continue; }
      visited.add(edge.source); const path = [edge, ...current.path]; results.push({ source: edge.source, path }); queue.push({ key: edge.source, path });
    }
  }
  return { target, results, truncated };
}
