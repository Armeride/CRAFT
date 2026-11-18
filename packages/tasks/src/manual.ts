import { canonicalJson } from '../../domain/src/canonical.js';
import { analyzeProject } from '../../domain/src/analysis.js';
import type { ProjectSnapshot, SourceFile } from '../../domain/src/model.js';
import type { Revision, Baseline, Proposal, Task, Review, Checkpoint } from '../../schema/src/generated.js';
import { semanticDigest, dependencyManifestDigest, prepareChanges } from '../../project-fs/src/changes.js';
import { objectFile, textFile, rawObject } from '../../project-fs/src/content.js';
import { hash, newId, fileFailure } from '../../project-fs/src/files.js';
import { getRegistration } from './projects.js';
import { loadCommittedProject } from '../../project-fs/src/git-baseline.js';
import { TaskService } from './service.js';

import type { ManualCommand, ManualResult, ManualInspection } from './manual-contracts.js';
export type { ManualCommand, ManualResult, ManualRevision, ManualInspection } from './manual-contracts.js';
export const analysisOf = (snapshot: ProjectSnapshot, baselineId: string) => analyzeProject(snapshot, baselineId, { semantic: (entity, revision) => semanticDigest(snapshot, entity, revision), dependency: (entity, revision) => dependencyManifestDigest(snapshot, entity, revision) });
function proposalFile(snapshot: ProjectSnapshot, task: Task, changes: Proposal['changes'], inputs: Proposal['input_revisions']) {
  const proposal: Proposal = { id: newId('proposal'), task_id: task.id, base_commit: task.base.commit, expected_baseline_fingerprint: task.base.baseline_fingerprint, input_revisions: inputs, changes };
  return { proposal, file: objectFile(`tasks/${task.id}/proposals/${proposal.id}.yaml`, proposal) };
}
function commandFiles(snapshot: ProjectSnapshot, task: Task, command: ManualCommand, agentId?: string): { files: SourceFile[]; result: ManualResult } {
  const files: SourceFile[] = [];
  if (command.type === 'revision') {
    const input = command.value, entityId = input.entityId ?? newId('ent'), revisionId = newId('rev'), entity = snapshot.entities.get(entityId), parent = input.parentRevision ? entity?.revisions.get(input.parentRevision) : undefined;
    if (input.entityId && (!entity || !parent?.writable)) throw fileFailure('REVISION_NOT_FOUND', 'Editable source revision is required', 'project.yaml');
    if (!snapshot.baselines.has(input.baselineId)) throw fileFailure('BASELINE_NOT_FOUND', 'Baseline is required', 'project.yaml');
    const meta: Revision = { ...(parent?.meta ?? {}), entity_id: entityId, revision_id: revisionId, parents: input.parentRevision ? [input.parentRevision] : [], title: input.title, status: input.status, scope: input.scope, references: input.references, extensions: input.extensions, tags: input.tags, body_path: 'content.md', created_at: new Date().toISOString(), created_by: { type: agentId ? 'agent' : 'user', id: agentId ?? 'local-user', task_id: task.id } };
    if (agentId) files.push(textFile(`tasks/${task.id}/working/ui-draft.md`, input.body));
    if (!entity) files.push(objectFile(`entities/${entityId}/entity.yaml`, { id: entityId, kind: input.kind ?? 'document' }));
    files.push(objectFile(`entities/${entityId}/revisions/${revisionId}/meta.yaml`, meta), textFile(`entities/${entityId}/revisions/${revisionId}/content.md`, input.body));
    const changes: Proposal['changes'] = [{ action: 'add_revision', entity_id: entityId, revision_id: revisionId }];
    if (input.select) { const baseline = structuredClone(snapshot.baselines.get(input.baselineId)!.value); baseline.selected[entityId] = revisionId; files.push(objectFile(`baselines/${baseline.id}.yaml`, baseline)); changes.push({ action: 'select_revision', baseline_id: baseline.id, entity_id: entityId, revision_id: revisionId }); }
    const proposal = proposalFile(snapshot, task, changes, input.parentRevision ? [{ entity_id: entityId, revision_id: input.parentRevision }] : []); files.push(proposal.file);
    return { files, result: { entityId, revisionId, proposalId: proposal.proposal.id, baselineId: input.baselineId } };
  }
  if (command.type === 'review') {
    const record = snapshot.entities.get(command.entityId)?.revisions.get(command.revisionId);
    if (!record?.writable) throw fileFailure('REVISION_NOT_FOUND', 'Review subject is unavailable', 'project.yaml');
    const review: Review = { id: newId('review'), subject: { entity_id: command.entityId, revision_id: command.revisionId }, semantic_model_version: 1, subject_semantic_digest: semanticDigest(snapshot, command.entityId, command.revisionId), dependency_manifest_digest: dependencyManifestDigest(snapshot, command.entityId, command.revisionId), scope: record.meta.scope, outcome: command.outcome, reviewer: { type: 'user', id: 'local-user' }, created_at: new Date().toISOString() };
    return { files: [objectFile(`reviews/${review.id}.yaml`, review)], result: { reviewId: review.id } };
  }
  if (command.type === 'baseline') {
    if (snapshot.baselines.has(command.value.id)) throw fileFailure('BASELINE_EXISTS', 'Create a new baseline identity', 'project.yaml');
    const changes: Proposal['changes'] = Object.entries(command.value.selected).map(([entity_id, revision_id]) => ({ action: 'select_revision', baseline_id: command.value.id, entity_id, revision_id }));
    if (changes.length) { const proposal = proposalFile(snapshot, task, changes, Object.entries(command.value.selected).map(([entity_id, revision_id]) => ({ entity_id, revision_id }))); return { files: [objectFile(`baselines/${command.value.id}.yaml`, command.value), proposal.file], result: { baselineId: command.value.id, proposalId: proposal.proposal.id } }; }
    return { files: [objectFile(`baselines/${command.value.id}.yaml`, command.value)], result: { baselineId: command.value.id } };
  }
  const baseline = structuredClone(snapshot.baselines.get(command.baselineId)?.value);
  if (!baseline) throw fileFailure('BASELINE_NOT_FOUND', 'Baseline is required', 'project.yaml');
  baseline.selected[command.entityId] = command.revisionId;
  const proposal = proposalFile(snapshot, task, [{ action: 'select_revision', baseline_id: baseline.id, entity_id: command.entityId, revision_id: command.revisionId }], [{ entity_id: command.entityId, revision_id: command.revisionId }]);
  return { files: [objectFile(`baselines/${baseline.id}.yaml`, baseline), proposal.file], result: { baselineId: baseline.id, proposalId: proposal.proposal.id } };
}
export class ManualService {
  readonly tasks: TaskService;
  constructor(readonly appData: string) { this.tasks = new TaskService(appData); }
  private async integrated(registrationId: string, taskId: string, snapshot: ProjectSnapshot): Promise<boolean> {
    const proposals = [...snapshot.documents].filter(([path]) => path.startsWith(`tasks/${taskId}/proposals/`)).map(([, value]) => value as Proposal);
    if (!proposals.length) return false;
    const registration = await getRegistration(this.appData, registrationId), target = await loadCommittedProject(registration.root, 'HEAD'), path = `tasks/${taskId}/task.yaml`;
    if (!target.files.has(path)) return false; const task = rawObject<Task>(target.files, path); return proposals.every(proposal => task.consumed_proposals.includes(proposal.id));
  }
  async inspect(runId: string, baselineId?: string) {
    const { run } = await this.tasks.run(runId), snapshot = await this.tasks.project(runId), task = rawObject<Task>(snapshot.files, `tasks/${run.taskId}/task.yaml`), baseline = baselineId ?? task.base.baseline_id;
    const editor = snapshot.files.get(`tasks/${run.taskId}/working/ui-editor.json`);
    return { integrated: await this.integrated(run.registrationId, run.taskId, snapshot), editor: { text: editor?.text ?? '', digest: editor?.digest ?? null }, run, snapshot: snapshot.fingerprint, task, baselines: [...snapshot.baselines.values()].map(value => value.value), proposals: [...snapshot.documents].filter(([path]) => path.startsWith(`tasks/${task.id}/proposals/`)).map(([, value]) => value as Proposal), reviews: [...snapshot.documents].filter(([path]) => path.startsWith('reviews/')).map(([, value]) => value as Review), analysis: analysisOf(snapshot, baseline) };
  }
  async executeAgent(runId: string, expectedSnapshot: string, requestId: string, command: ManualCommand, agentId: NonNullable<Checkpoint['provider_hint']>['type']): Promise<ManualResult> {
    if (command.type !== 'revision' || command.value.status !== 'draft' || command.value.select) throw fileFailure('AGENT_WRITE_FORBIDDEN', 'Agent changes must be unselected draft revisions', 'project.yaml');
    return this.execute(runId, expectedSnapshot, requestId, command, agentId);
  }
  async execute(runId: string, expectedSnapshot: string, requestId: string, command: ManualCommand, agentId?: NonNullable<Checkpoint['provider_hint']>['type']): Promise<ManualResult> {
    if (!/^[a-f0-9-]{36}$/.test(requestId)) throw fileFailure('REQUEST_INVALID', 'A request UUID is required', 'project.yaml');
    const digest = hash(canonicalJson(agentId ? { agentId, command } : command));
    return this.tasks.edit(runId, expectedSnapshot, async (snapshot, run) => {
      const path = `tasks/${run.taskId}/working/ui-operation-${requestId}.json`, existing = snapshot.files.get(path);
      if (existing) { const record = rawObject<{ version: number; digest: string; result: ManualResult }>(snapshot.files, path); if (record.version !== 1 || record.digest !== digest) throw fileFailure('REQUEST_ID_REUSED', 'Request identity has different content', path); return { files: [], result: record.result }; }
      if (await this.integrated(run.registrationId, run.taskId, snapshot)) throw fileFailure('TASK_ALREADY_INTEGRATED', 'Start a new task for further changes', 'project.yaml');
      const task = rawObject<Task>(snapshot.files, `tasks/${run.taskId}/task.yaml`), value = commandFiles(snapshot, task, command, agentId);
      prepareChanges(snapshot, { expectedSnapshot: snapshot.fingerprint, changes: value.files.map(file => ({ path: file.path, expectedDigest: snapshot.files.get(file.path)?.digest ?? null, content: file.text! })) });
      return { files: [...value.files, objectFile(path, { version: 1, digest, result: value.result })], result: value.result };
    }, agentId);
  }
}
