import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson } from '../../domain/src/canonical.js';
import { ValidationFailure } from '../../domain/src/model.js';
import type { ProjectSnapshot, SourceFile } from '../../domain/src/model.js';
import type { Task, Proposal } from '../../schema/src/generated.js';
import { hash, fileFailure, fingerprint, newId, captureFiles } from '../../project-fs/src/files.js';
import { objectFile, rawObject } from '../../project-fs/src/content.js';
import { loadCommittedProject, readCommittedFiles } from '../../project-fs/src/git-baseline.js';
import { parseProject } from '../../project-fs/src/project.js';
import { prepareChanges } from '../../project-fs/src/changes.js';
import { applyTransaction } from '../../project-fs/src/writer.js';
import { atomicText } from '../../workspace-runtime/src/state.js';
import { parseYaml } from '../../project-fs/src/yaml.js';
import { gitText, runGit } from '../../git-workspace/src/git.js';
import { withKernelLock, withMetadataLock, withWorktreeLock } from '../../git-workspace/src/locks.js';
import { createOwnedWorkspace, preserveWorkspace } from '../../git-workspace/src/branches.js';
import { assertOwnedPath, assertSourceUnchanged, repositoryGuard } from '../../git-workspace/src/worktree.js';
import type { RepositoryGuard } from '../../git-workspace/src/worktree.js';
import { markSourceChanged } from '../../git-workspace/src/generation.js';
import { normalizeMergeInputs } from '../../migrations/src/normalize-merge.js';
import { createProductionRegistry, inspectVersions } from '../../migrations/src/registry.js';
import { integrationChanges } from './integration-changes.js';
import { analysisOf } from './manual.js';
import { getRegistration } from './projects.js';
import { assertIntegrationReady, readIntegrationGuard, writeIntegrationGuard } from './integration-state.js';
import { TaskService } from './service.js';

import type { IntegrationRecord } from './manual-contracts.js';
export type { IntegrationRecord } from './manual-contracts.js';

const mergeConflicts = new Set(['BASELINE_DEPENDENCY_MISMATCH', 'SCOPE_MISMATCH', 'BLOCKING_DEPENDENCY_CYCLE']);
const mergeWarnings = new Set(['NEW_REVISION', 'NEW_APPROVED_REVISION', 'DIVERGENT_REVISIONS']);
const diagnosticIdentity = ({ code, path, pointer, params }: ReturnType<typeof analysisOf>['diagnostics'][number]) => canonicalJson([code, path, pointer, params]);
const schemaIdentity = (snapshot: ProjectSnapshot) => canonicalJson([snapshot.project.extensions, snapshot.documents.get('schemas/lock.json')]);
async function reviewDiff(root: string, target: string, candidate: string, format: IntegrationRecord['diffFormat']) {
  const binary = format === 'binary-summary' ? '--full-index' : '--binary';
  return (await runGit(root, ['diff', '--no-ext-diff', '--no-textconv', binary, target, candidate, '--'])).stdout.toString('utf8');
}

async function comparisonInputs(basis: ReadonlyMap<string, SourceFile>, target: ReadonlyMap<string, SourceFile>, result: ReadonlyMap<string, SourceFile>) {
  const versions = canonicalJson(inspectVersions(target));
  if (versions === canonicalJson(inspectVersions(basis)) && versions === canonicalJson(inspectVersions(result))) {
    return { basis: parseProject(basis), target: parseProject(target), result: parseProject(result) };
  }
  const normalized = await normalizeMergeInputs(createProductionRegistry(), { basis, target, result });
  const targetSnapshot = normalized.target.normalized;
  if (targetSnapshot.fingerprint !== fingerprint(target)) throw fileFailure('MIGRATION_MERGE_UNSUPPORTED', 'The target schema has no interactive writer', 'project.yaml');
  return {
    basis: normalized.basis.snapshot.normalized, target: targetSnapshot, result: normalized.result.snapshot.normalized,
    normalization: {
      targetVersions: normalized.target.versions,
      basis: { steps: normalized.basis.steps, mappingDigest: normalized.basis.report.payloadDiffDigest },
      result: { steps: normalized.result.steps, mappingDigest: normalized.result.report.payloadDiffDigest },
    },
  };
}

