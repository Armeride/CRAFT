import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { indexFixture, removeIndexFixture, commitFixture } from '../../indexer/src/test-helpers.js';
import type { IndexFixture } from '../../indexer/src/test-helpers.js';
import { repositoryGuard } from '../../git-workspace/src/worktree.js';
import { gitText, runGit } from '../../git-workspace/src/git.js';
import { loadProject } from '../../project-fs/src/project.js';
import { registerLocal } from './projects.js';
import { ManualService } from './manual.js';
import { IntegrationService } from './integration.js';
import { assertIntegrationReady } from './integration-state.js';
import { ProjectIndex } from '../../indexer/src/service.js';
import { objectFile } from '../../project-fs/src/content.js';
import type { Reference } from '../../schema/src/generated.js';
const fixtures: IndexFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await removeIndexFixture(fixture); });
async function setup() { const fixture = await indexFixture(); fixtures.push(fixture); const registration = await registerLocal(fixture.app, fixture.root), service = new ManualService(fixture.app), run = await service.tasks.start(registration.id, { goal: 'Manual workflow acceptance' }); return { ...fixture, registration, service, run, integrations: new IntegrationService(fixture.app) }; }
describe('manual revision, review and integration workflow', () => {
  async function prepared() { const f = await setup(), initial = await f.service.inspect(f.run.runId), result = await f.service.execute(f.run.runId, initial.snapshot, randomUUID(), { type: 'revision', value: { title: 'Interrupted result', status: 'draft', scope: {}, references: [], extensions: {}, tags: [], body: 'Preserved result', baselineId: 'baseline_main', select: true } }); return { ...f, record: await f.integrations.prepare(f.run.runId, randomUUID(), [result.proposalId!]) }; }
  it('requires a new user review when only pinned references change and preserves the previous reviewed body', async () => {
    const f = await setup(), input = { title: 'Reviewed rule', status: 'approved' as const, scope: {}, references: [], extensions: {}, tags: [], body: 'Identical body', baselineId: 'baseline_main', select: true };
    const first = await f.service.execute(f.run.runId, (await f.service.inspect(f.run.runId)).snapshot, randomUUID(), { type: 'revision', value: input });
    await f.service.execute(f.run.runId, (await f.service.inspect(f.run.runId)).snapshot, randomUUID(), { type: 'review', entityId: first.entityId!, revisionId: first.revisionId!, outcome: 'accepted' });
    const reviewed = await f.service.inspect(f.run.runId); expect(reviewed.analysis.nodes[first.entityId + '/' + first.revisionId]?.review).toBe('valid');
    const next = await f.service.execute(f.run.runId, reviewed.snapshot, randomUUID(), { type: 'revision', value: { ...input, entityId: first.entityId!, parentRevision: first.revisionId!, references: [{ reference_id: 'ref_evidence', relation: 'related_to', propagation: 'none', update_policy: 'pinned', target: { entity_id: 'ent_overview', revision_id: 'rev_overview_a' } }] } });
    const current = await f.service.inspect(f.run.runId); expect(current.reviews).toEqual(reviewed.reviews); expect(current.analysis.nodes[next.entityId + '/' + next.revisionId]?.review).toBe('missing');
    const snapshot = await f.service.tasks.project(f.run.runId); expect(snapshot.entities.get(first.entityId!)!.revisions.get(first.revisionId!)!.body).toBe(input.body); expect(snapshot.entities.get(next.entityId!)!.revisions.get(next.revisionId!)!.body).toBe(input.body);
    await expect(f.integrations.prepare(f.run.runId, randomUUID(), current.proposals.map(value => value.id))).rejects.toThrow(/APPROVAL_BLOCKED/);
  }, 90_000);
  it('blocks stale indexed reads after staging interruption and resumes the approved candidate exactly once', async () => {
    const f = await prepared(), index = await ProjectIndex.registered(f.app, f.registration.id);
    try {
      await index.query('catalog', {}, { scopeToken: index.scopeToken });
      await expect(f.integrations.apply(f.record.id, f.record.token, async phase => { if (phase === 'target_staged') throw Error('simulated interruption'); })).rejects.toThrow('simulated interruption');
      expect(await gitText(f.root, ['rev-parse', 'HEAD'])).toBe(f.record.target.commit);
      await expect(index.query('catalog', {}, { scopeToken: index.scopeToken, allowStale: true })).rejects.toThrow(/RECOVERY_REQUIRED/);
      await expect(f.service.tasks.start(f.registration.id, { goal: 'must wait' })).rejects.toThrow(/RECOVERY_REQUIRED/);
      expect((await new IntegrationService(f.app).pending(f.registration.id))?.id).toBe(f.record.id);
      expect((await new IntegrationService(f.app).apply(f.record.id, f.record.token)).state).toBe('applied'); await assertIntegrationReady(f.app, f.registration.id);
      expect(await gitText(f.root, ['rev-parse', 'HEAD'])).toBe(f.record.candidateCommit);
    } finally { await index.close(); }
  }, 90_000);
  it('restores a staged candidate while preserving ignored user files and refuses to overwrite external edits', async () => {
    const f = await prepared(); await writeFile(join(f.root, '.git/info/exclude'), '\nprivate-note.txt\n'); await writeFile(join(f.root, 'private-note.txt'), 'private local bytes');
    await expect(f.integrations.apply(f.record.id, f.record.token, async () => { throw Error('stop'); })).rejects.toThrow('stop');
    const path = join(f.root, 'project.yaml'), original = await readFile(path, 'utf8'); await writeFile(path, original + '\n# external edit\n');
    await expect(f.integrations.restore(f.record.id, f.record.token)).rejects.toThrow(/INTEGRATION_RECOVERY_REQUIRED/); expect(await readFile(path, 'utf8')).toContain('external edit');
    await writeFile(path, original); expect((await f.integrations.restore(f.record.id, f.record.token)).state).toBe('cancelled'); await assertIntegrationReady(f.app, f.registration.id);
    expect(await gitText(f.root, ['rev-parse', 'HEAD'])).toBe(f.record.target.commit); expect((await repositoryGuard(f.root)).fingerprint).toBe(f.record.target.fingerprint); expect(await readFile(join(f.root, 'private-note.txt'), 'utf8')).toBe('private local bytes');
  }, 90_000);
  it('recognizes the completed ref transaction after interruption even when the task later changes', async () => {
    const f = await prepared(); await expect(f.integrations.apply(f.record.id, f.record.token, async phase => { if (phase === 'target_updated') throw Error('lost response'); })).rejects.toThrow('lost response');
    expect(await gitText(f.root, ['rev-parse', 'HEAD'])).toBe(f.record.candidateCommit);
    await f.service.tasks.saveDraft(f.run.runId, 'ui-draft.md', 'later working text', null);
    expect((await new IntegrationService(f.app).apply(f.record.id, f.record.token)).state).toBe('applied'); await assertIntegrationReady(f.app, f.registration.id); expect((await f.integrations.pending(f.registration.id))).toBeNull();
  }, 90_000);
  it('creates immutable approved revisions, binds user reviews, integrates exact diff once and restores replay from disk', async () => {
    const f = await setup(), before = await repositoryGuard(f.root), input = { type: 'revision' as const, value: { title: '사용자 작성 규칙', status: 'approved' as const, scope: {}, references: [], extensions: {}, tags: [], body: '검토할 새 원문', baselineId: 'baseline_main', select: true } }, request = randomUUID();
    const initial = await f.service.inspect(f.run.runId), created = await f.service.execute(f.run.runId, initial.snapshot, request, input);
    expect(await f.service.execute(f.run.runId, initial.snapshot, request, input)).toEqual(created);
    await expect(f.service.execute(f.run.runId, initial.snapshot, request, { ...input, value: { ...input.value, title: '다른 요청' } })).rejects.toThrow(/REQUEST_ID_REUSED/);
    expect(await repositoryGuard(f.root)).toEqual(before);
    await expect(f.integrations.prepare(f.run.runId, randomUUID(), [created.proposalId!])).rejects.toThrow(/APPROVAL_BLOCKED/);
    const changed = await f.service.inspect(f.run.runId); expect(changed.analysis.nodes[created.entityId + '/' + created.revisionId]?.review).toBe('missing');
    const reviewed = await f.service.execute(f.run.runId, changed.snapshot, randomUUID(), { type: 'review', entityId: created.entityId!, revisionId: created.revisionId!, outcome: 'accepted' }); expect(reviewed.reviewId).toMatch(/^review_/);
    const prepared = await f.integrations.prepare(f.run.runId, randomUUID(), [created.proposalId!]); expect(prepared.diff).toContain('검토할 새 원문'); expect(prepared.diff).toContain('consumed_proposals'); expect(await repositoryGuard(f.root)).toEqual(before);
    await expect(f.integrations.apply(prepared.id, '0'.repeat(64))).rejects.toThrow(/REVIEW_TOKEN_INVALID/);
    expect((await f.integrations.apply(prepared.id, prepared.token)).state).toBe('applied'); const resultCommit = await gitText(f.root, ['rev-parse', 'HEAD']); expect(resultCommit).toBe(prepared.candidateCommit);
    const result = await loadProject(f.root); expect(result.baselines.get('baseline_main')!.value.selected[created.entityId!]).toBe(created.revisionId);
    expect((await new IntegrationService(f.app).apply(prepared.id, prepared.token)).state).toBe('applied'); expect(await gitText(f.root, ['rev-parse', 'HEAD'])).toBe(resultCommit); expect((await repositoryGuard(f.root)).status).toBe('');
  }, 90_000);
  it('rejects stale snapshots, changed task/target and dirty work without discarding original edits', async () => {
    const f = await setup(), initial = await f.service.inspect(f.run.runId), input = { type: 'revision' as const, value: { title: '초안', status: 'draft' as const, scope: {}, references: [], extensions: {}, tags: [], body: '초안', baselineId: 'baseline_main', select: true } };
    const created = await f.service.execute(f.run.runId, initial.snapshot, randomUUID(), input);
    await expect(f.service.execute(f.run.runId, initial.snapshot, randomUUID(), input)).rejects.toThrow(/BASE_CHANGED/);
    const prepared = await f.integrations.prepare(f.run.runId, randomUUID(), [created.proposalId!]);
    await writeFile(join(f.root, 'README.md'), '사용자가 바꾼 원문');
    await expect(f.integrations.apply(prepared.id, prepared.token)).rejects.toThrow(/BASE_CHANGED/);
    await commitFixture(f.root); await expect(f.integrations.apply(prepared.id, prepared.token)).rejects.toThrow(/BASE_CHANGED/);
    const latest = await f.service.inspect(f.run.runId); await f.service.execute(f.run.runId, latest.snapshot, randomUUID(), { type: 'review', entityId: created.entityId!, revisionId: created.revisionId!, outcome: 'rejected' });
    await expect(f.integrations.apply(prepared.id, prepared.token)).rejects.toThrow(/BASE_CHANGED/);
  }, 90_000);
  it('merges disjoint baseline selections and rejects approval of a changed source checkpoint (AT-45)', async () => {
    const f = await setup();
    const input = { title: 'Independent document', status: 'draft', scope: {}, references: [], extensions: {}, tags: [], body: 'Parallel text', baselineId: 'baseline_main', select: true } as const;
    const command = { type: 'revision' as const, value: { ...input, references: [], tags: [] } };
    const work = await f.service.execute(f.run.runId, (await f.service.inspect(f.run.runId)).snapshot, randomUUID(), command);
    if (!work.proposalId || !work.entityId) throw new Error('Expected a proposed revision');
    const parallel = await f.service.tasks.start(f.registration.id, { goal: 'Parallel changes' });
    const other = await f.service.execute(parallel.runId, (await f.service.inspect(parallel.runId)).snapshot, randomUUID(), command);
    if (!other.proposalId || !other.entityId) throw new Error('Expected a parallel revision');
    const first = await f.integrations.prepare(parallel.runId, randomUUID(), [other.proposalId]);
    await f.integrations.apply(first.id, first.token);
    const prepared = await f.integrations.prepare(f.run.runId, randomUUID(), [work.proposalId]);
    await f.service.tasks.saveDraft(f.run.runId, 'ui-draft.md', 'Changed after the approval preview', null);
    await f.service.tasks.checkpoint(f.run.runId);
    await expect(f.integrations.apply(prepared.id, prepared.token)).rejects.toThrow(/BASE_CHANGED/);
    const next = await f.integrations.prepare(f.run.runId, randomUUID(), [work.proposalId]);
    expect(next.diffDigest).not.toBe(prepared.diffDigest);
    await f.integrations.apply(next.id, next.token);
    const selected = (await loadProject(f.root)).baselines.get('baseline_main')?.value.selected;
    expect(selected).toMatchObject({ [other.entityId]: other.revisionId, [work.entityId]: work.revisionId });
  }, 90_000);

  it('rejects a dependency mismatch introduced by combining independently valid selections (AT-12)', async () => {
    const f = await setup();
    const input = { title: 'New overview', status: 'draft' as const, scope: {}, references: [], extensions: {}, tags: [], body: 'New text', baselineId: 'baseline_main', select: true };
    const reference: Reference = { reference_id: 'ref_overview', relation: 'depends_on', propagation: 'blocking', update_policy: 'track_all', target: { entity_id: 'ent_overview', revision_id: 'rev_overview_a' } };
    const work = await f.service.execute(f.run.runId, (await f.service.inspect(f.run.runId)).snapshot, randomUUID(), { type: 'revision', value: { ...input, title: 'Consumer', references: [reference] } });
    if (!work.proposalId) throw new Error('Expected a proposed consumer');
    const parallel = await f.service.tasks.start(f.registration.id, { goal: 'Advance the selected overview' });
    const other = await f.service.execute(parallel.runId, (await f.service.inspect(parallel.runId)).snapshot, randomUUID(), { type: 'revision', value: { ...input, entityId: 'ent_overview', parentRevision: 'rev_overview_a' } });
    if (!other.proposalId) throw new Error('Expected a proposed overview');
    const first = await f.integrations.prepare(parallel.runId, randomUUID(), [other.proposalId]);
    await f.integrations.apply(first.id, first.token);
    const target = await repositoryGuard(f.root), source = await repositoryGuard(f.run.path);
    await expect(f.integrations.prepare(f.run.runId, randomUUID(), [work.proposalId])).rejects.toThrow(/INTEGRATION_SEMANTIC_CONFLICT.*BASELINE_DEPENDENCY_MISMATCH/s);
    expect(await repositoryGuard(f.root)).toEqual(target);
    expect(await repositoryGuard(f.run.path)).toEqual(source);
  }, 90_000);

  it('reports a new reference update even when Git merges the two changes without a conflict (AT-12)', async () => {
    const f = await setup();
    const input = { title: 'New overview', status: 'draft' as const, scope: {}, references: [], extensions: {}, tags: [], body: 'New text', baselineId: 'baseline_main', select: false };
    const reference: Reference = { reference_id: 'ref_overview', relation: 'related_to', propagation: 'none', update_policy: 'track_all', target: { entity_id: 'ent_overview', revision_id: 'rev_overview_a' } };
    const work = await f.service.execute(f.run.runId, (await f.service.inspect(f.run.runId)).snapshot, randomUUID(), { type: 'revision', value: { ...input, title: 'Consumer', references: [reference], select: true } });
    if (!work.proposalId || !work.entityId || !work.revisionId) throw new Error('Expected a proposed consumer');
    const parallel = await f.service.tasks.start(f.registration.id, { goal: 'Add an unselected successor' });
    const other = await f.service.execute(parallel.runId, (await f.service.inspect(parallel.runId)).snapshot, randomUUID(), { type: 'revision', value: { ...input, entityId: 'ent_overview', parentRevision: 'rev_overview_a' } });
    if (!other.proposalId) throw new Error('Expected a proposed successor');
    const first = await f.integrations.prepare(parallel.runId, randomUUID(), [other.proposalId]);
    await f.integrations.apply(first.id, first.token);
    const source = await gitText(f.run.path, ['rev-parse', 'HEAD']);
    await runGit(f.root, ['merge-tree', '--write-tree', first.candidateCommit, source]);
    const preview = await f.integrations.prepare(f.run.runId, randomUUID(), [work.proposalId]);
    expect(preview.advisories?.map(({ baselineId, issue }) => [baselineId, issue.code, issue.params['candidates']])).toEqual([
      ['baseline_main', 'NEW_REVISION', [other.revisionId]],
    ]);
    await f.integrations.apply(preview.id, preview.token);
    expect((await loadProject(f.root)).entities.get(work.entityId)?.revisions.get(work.revisionId)?.references[0]?.value.target).toEqual(reference.target);
  }, 90_000);

  it('defers an old task on a newer unsupported target without changing either branch (AT-17, AT-41)', async () => {
    const f = await prepared();
    const manifest = objectFile('project.yaml', { ...(await loadProject(f.root)).project, schema_version: 2 });
    if (!manifest.text) throw new Error('Expected project manifest text');
    await writeFile(join(f.root, manifest.path), manifest.text);
    await commitFixture(f.root);
    const target = await repositoryGuard(f.root), source = await repositoryGuard(f.run.path);
    await expect(f.integrations.prepare(f.run.runId, randomUUID(), f.record.proposalIds)).rejects.toThrow(/MIGRATION_MERGE_UNSUPPORTED/);
    expect(await repositoryGuard(f.root)).toEqual(target);
    expect(await repositoryGuard(f.run.path)).toEqual(source);
  }, 90_000);

  it('preserves target selections that were omitted only in the selected dirty task basis', async () => {
    const f = await setup();
    const baseline = (await loadProject(f.root)).baselines.get('baseline_main');
    if (!baseline) throw new Error('Expected the main baseline');
    const baselinePath = join(f.root, baseline.path);
    const committed = await readFile(baselinePath);
    const local = objectFile(baseline.path, { ...baseline.value, selected: {} });
    if (!local.text) throw new Error('Expected baseline text');
    await writeFile(baselinePath, local.text);
    const work = await f.service.tasks.start(f.registration.id, { goal: 'Use only the local baseline as context', includeWorkingPaths: [baseline.path] });
    await writeFile(baselinePath, committed);
    const proposal = await f.service.execute(work.runId, (await f.service.inspect(work.runId)).snapshot, randomUUID(), { type: 'revision', value: { title: 'New draft', status: 'draft', scope: {}, references: [], extensions: {}, tags: [], body: 'New text', baselineId: 'baseline_main', select: true } });
    if (!proposal.proposalId || !proposal.entityId) throw new Error('Expected a proposed draft');
    const preview = await f.integrations.prepare(work.runId, randomUUID(), [proposal.proposalId]);
    await f.integrations.apply(preview.id, preview.token);
    const selected = (await loadProject(f.root)).baselines.get('baseline_main')?.value.selected;
    expect(selected).toMatchObject({ ...baseline.value.selected, [proposal.entityId]: proposal.revisionId });
  }, 90_000);
});
