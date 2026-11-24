import { join } from 'node:path';
import type { Project, Baseline, Revision, SchemaLock } from '../../schema/src/generated.js';
import type { Operation } from '../../workspace-runtime/src/generated.js';
import { writeState } from '../../workspace-runtime/src/state.js';
import { isProjectPath } from '../../domain/src/path.js';
import { captureFiles, fileFailure, fingerprint, isCanonicalPath, newId } from '../../project-fs/src/files.js';
import { objectFile, rawObject, textFile } from '../../project-fs/src/content.js';
import { builtinLock, loadProject, parseProject } from '../../project-fs/src/project.js';
import { readCommittedFiles } from '../../project-fs/src/git-baseline.js';
import { applyTransaction } from '../../project-fs/src/writer.js';
import { repositoryGuard, assertSourceUnchanged, checkedManagedRoot } from '../../git-workspace/src/worktree.js';
import { createOwnedWorkspace, preserveWorkspace } from '../../git-workspace/src/branches.js';
import { gitText } from '../../git-workspace/src/git.js';
import { withMetadataLock, withWorktreeLock } from '../../git-workspace/src/locks.js';
import { getRegistration } from './projects.js';

const namespace = 'craft.import';
export const isImportDocumentPath = (path: string) => isProjectPath(path) && /\.(?:md|txt)$/i.test(path);
const provenanceSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:craft:import-provenance:1', type: 'object', additionalProperties: false,
  required: ['source_path', 'source_commit', 'source_digest', 'body_transform'],
  properties: { source_path: { type: 'string', minLength: 1 }, source_commit: { type: 'string', pattern: '^(?:[a-f0-9]{40}|[a-f0-9]{64})$' }, source_digest: { type: 'string', pattern: '^[a-f0-9]{64}$' }, body_transform: { const: 'literal-markers-lf-v1' } },
};

