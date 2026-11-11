import { describe, expect, it } from 'vitest';
import { analyzeProject, reverseReferences, resolveScope } from './analysis.js';
import type { ProjectSnapshot, Reference, Revision, Scope, SourceFile } from './model.js';
import { revisionDiff } from './diff.js';
import { captureFiles } from '../../project-fs/src/files.js';
import { objectFile, rawObject } from '../../project-fs/src/content.js';
import { parseProject } from '../../project-fs/src/project.js';
import { semanticDigest, dependencyManifestDigest } from '../../project-fs/src/changes.js';
import type { Baseline } from '../../schema/src/generated.js';

interface Entry { id: string; revision?: string; parents?: string[]; status?: Revision['status']; references?: Reference[]; scope?: Scope; body?: string }
const ref = (id: string, target: string, propagation: Reference['propagation'] = 'blocking', policy: Reference['update_policy'] = 'pinned', relation: Reference['relation'] = 'depends_on', revision?: string): Reference => ({ reference_id: id, target: { entity_id: 'ent_' + target, revision_id: revision ?? 'rev_' + target }, relation, propagation, update_policy: policy, ...(relation === 'depends_on' && propagation === 'blocking' || relation !== 'depends_on' && propagation !== 'blocking' ? {} : { rationale: '명시적인 검토 전파 정책' }) });
async function project(entries: Entry[], selected?: Record<string, string>, reviews = false): Promise<ProjectSnapshot> {
  const files = new Map(await captureFiles('fixtures/valid-minimal'));
  const baseline = rawObject<Baseline>(files, 'baselines/baseline_main.yaml');
  for (const entry of entries) {
    const entity_id = 'ent_' + entry.id, revision_id = entry.revision ?? 'rev_' + entry.id;
    const meta: Revision = { entity_id, revision_id, parents: entry.parents ?? [], title: entry.id, status: entry.status ?? 'approved', scope: entry.scope ?? {}, body_path: 'content.md', references: entry.references ?? [], extensions: {}, created_at: '2026-11-11T00:00:00Z', created_by: { type: 'user', id: 'test-author' } };
    for (const file of [objectFile(`entities/${entity_id}/entity.yaml`, { id: entity_id, kind: 'document' }), objectFile(`entities/${entity_id}/revisions/${revision_id}/meta.yaml`, meta)]) files.set(file.path, file);
    const path = `entities/${entity_id}/revisions/${revision_id}/content.md`, text = entry.body ?? entry.id + '\n';
    files.set(path, { path, text, contentBase64: Buffer.from(text).toString('base64'), digest: (await import('../../project-fs/src/files.js')).hash(text) });
    if (!selected) baseline.selected[entity_id] = revision_id;
  }
  if (selected) Object.assign(baseline.selected, selected);
  files.set('baselines/baseline_main.yaml', objectFile('baselines/baseline_main.yaml', baseline));
  let snapshot = parseProject(files);
  if (reviews) {
    for (const [entity, revision] of Object.entries(baseline.selected)) {
      if (entity === 'ent_overview') continue;
      const path = `reviews/review_${entity}_${revision}.yaml`;
      files.set(path, objectFile(path, { id: `review_${entity}_${revision}`, subject: { entity_id: entity, revision_id: revision }, semantic_model_version: 1, subject_semantic_digest: semanticDigest(snapshot, entity, revision), dependency_manifest_digest: dependencyManifestDigest(snapshot, entity, revision), scope: snapshot.entities.get(entity)!.revisions.get(revision)!.meta.scope, outcome: 'accepted', reviewer: { type: 'user', id: 'reviewer' }, created_at: '2026-11-11T00:00:00Z' }));
    }
    snapshot = parseProject(files);
  }
  return snapshot;
}
const analyze = (snapshot: ProjectSnapshot) => analyzeProject(snapshot, 'baseline_main', { semantic: (e, r) => semanticDigest(snapshot, e, r), dependency: (e, r) => dependencyManifestDigest(snapshot, e, r) });

