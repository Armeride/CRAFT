import schema from '../../schema/extensions/state_model/v1/schema.json' with { type: 'json' };
import paths from '../../schema/extensions/state_model/v1/reference-paths.json' with { type: 'json' };
export const stateSchema = schema;
export const stateSchemaId = schema.$id;
export const stateReferencePaths: readonly string[] = paths;
export const stateKinds = ['state_model.definition', 'state_model.transition', 'state_model.occurrence', 'state_model.scenario'] as const;
export const statePolicy = { version: 'state-model-1', conditionValues: ['true', 'false', 'unknown'], comparison: 'canonical-equality-numeric-order-membership-1', references: 'source-local-link-targets-1', missingValues: 'unknown-no-defaults-1', repeat: 'once-or-bounded-entry-1', legacyAdapter: 'narrative-initial-source-1', maxNodes: 128, maxEffects: 128, maxChainSteps: 256, maxOccurrences: 1024 } as const;
export const stateSupport = [
  { namespace: 'state_model', version: 1, read: 'typed', candidateValidation: true, fileApply: 'shared-writer', automaticMigration: false, evaluator: true },
  { namespace: 'narrative', version: 1, read: 'legacy-initial-and-event-adapter', candidateValidation: 'unchanged-v1', fileApply: 'unchanged-v1', automaticMigration: false, evaluator: true },
  { namespace: 'state_model', version: 'future', read: 'core-only-incomplete', candidateValidation: false, fileApply: false, automaticMigration: false, evaluator: false },
] as const;