export class IntegrationService {
  readonly tasks: TaskService;
  constructor(readonly appData: string) { this.tasks = new TaskService(appData); }
  private path(id: string) { if (!/^op_[a-f0-9-]{36}$/.test(id)) throw fileFailure('REQUEST_INVALID', 'Invalid integration identity', 'project.yaml'); return join(this.appData, 'manual-integrations', id + '.json'); }
  private async save(record: IntegrationRecord) { await atomicText(this.appData, this.path(record.id), JSON.stringify(record, null, 2)); }
  async read(id: string): Promise<IntegrationRecord> { const path = this.path(id); await assertOwnedPath(this.appData, path); const value = parseYaml(await readFile(path, 'utf8'), path).value as unknown as IntegrationRecord; if (value.version !== 1 || value.id !== id || !['prepared', 'applying', 'applied', 'cancelled'].includes(value.state) || !/^[a-f0-9]{64}$/.test(value.token)) throw fileFailure('INTEGRATION_INVALID', 'Invalid integration record', 'project.yaml'); return value; }
  async prepare(runId: string, requestId: string, proposalIds: string[]): Promise<IntegrationRecord> {
    await this.tasks.assertExecutionIdle(runId);
    if (!/^[a-f0-9-]{36}$/.test(requestId) || !proposalIds.length || new Set(proposalIds).size !== proposalIds.length) throw fileFailure('REQUEST_INVALID', 'Select preserved proposals with a request UUID', 'project.yaml');
    const id = 'op_' + requestId, requestDigest = hash(canonicalJson({ runId, proposalIds: [...proposalIds].sort() }));
    return withKernelLock(this.path(id) + '.lock', `integration:${id}`, async () => {
      try { const previous = await this.read(id); if (previous.requestDigest !== requestDigest) throw fileFailure('REQUEST_ID_REUSED', 'Integration request was reused', 'project.yaml'); return previous; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const { run, registration } = await this.tasks.run(runId);
      const sourceCommit = run.headCommit;
      if (!sourceCommit) throw fileFailure('CHECKPOINT_REQUIRED', 'Preserve working edits before integration review', 'project.yaml');
      if (await gitText(run.path, ['rev-parse', 'HEAD']) !== sourceCommit) throw fileFailure('BASE_CHANGED', 'Task branch moved after the preserved checkpoint', 'project.yaml');
      const source = await this.tasks.project(runId), committed = await loadCommittedProject(run.path, sourceCommit);
      if (source.fingerprint !== committed.fingerprint) throw fileFailure('CHECKPOINT_REQUIRED', 'Preserve working edits before integration review', 'project.yaml');
      const taskPath = `tasks/${run.taskId}/task.yaml`, task = rawObject<Task>(source.files, taskPath), proposals = [...source.documents].filter(([path]) => path.startsWith(`tasks/${task.id}/proposals/`)).map(([, value]) => value as Proposal).filter(value => !task.consumed_proposals.includes(value.id));
      if (canonicalJson(proposals.map(value => value.id).sort()) !== canonicalJson([...proposalIds].sort())) throw fileFailure('PROPOSAL_SET_CHANGED', 'Review the complete pending proposal set', taskPath);
      if (proposals.some(proposal => proposal.task_id !== task.id || proposal.base_commit !== task.base.commit || proposal.expected_baseline_fingerprint !== task.base.baseline_fingerprint)) throw fileFailure('PROPOSAL_BASE_MISMATCH', 'Proposal inputs do not match the preserved task basis', taskPath);
      const targetRef = run.targetRef.startsWith('refs/heads/') ? run.targetRef : 'refs/heads/' + run.targetRef;
      await runGit(registration.root, ['check-ref-format', targetRef]);
      if (await gitText(registration.root, ['symbolic-ref', 'HEAD']) !== targetRef) throw fileFailure('TARGET_NOT_CHECKED_OUT', 'Open the selected target branch before integrating', 'project.yaml');
      await assertIntegrationReady(this.appData, run.registrationId);
      const target = await repositoryGuard(registration.root);
      const [mergeBase, ...otherBases] = (await gitText(registration.root, ['merge-base', '--all', target.commit, sourceCommit])).split('\n');
      if (!mergeBase || otherBases.length) throw fileFailure('INTEGRATION_CONFLICT', 'A unique common ancestor is required', 'project.yaml');
      await runGit(registration.root, ['merge-base', '--is-ancestor', task.base.commit, sourceCommit]);
      const [basisFiles, targetFiles] = await Promise.all([readCommittedFiles(registration.root, mergeBase), readCommittedFiles(registration.root, target.commit)]);
      const inputs = await comparisonInputs(basisFiles, targetFiles, committed.files);
      const { basis, target: targetSnapshot, result } = inputs;
      const targetSchema = schemaIdentity(targetSnapshot);
      if (targetSchema !== schemaIdentity(basis) || targetSchema !== schemaIdentity(result)) throw fileFailure('MIGRATION_MERGE_UNSUPPORTED', 'Comparison inputs have different schema declarations or pins', 'schemas/lock.json');
      if (target.fingerprint !== targetSnapshot.fingerprint) throw fileFailure('WORKTREE_DIRTY', 'Canonical working files differ from the committed target', 'project.yaml');
      const targetTask = targetSnapshot.files.has(taskPath) ? rawObject<Task>(targetSnapshot.files, taskPath) : null;
      if (targetTask?.consumed_proposals.some(value => proposalIds.includes(value))) throw fileFailure('PROPOSAL_ALREADY_CONSUMED', 'Proposal was already integrated', taskPath);
      const taskBaseIsCommon = task.base.commit === mergeBase || await gitText(registration.root, ['merge-base', mergeBase, task.base.commit]) === task.base.commit;
      const taskBasis = taskBaseIsCommon ? basis : (await comparisonInputs(await readCommittedFiles(registration.root, task.base.commit), targetFiles, committed.files)).basis;
      const files = integrationChanges(basis, targetSnapshot, result, run.taskId, taskBasis);
      const consumed: Task = { ...task, status: 'integrated', consumed_proposals: [...new Set([...task.consumed_proposals, ...proposalIds])] };
      const taskIndex = files.findIndex(file => file.path === taskPath); if (taskIndex >= 0) files.splice(taskIndex, 1); files.push(objectFile(taskPath, consumed));
      const reviewId = newId('review');
      files.push(objectFile(`tasks/${run.taskId}/working/ui-integration-${id}.json`, { version: 1, review_id: reviewId, source_commit: sourceCommit, target_commit: target.commit, merge_base_commit: mergeBase, normalization: inputs.normalization ?? null, proposals: proposalIds, role: 'integration-candidate' }));
      const changes = files.map(file => ({ path: file.path, expectedDigest: targetSnapshot.files.get(file.path)?.digest ?? null, content: file.text ?? Buffer.from(file.contentBase64, 'base64') })), candidate = prepareChanges(targetSnapshot, { expectedSnapshot: targetSnapshot.fingerprint, changes });
      const advisories: NonNullable<IntegrationRecord['advisories']> = [];
      for (const baseline of candidate.baselines.values()) {
        const baselineId = baseline.value.id;
        const analysis = analysisOf(candidate, baselineId);
        const targetDiagnostics = new Set(targetSnapshot.baselines.has(baselineId) ? analysisOf(targetSnapshot, baselineId).diagnostics.map(diagnosticIdentity) : []);
        const incomingDiagnostics = new Set(result.baselines.has(baselineId) ? analysisOf(result, baselineId).diagnostics.map(diagnosticIdentity) : []);
        const conflicts = analysis.diagnostics.filter(issue => mergeConflicts.has(issue.code) && !targetDiagnostics.has(diagnosticIdentity(issue)) && !incomingDiagnostics.has(diagnosticIdentity(issue)));
        if (conflicts.length) throw new ValidationFailure([...fileFailure('INTEGRATION_SEMANTIC_CONFLICT', 'Combined baseline choices introduce a dependency or scope conflict', baseline.path).diagnostics, ...conflicts]);
        for (const issue of analysis.diagnostics) {
          if (mergeWarnings.has(issue.code) && !targetDiagnostics.has(diagnosticIdentity(issue))) advisories.push({ baselineId, issue });
        }
        if (baseline.value.kind === 'release' && !analysis.releaseEligible) throw fileFailure('APPROVAL_BLOCKED', 'Release baseline has unresolved approval requirements', baseline.path);
        for (const [entityId, revisionId] of Object.entries(baseline.value.selected)) { const changed = targetSnapshot.baselines.get(baseline.value.id)?.value.selected[entityId] !== revisionId, state = analysis.nodes[entityId + '/' + revisionId]; if (changed && state?.directStatus === 'approved' && (state.review !== 'valid' || state.blockers.length)) throw fileFailure('APPROVAL_BLOCKED', 'New approval requires valid user review and resolved dependencies', baseline.path); }
      }
      const path = join(this.appData, 'integrations', id), branch = `workbench/integration/${id}`;
      const workspace = await withMetadataLock(registration.root, () => createOwnedWorkspace(registration.root, this.appData, path, branch, target.commit));
      let candidateCommit = '';
      await withWorktreeLock(path, async lease => { await applyTransaction(path, join(this.appData, 'manual-integrations', id), lease, { expectedSnapshot: targetSnapshot.fingerprint, changes }, { scopeId: id, allowedPrefixes: ['entities/', 'baselines/', 'reviews/', 'assets/craft/', `tasks/${run.taskId}/`] }); candidateCommit = await withMetadataLock(registration.root, () => preserveWorkspace(workspace, target.commit, files.map(file => ({ path: file.path, file })), 'manual: integrate reviewed proposals')); });
      const diffFormat = 'binary-summary';
      const diff = await reviewDiff(registration.root, target.commit, candidateCommit, diffFormat);
      if (Buffer.byteLength(diff) > 1024 * 1024) throw fileFailure('DIFF_REVIEW_LIMIT', 'Review diff exceeds the supported display limit', 'project.yaml');
      await assertSourceUnchanged(target);
      const diffDigest = hash(diff), token = hash(canonicalJson({ source: run.headCommit, target: target.commit, diffDigest, reviewId, candidate: candidateCommit, nonce: newId('approval') }));
      const record: IntegrationRecord = { version: 1, id, registrationId: run.registrationId, runId, requestId, requestDigest, state: 'prepared', sourceCommit, sourceSnapshot: source.fingerprint, targetRef, target, candidateCommit, candidateSnapshot: candidate.fingerprint, candidateFilesFingerprint: fingerprint(await readCommittedFiles(path, candidateCommit, false)), reviewId, diffFormat, diffDigest, token, proposalIds, diff, advisories };
      await this.save(record); return record;
    });
  }
  async pending(registrationId: string): Promise<IntegrationRecord | null> {
    const guard = await readIntegrationGuard(this.appData, registrationId); if (guard?.state !== 'applying') return null; const record = await this.read(guard.operationId); if (record.registrationId !== registrationId) throw fileFailure('CONTEXT_FORBIDDEN', 'Integration belongs to another registration', 'project.yaml'); return record;
  }
  private async release(record: IntegrationRecord) {
    if ((await readIntegrationGuard(this.appData, record.registrationId))?.operationId === record.id) await writeIntegrationGuard(this.appData, record.registrationId, { version: 1, operationId: record.id, runId: record.runId, state: 'ready' });
  }
  async apply(id: string, token: string, onPhase?: (phase: 'target_staged' | 'target_updated') => Promise<void>): Promise<IntegrationRecord> {
    return withKernelLock(this.path(id) + '.lock', `integration:${id}`, async () => {
      const record = await this.read(id); if (record.token !== token) throw fileFailure('REVIEW_TOKEN_INVALID', 'Review token does not match this diff', 'project.yaml');
      const registration = await getRegistration(this.appData, record.registrationId);
      if (record.target.root !== registration.root || record.target.commonDir !== registration.commonDir) throw fileFailure('CONTEXT_FORBIDDEN', 'Integration target identity changed', 'project.yaml');
      if (record.state === 'applied' || record.state === 'cancelled') return withWorktreeLock(registration.root, () => withMetadataLock(registration.root, async () => { if (record.state === 'applied') await runGit(registration.root, ['merge-base', '--is-ancestor', record.candidateCommit, record.targetRef]); await this.release(record); return record; }));
      const { run } = await this.tasks.run(record.runId);
      await this.tasks.assertExecutionIdle(run.runId);
      return withWorktreeLock(run.path, () => withWorktreeLock(registration.root, lease => withMetadataLock(registration.root, async () => {
        if (await gitText(registration.root, ['symbolic-ref', 'HEAD']) !== record.targetRef) throw fileFailure('BASE_CHANGED', 'Target branch changed after review', 'project.yaml');
        const currentHead = await gitText(registration.root, ['rev-parse', record.targetRef]), currentFiles = fingerprint(await captureFiles(registration.root));
        if (record.state === 'applying' && currentHead === record.candidateCommit) { await markSourceChanged(registration.root, lease); record.state = 'applied'; await this.save(record); await this.release(record); return record; }
        if (currentHead !== record.target.commit) throw fileFailure('BASE_CHANGED', 'Target HEAD changed after review', 'project.yaml');
        const active = await this.tasks.run(record.runId);
        if (active.run.registrationId !== record.registrationId || active.run.headCommit !== record.sourceCommit || await gitText(run.path, ['rev-parse', 'HEAD']) !== record.sourceCommit || (await this.tasks.project(run.runId)).fingerprint !== record.sourceSnapshot) throw fileFailure('BASE_CHANGED', 'Task result changed after review', 'project.yaml');
        const candidateRoot = join(this.appData, 'integrations', id); await repositoryGuard(candidateRoot);
        if (await gitText(candidateRoot, ['rev-parse', 'HEAD']) !== record.candidateCommit || fingerprint(await captureFiles(candidateRoot, false)) !== record.candidateFilesFingerprint) throw fileFailure('BASE_CHANGED', 'Integration candidate changed after review', 'project.yaml');
        const diff = await reviewDiff(registration.root, record.target.commit, record.candidateCommit, record.diffFormat);
        if (hash(diff) !== record.diffDigest) throw fileFailure('BASE_CHANGED', 'Reviewed diff changed', 'project.yaml');
        const candidateTree = await gitText(registration.root, ['rev-parse', record.candidateCommit + '^{tree}']), stagedCandidate = record.state === 'applying' && currentFiles === record.candidateSnapshot && await gitText(registration.root, ['write-tree']) === candidateTree;
        if (!stagedCandidate) {
          await assertSourceUnchanged(record.target);
          // read-tree also requires up-to-date index stat data for a byte-identical restored file.
          await runGit(registration.root, ['update-index', '--refresh']);
          const refreshed = await repositoryGuard(registration.root);
          if (refreshed.commit !== record.target.commit || refreshed.fingerprint !== record.target.fingerprint) throw fileFailure('BASE_CHANGED', 'Target changed while refreshing its Git index', 'project.yaml');
          record.target = refreshed;
        }
        record.state = 'applying'; await this.save(record); await writeIntegrationGuard(this.appData, record.registrationId, { version: 1, operationId: id, runId: record.runId, state: 'applying' });
        if (!stagedCandidate) await runGit(registration.root, ['read-tree', '-m', '-u', record.target.commit, record.candidateCommit]);
        if (fingerprint(await captureFiles(registration.root)) !== record.candidateSnapshot) throw fileFailure('INTEGRATION_RECOVERY_REQUIRED', 'External changes require explicit integration recovery', 'project.yaml');
        await onPhase?.('target_staged');
        if ((await this.tasks.project(run.runId)).fingerprint !== record.sourceSnapshot || (await this.tasks.run(run.runId)).run.headCommit !== record.sourceCommit) throw fileFailure('BASE_CHANGED', 'Task changed during integration', 'project.yaml');
        const transaction = `start\nverify refs/heads/${run.branch} ${record.sourceCommit}\nupdate ${record.targetRef} ${record.candidateCommit} ${record.target.commit}\nprepare\ncommit\n`;
        await runGit(registration.root, ['update-ref', '--stdin'], Buffer.from(transaction));
        await onPhase?.('target_updated');
        await markSourceChanged(registration.root, lease); record.state = 'applied'; await this.save(record); await this.release(record); return record;
      })));
    });
  }
  async restore(id: string, token: string): Promise<IntegrationRecord> {
    return withKernelLock(this.path(id) + '.lock', `integration:${id}`, async () => {
      const record = await this.read(id); if (record.token !== token || record.state !== 'applying') throw fileFailure('REVIEW_TOKEN_INVALID', 'Only an interrupted approved integration can be restored', 'project.yaml');
      const registration = await getRegistration(this.appData, record.registrationId);
      return withWorktreeLock(registration.root, lease => withMetadataLock(registration.root, async () => {
        if (record.target.root !== registration.root || record.target.commonDir !== registration.commonDir) throw fileFailure('CONTEXT_FORBIDDEN', 'Integration target identity changed', 'project.yaml');
        if (await gitText(registration.root, ['symbolic-ref', 'HEAD']) !== record.targetRef || await gitText(registration.root, ['rev-parse', 'HEAD']) !== record.target.commit) throw fileFailure('BASE_CHANGED', 'A committed integration cannot be silently undone', 'project.yaml');
        const current = fingerprint(await captureFiles(registration.root)), tree = await gitText(registration.root, ['write-tree']), candidateTree = await gitText(registration.root, ['rev-parse', record.candidateCommit + '^{tree}']), originalTree = await gitText(registration.root, ['rev-parse', record.target.commit + '^{tree}']);
        if (current === record.candidateSnapshot && tree === candidateTree) await runGit(registration.root, ['read-tree', '-m', '-u', record.candidateCommit, record.target.commit]);
        else if (current !== record.target.fingerprint || tree !== originalTree) throw fileFailure('INTEGRATION_RECOVERY_REQUIRED', 'External edits are preserved; inspect before recovery', 'project.yaml');
        if (fingerprint(await captureFiles(registration.root)) !== record.target.fingerprint) throw fileFailure('INTEGRATION_RECOVERY_REQUIRED', 'Restored bytes require inspection', 'project.yaml');
        await markSourceChanged(registration.root, lease); record.state = 'cancelled'; await this.save(record); await this.release(record); return record;
      }));
    });
  }
}