describe('reference graph, review gates and immutable direct status', () => {
  it('propagates a draft through two blocking edges with an exact cause path (AT-07)', async () => {
    const snapshot = await project([{ id: 'c', status: 'draft' }, { id: 'b', references: [ref('ref_bc', 'c')] }, { id: 'a', references: [ref('ref_ab', 'b')] }], undefined, true);
    const result = analyze(snapshot), a = result.nodes['ent_a/rev_a']!;
    expect(a.directStatus).toBe('approved'); expect(snapshot.entities.get('ent_a')!.revisions.get('rev_a')!.meta.status).toBe('approved');
    const cause = a.blockers.find(cause => cause.origin === 'ent_c/rev_c')!;
    expect(cause.hops).toBe(2); expect(cause.path.map(edge => edge.reference.reference_id)).toEqual(['ref_ab', 'ref_bc']); expect(result.releaseEligible).toBe(false);
    const reverse = reverseReferences(snapshot, 'baseline_main', { entity_id: 'ent_c', revision_id: 'rev_c' }); expect(reverse.results.map(r => r.source)).toEqual(['ent_b/rev_b', 'ent_a/rev_a']);
  });

  it('allows a discarded historical comparison and propagates advisory only as a warning (AT-08/32)', async () => {
    const snapshot = await project([{ id: 'old', status: 'deprecated' }, { id: 'compare', references: [ref('ref_compare', 'old', 'none', 'pinned', 'compares')] }, { id: 'evidence', references: [ref('ref_evidence', 'old', 'advisory', 'pinned', 'evidence')] }], { ent_compare: 'rev_compare', ent_evidence: 'rev_evidence' }, true);
    const result = analyze(snapshot);
    expect(result.nodes['ent_compare/rev_compare']!.blockers).toEqual([]); expect(result.nodes['ent_compare/rev_compare']!.advisories).toEqual([]);
    expect(result.nodes['ent_evidence/rev_evidence']!.blockers).toEqual([]); expect(result.nodes['ent_evidence/rev_evidence']!.advisories[0]!.origin).toBe('ent_old/rev_old');
    expect(result.releaseEligible).toBe(true);
  });

  it('keeps a pinned draft blocker when an approved child becomes available (AT-09/33)', async () => {
    const snapshot = await project([{ id: 'dep', status: 'draft' }, { id: 'dep', revision: 'rev_approved', parents: ['rev_dep'] }, { id: 'a', references: [ref('ref_a', 'dep', 'blocking', 'track_approved')] }], { ent_dep: 'rev_dep', ent_a: 'rev_a' });
    const result = analyze(snapshot); expect(result.nodes['ent_a/rev_a']!.blockers.some(cause => cause.origin === 'ent_dep/rev_dep')).toBe(true);
    expect(result.updates.find(item => item.source === 'ent_a/rev_a')!.candidates).toEqual(['rev_approved']);
    expect(snapshot.entities.get('ent_a')!.revisions.get('rev_a')!.references[0]!.value.target.revision_id).toBe('rev_dep');
  });

  it('reports sibling divergence without timestamp selection and ignores PvP successors for PvE (AT-10/48)', async () => {
    const scope = { platform: ['pc'], mode: ['pve'] };
    const snapshot = await project([{ id: 'dep', scope }, { id: 'dep', revision: 'rev_pvp', parents: ['rev_dep'], scope: { platform: ['pc'], mode: ['pvp'] } }, { id: 'a', scope, references: [ref('ref_a', 'dep', 'blocking', 'track_approved')] }], { ent_dep: 'rev_dep', ent_a: 'rev_a' });
    expect(analyze(snapshot).updates).toEqual([]);
    const generic = await project([{ id: 'dep', scope }, { id: 'dep', revision: 'rev_pvp', parents: ['rev_dep'], scope: { platform: ['pc'], mode: ['pvp'] } }, { id: 'a', references: [ref('ref_a', 'dep', 'blocking', 'track_approved')] }], { ent_dep: 'rev_dep', ent_a: 'rev_a' });
    expect(analyze(generic).updates).toEqual([]);
    const divergent = await project([{ id: 'dep' }, { id: 'dep', revision: 'rev_b', parents: ['rev_dep'] }, { id: 'dep', revision: 'rev_c', parents: ['rev_dep'] }, { id: 'a', references: [ref('ref_a', 'dep', 'blocking', 'track_approved')] }], { ent_dep: 'rev_dep', ent_a: 'rev_a' });
    expect(analyze(divergent).updates[0]!.divergent).toEqual(['rev_b', 'rev_c']);
    expect(divergent.baselines.get('baseline_main')!.value.selected.ent_dep).toBe('rev_dep');
    expect(() => resolveScope(snapshot, 'baseline_main')).toThrow('AMBIGUOUS_SCOPE'); expect(resolveScope(snapshot, 'baseline_main', { platform: 'pc', mode: 'pve' })).toMatchObject({ mode: 'pve' });
  });

  it('makes blocking SCCs finite and blocks release while retaining ordinary identity links (AT-43)', async () => {
    const snapshot = await project([{ id: 'a', status: 'draft', references: [ref('ref_a', 'b')] }, { id: 'b', status: 'draft', references: [ref('ref_b', 'a')] }]);
    const result = analyze(snapshot); expect(result.components).toEqual([['ent_a/rev_a', 'ent_b/rev_b']]); expect(result.releaseEligible).toBe(false);
    expect(result.diagnostics.map(d => d.code)).toContain('BLOCKING_DEPENDENCY_CYCLE'); expect(result.nodes['ent_a/rev_a']!.blockers.length).toBeLessThan(10);
    const identity = await project([{ id: 'a', references: [ref('ref_a', 'b', 'none', 'pinned', 'related_to')] }, { id: 'b', references: [ref('ref_b', 'a', 'none', 'pinned', 'related_to')] }], undefined, true);
    expect(analyze(identity).components).toEqual([]); expect(analyze(identity).releaseEligible).toBe(true);
    expect(reverseReferences(snapshot, 'baseline_main', { entity_id: 'ent_a', revision_id: 'rev_a' }).results).toHaveLength(1);
  });

  it('does not globally deprecate an element because an unselected deprecated revision exists (AT-42)', async () => {
    const snapshot = await project([{ id: 'dep' }, { id: 'dep', revision: 'rev_deprecated', parents: ['rev_dep'], status: 'deprecated' }, { id: 'a', references: [ref('ref_a', 'dep')] }], { ent_dep: 'rev_dep', ent_a: 'rev_a' }, true);
    expect(analyze(snapshot).releaseEligible).toBe(true); expect(analyze(snapshot).diagnostics.some(d => d.code === 'DEPRECATED_IN_BASELINE')).toBe(false);
    const files = new Map(snapshot.files), baseline = rawObject<Baseline>(files, 'baselines/baseline_main.yaml'); baseline.selected.ent_dep = 'rev_deprecated'; files.set('baselines/baseline_main.yaml', objectFile('baselines/baseline_main.yaml', baseline));
    expect(analyze(parseProject(files)).diagnostics.map(d => d.code)).toContain('DEPRECATED_IN_BASELINE');
  });

  it('requires a valid user review of the exact semantic/dependency inputs (AT-44)', async () => {
    const noReview = await project([{ id: 'a' }]); expect(analyze(noReview).releaseEligible).toBe(false); expect(analyze(noReview).nodes['ent_a/rev_a']!.review).toBe('missing');
    const reviewed = await project([{ id: 'a' }], undefined, true); expect(analyze(reviewed).releaseEligible).toBe(true);
    const path = 'reviews/review_ent_a_rev_a.yaml', files = new Map(reviewed.files), review = rawObject<Record<string, unknown>>(files, path);
    files.set(path, objectFile(path, { ...review, reviewer: { type: 'agent', id: 'fake' } })); expect(analyze(parseProject(files)).releaseEligible).toBe(false);
    files.set(path, objectFile(path, { ...review, subject_semantic_digest: '0'.repeat(64) })); expect(analyze(parseProject(files)).nodes['ent_a/rev_a']!.review).toBe('stale');
    files.set(path, objectFile(path, { ...review, dependency_manifest_digest: '0'.repeat(64) })); expect(analyze(parseProject(files)).releaseEligible).toBe(false);
    expect(analyze(reviewed).diagnostics.every(d => d.messageKey === 'diagnostics.' + d.code && d.params !== undefined)).toBe(true);
  });

  it('returns bounded reverse cause paths and structural/body/reference diffs', async () => {
    const snapshot = await project([{ id: 'dep' }, { id: 'a', references: [ref('ref_a', 'dep')], body: '첫 줄\n기존 본문\n끝\n' }, { id: 'a', revision: 'rev_after', parents: ['rev_a'], references: [ref('ref_changed', 'dep', 'none', 'pinned', 'cites')], body: '첫 줄\n고친 본문\n끝\n' }, { id: 'b', references: [ref('ref_b', 'a', 'blocking', 'pinned', 'depends_on', 'rev_after')] }]);
    const reverse = reverseReferences(snapshot, 'baseline_main', { entity_id: 'ent_dep', revision_id: 'rev_dep' }, { maxDepth: 1 }); expect(reverse.truncated).toBe(true);
    const entity = snapshot.entities.get('ent_a')!, diff = revisionDiff(entity.revisions.get('rev_a')!, entity.revisions.get('rev_after')!);
    expect(diff.body.hunk).toEqual({ startLine: 2, removed: ['기존 본문'], added: ['고친 본문'] }); expect(diff.references.map(r => r.referenceId)).toEqual(['ref_a', 'ref_changed']); expect(diff.fields.some(field => field.pointer === '/revision_id')).toBe(true);
  });
});
