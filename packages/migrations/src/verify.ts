import { canonicalJson } from '../../domain/src/canonical.js';
import type { Diagnostic } from '../../domain/src/model.js';
import { dependencyManifestDigest, semanticDigest } from '../../project-fs/src/changes.js';
import { hash } from '../../project-fs/src/files.js';
import type { ContextManifest, Review } from '../../schema/src/generated.js';
import type { MigrationReport, MigrationSnapshot, SemanticMapping, SourceMapping } from './types.js';

export function sourceMappings(before: MigrationSnapshot, after: MigrationSnapshot): SourceMapping[] {
  return [...new Set([...before.files.keys(), ...after.files.keys()])].sort().flatMap(path => {
    const a = before.files.get(path)?.digest ?? null;
    const b = after.files.get(path)?.digest ?? null;
    return a === b ? [] : [{ path, before: a, after: b }];
  });
}
export function verifyMigration(before: MigrationSnapshot, after: MigrationSnapshot): MigrationReport {
  const diagnostics: Diagnostic[] = [];
  const semanticMappings: SemanticMapping[] = [];
  const problem = (code: string, message: string, path: string): void => { diagnostics.push({ code, message, path, pointer: '', severity: 'error' }); };
  if (before.registryId !== after.registryId) problem('MIGRATION_REGISTRY_MISMATCH', 'Registry scope changed', 'project.yaml');
  if (before.semanticModelVersion !== after.semanticModelVersion) problem('REVIEW_REVALIDATION_REQUIRED', 'Semantic models are not proven equivalent', 'project.yaml');
  if (canonicalJson(before.normalized.project) !== canonicalJson(after.normalized.project)) problem('MIGRATION_MEANING_CHANGED', 'Normalized project metadata changed', 'project.yaml');
  if (canonicalJson([...before.normalized.entities.keys()].sort()) !== canonicalJson([...after.normalized.entities.keys()].sort())) problem('MIGRATION_IDENTITY_CHANGED', 'Entity IDs were added or lost', 'project.yaml');
  for (const [id, entity] of before.normalized.entities) {
    const result = after.normalized.entities.get(id);
    if (!result || result.value.kind !== entity.value.kind || canonicalJson([...entity.revisions.keys()].sort()) !== canonicalJson([...result.revisions.keys()].sort())) {
      problem('MIGRATION_IDENTITY_CHANGED', 'Kind/revision identities were added, changed or lost', entity.path);
      continue;
    }
    for (const [revisionId, revision] of entity.revisions) {
      const mapping = {
        entity_id: id,
        revision_id: revisionId,
        before_semantic_digest: semanticDigest(before.normalized, id, revisionId),
        after_semantic_digest: semanticDigest(after.normalized, id, revisionId),
        before_dependency_digest: dependencyManifestDigest(before.normalized, id, revisionId),
        after_dependency_digest: dependencyManifestDigest(after.normalized, id, revisionId),
      };
      semanticMappings.push(mapping);
      if (mapping.before_semantic_digest !== mapping.after_semantic_digest || mapping.before_dependency_digest !== mapping.after_dependency_digest) problem('MIGRATION_MEANING_CHANGED', 'Revision/dependency semantics changed; content edits require new revisions', revision.path);
    }
  }
  const revisionPath = /^entities\/[^/]+\/revisions\/[^/]+\/meta\.yaml$/;
  for (const [path, value] of before.normalized.documents) {
    if (path === 'project.yaml' || path === 'schemas/lock.json' || revisionPath.test(path)) continue;
    const result = after.normalized.documents.get(path);
    if (result === undefined || canonicalJson(value) !== canonicalJson(result)) problem('MIGRATION_HISTORICAL_RECORD_CHANGED', 'Existing task/checkpoint/baseline/sequence/record meaning changed', path);
    if (path.startsWith('reviews/') && before.files.get(path)?.digest !== after.files.get(path)?.digest) problem('MIGRATION_REVIEW_REWRITTEN', 'Existing review bytes must be preserved; add an attestation instead', path);
  }
  const reviewMappings = [...before.normalized.documents].filter(([path]) => path.startsWith('reviews/')).map(([path, value]) => {
    const review = value as Review;
    const mapping = semanticMappings.find(item => item.entity_id === review.subject.entity_id && item.revision_id === review.subject.revision_id);
    const extensionVersionsStable = Object.entries(before.versions).filter(([key]) => key !== 'core').every(([key, version]) => after.versions[key] === version);
    const valid = extensionVersionsStable && before.semanticModelVersion === after.semanticModelVersion && review.semantic_model_version === before.semanticModelVersion && mapping !== undefined && mapping.before_semantic_digest === review.subject_semantic_digest && mapping.before_dependency_digest === review.dependency_manifest_digest && mapping.before_semantic_digest === mapping.after_semantic_digest && mapping.before_dependency_digest === mapping.after_dependency_digest && before.files.get(path)?.digest === after.files.get(path)?.digest;
    return { path, status: valid ? 'semantic_continuity_verified' as const : 'revalidation_required' as const, reason: valid ? 'Existing semantic model, subject and dependency inputs are unchanged; this does not grant integration approval' : 'Historical evidence does not prove equivalent review inputs' };
  });
  const contextMappings = [...before.normalized.documents].filter(([, value]) => !!value && typeof value === 'object' && 'builder_version' in value).flatMap(([path, value]) => {
    const context = value as ContextManifest;
    return context.inputs.map((input, index) => {
      const mapping = semanticMappings.find(item => item.entity_id === input.target.entity_id && item.revision_id === input.target.revision_id);
      const valid = Object.entries(before.versions).filter(([key]) => key !== 'core').every(([key, version]) => after.versions[key] === version) && before.semanticModelVersion === after.semanticModelVersion && mapping?.before_semantic_digest === mapping?.after_semantic_digest && mapping !== undefined && before.files.get(input.source_path)?.digest === input.source_digest && after.files.has(input.source_path);
      return { path, index, status: valid ? 'semantic_continuity_verified' as const : 'revalidation_required' as const, before_source_digest: input.source_digest, after_source_digest: after.files.get(input.source_path)?.digest ?? null };
    });
  });
  const mappings = sourceMappings(before, after);
  return {
    beforeSemanticModelVersion: before.semanticModelVersion,
    afterSemanticModelVersion: after.semanticModelVersion,
    schemaValid: true,
    referencesValid: !after.normalized.diagnostics.some(diagnostic => diagnostic.severity === 'error'),
    semanticChecksPassed: diagnostics.length === 0,
    sourceMappings: mappings,
    semanticMappings,
    reviewMappings,
    contextMappings,
    payloadDiffDigest: hash(canonicalJson(mappings)),
    diagnostics,
  };
}