/** Explicit document import only. Source files, existing revisions and approval state are never rewritten. */
export async function importDocuments(appData: string, registrationId: string, selectedPaths: readonly string[], name = '가져온 프로젝트'): Promise<Operation> {
  const registration = await getRegistration(appData, registrationId);
  if (!['ready', 'import_required'].includes(registration.status)) throw new Error('IMPORT_REQUIRES_COMMITTED_SUPPORTED_REPOSITORY');
  if (!selectedPaths.length || new Set(selectedPaths).size !== selectedPaths.length) throw new Error('IMPORT_SELECTION_REQUIRED');
  await checkedManagedRoot(appData, registration.root);
  return withWorktreeLock(registration.root, async () => {
    const source = await repositoryGuard(registration.root, false);
    const original = await readCommittedFiles(registration.root, source.commit, false);
    for (const path of selectedPaths) if (!isImportDocumentPath(path) || original.get(path)?.text === undefined) throw fileFailure('IMPORT_SOURCE_INVALID', 'Choose a committed UTF-8 Markdown or text document', path);
    const existing = original.has('project.yaml') ? parseProject(new Map([...original].filter(([path]) => isCanonicalPath(path)))) : undefined;
    if (existing && !existing.writable) throw new Error('IMPORT_PROJECT_READ_ONLY');
    const baselineId = existing?.project.default_baseline_id ?? newId('baseline');
    const project: Project = existing ? structuredClone(existing.project) : { project_id: newId('prj'), name, language: 'ko', schema_version: 1, default_baseline_id: baselineId, extensions: {}, policies: { implicit_latest_reference: 'forbidden', missing_reference: 'error', approval_blocks_on_dependency_states: ['draft', 'discussing', 'in_review'] } };
    const lock: SchemaLock = existing ? rawObject<SchemaLock>(existing.files, 'schemas/lock.json') : builtinLock([]);
    const schemaPath = 'schemas/extensions/craft.import/v1/schema.json';
    const schemaFile = objectFile(schemaPath, provenanceSchema);
    if (project.extensions[namespace] && (lock.extensions[namespace]?.schema_id !== provenanceSchema.$id || lock.extensions[namespace]?.digest !== schemaFile.digest)) throw new Error('IMPORT_EXTENSION_CONFLICT');
    project.extensions[namespace] = { required: true, schema_version: 1 };
    lock.extensions[namespace] = { version: 1, schema_id: provenanceSchema.$id, digest: schemaFile.digest, path: schemaPath, reference_paths: [] };
    // A separate working baseline keeps any existing release/canon selection unchanged.
    const importBaseline: Baseline = { id: newId('baseline'), name: '가져온 문서 초안', kind: 'working', scope: {}, closure_policy: 'require_selected_dependencies', selected: { ...(existing?.baselines.get(baselineId)?.value.selected ?? {}) } };
    if (!existing) project.default_baseline_id = importBaseline.id;
    const files = [objectFile('project.yaml', project), objectFile('schemas/lock.json', lock)];
    if (!original.has(schemaPath)) files.push(schemaFile);
    else if (original.get(schemaPath)!.digest !== schemaFile.digest) throw new Error('IMPORT_EXTENSION_CONFLICT');
    for (const path of selectedPaths) {
      const sourceFile = original.get(path)!;
      const entityId = newId('ent'), revisionId = newId('rev');
      const meta: Revision = { entity_id: entityId, revision_id: revisionId, parents: [], title: path, status: 'draft', body_path: 'content.md', scope: {}, references: [], extensions: { [namespace]: { source_path: path, source_commit: source.commit, source_digest: sourceFile.digest, body_transform: 'literal-markers-lf-v1' } }, created_at: new Date().toISOString(), created_by: { type: 'user', id: 'explicit-import' } };
      // Canonical ref/anchor-looking text remains literal; exact original bytes remain at source_path.
      const body = `가져온 원문: ${path}\n\n` + sourceFile.text!.replace(/\r\n?/g, '\n').replaceAll('[[ref:', '&#91;&#91;ref:').replaceAll('<', '&lt;');
      files.push(objectFile(`entities/${entityId}/entity.yaml`, { id: entityId, kind: 'document' }), objectFile(`entities/${entityId}/revisions/${revisionId}/meta.yaml`, meta), textFile(`entities/${entityId}/revisions/${revisionId}/content.md`, body));
      importBaseline.selected[entityId] = revisionId;
    }
    files.push(objectFile(`baselines/${importBaseline.id}.yaml`, importBaseline));
    const id = newId('op');
    const operation: Operation = { protocol: 1, id, kind: 'import', registrationId, path: join(appData, 'imports', id), branch: `workbench/import/${id}`, basisCommit: source.commit, status: 'starting' };
    const stateRoot = join(appData, 'operations', id);
    const save = () => writeState(appData, join(appData, 'operations', id + '.json'), 'Operation', operation);
    await save();
    try {
      const workspace = await withMetadataLock(registration.root, () => createOwnedWorkspace(registration.root, appData, operation.path, operation.branch, source.commit));
      await withWorktreeLock(workspace.path, async lease => {
        const before = await captureFiles(workspace.path, false);
        await applyTransaction(workspace.path, stateRoot, lease, { expectedSnapshot: fingerprint(new Map([...before].filter(([path]) => isCanonicalPath(path)))), changes: files.map(file => ({ path: file.path, expectedDigest: before.get(file.path)?.digest ?? null, content: file.text! })) }, { scopeId: id, allowedPrefixes: ['project.yaml', 'schemas/', 'baselines/', 'entities/'] });
        await loadProject(workspace.path);
        operation.resultCommit = await withMetadataLock(registration.root, () => preserveWorkspace(workspace, source.commit, files.map(file => ({ path: file.path, file })), 'import: preserve original documents and draft provenance'));
        operation.status = 'completed'; await save();
      });
      await assertSourceUnchanged(source);
      return operation;
    } catch (error) { operation.status = 'failed'; operation.error = String(error); await save(); throw error; }
  });
}
