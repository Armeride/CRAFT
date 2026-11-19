import { canonicalJson } from '../../domain/src/canonical.js';
import type { ProjectSnapshot, SnapshotTarget } from '../../domain/src/model.js';
import { exactRevision, ValidationFailure } from '../../domain/src/model.js';
import type { JsonObject, JsonValue } from '../../schema/src/generated.js';
import { issue } from '../../domain/src/analysis.js';
import { statePayload, validateStateModel } from '../../state-model/src/model.js';
import { statePolicy } from '../../state-model/src/contracts.js';
import { hash } from './files.js';
import { semanticDigest } from './changes.js';

/** Fixed scenario inputs and provenance for consumers of the separate evaluation query. */
export function stateInputManifest(snapshot: ProjectSnapshot, source: { scopeFingerprint: string; headCommit: string }, baselineId: string, scenario: SnapshotTarget, actor?: string, overrides: Record<string, JsonValue> = {}) {
  const record = exactRevision(snapshot, scenario.entity_id, scenario.revision_id), payload = statePayload(record);
  if (!record.writable || payload?.record_type !== 'scenario' || payload.baseline_id !== baselineId) throw new ValidationFailure([issue('STATE_SCENARIO_MISMATCH', record.path)]);
  if (actor !== undefined && !Object.hasOwn(payload.actors, actor)) throw new ValidationFailure([issue('STATE_ACTOR_MISSING', record.path, '', { actor })]);
  const baseline = snapshot.baselines.get(baselineId); if (!baseline) throw new ValidationFailure([issue('BASELINE_MISSING', record.path)]);
  const inputs = { ...payload.inputs, ...overrides };
  // Validate user-supplied assumptions against the same contract without writing source files.
  const nextPayload = JSON.parse(canonicalJson({ ...payload, inputs })) as JsonObject;
  const replacement = { ...record, meta: { ...record.meta, extensions: { ...record.meta.extensions, state_model: nextPayload } } };
  const entity = snapshot.entities.get(scenario.entity_id)!, revisions = new Map(entity.revisions); revisions.set(scenario.revision_id, replacement);
  const entities = new Map(snapshot.entities); entities.set(scenario.entity_id, { ...entity, revisions });
  const invalid = validateStateModel({ ...snapshot, entities }); if (invalid.length) throw new ValidationFailure(invalid);
  const manifest = { source: { projectId: snapshot.project.project_id, headCommit: source.headCommit, fileFingerprint: snapshot.fingerprint }, baselineId, baselineFingerprint: snapshot.files.get(baseline.path)!.digest, schemaLockDigest: snapshot.files.get('schemas/lock.json')!.digest, policyVersion: statePolicy.version, scenario: { ...scenario, semanticDigest: semanticDigest(snapshot, scenario.entity_id, scenario.revision_id) }, actor: actor ?? null, actors: payload.actors, inputs, occurrences: payload.occurrences, assumptions: payload.assumptions, selectedInputs: Object.entries(baseline.value.selected).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([entity_id, revision_id]) => ({ entity_id, revision_id, semanticDigest: semanticDigest(snapshot, entity_id, revision_id) })) };
  const inputDigest = hash(canonicalJson(manifest));
  return { manifest, inputDigest, scopeCacheKey: hash(canonicalJson({ scopeFingerprint: source.scopeFingerprint, inputDigest })), evaluatorAvailable: true as const };
}
