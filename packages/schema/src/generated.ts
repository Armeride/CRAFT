// Generated from core/v1/schema.json. Run npm run schema:types; do not edit.

export type CraftV1Document =
  | Project
  | Entity
  | Revision
  | SnapshotTarget
  | Reference
  | Scope
  | Baseline
  | Review
  | Task
  | Checkpoint
  | Proposal
  | Sequence
  | SkillManifest
  | McpConfiguration
  | SchemaLock
  | MigrationHistory
  | ContextManifest
  | NarrativeCharacter
  | NarrativeScene
  | StateEvent
  | KnowledgeEvent
  | RevealEvent
  | NarrativeFact
  | GameDesign
  | GameObservation;
export type Id = string;
export type JsonValue =
  | (string | number | boolean | null)
  | JsonValue[]
  | {
      [k: string]: JsonValue;
    };
export type ProposalChange =
  | {
      action: 'add_revision';
      entity_id: Id;
      revision_id: Id;
    }
  | {
      action: 'select_revision';
      baseline_id: Id;
      entity_id: Id;
      revision_id: Id;
    };

export interface Project {
  project_id: Id;
  schema_version: 1;
  name: string;
  language: string;
  default_baseline_id: Id;
  extensions: {
    [k: string]: ExtensionDeclaration;
  };
  policies: {
    approval_blocks_on_dependency_states: ('discussing' | 'draft' | 'in_review')[];
    missing_reference: 'error';
    implicit_latest_reference: 'forbidden';
  };
}
export interface ExtensionDeclaration {
  schema_version: number;
  required?: boolean;
}
export interface Entity {
  id: Id;
  kind: string;
}
export interface Revision {
  entity_id: Id;
  revision_id: Id;
  parents: Id[];
  label?: string;
  title: string;
  aliases?: string[];
  status: 'discussing' | 'draft' | 'in_review' | 'approved' | 'deprecated';
  tags?: string[];
  created_at: string;
  created_by: Actor;
  scope: Scope;
  body_path: string;
  references: Reference[];
  extensions: {
    [k: string]: JsonObject;
  };
}
export interface Actor {
  type: 'user' | 'agent' | 'system';
  id: string;
  task_id?: Id;
}
export interface Scope {
  continuity?: string;
  /**
   * @minItems 1
   */
  platform?: string[];
  /**
   * @minItems 1
   */
  mode?: string[];
}
export interface Reference {
  reference_id: Id;
  target: SnapshotTarget;
  relation: 'depends_on' | 'evidence' | 'cites' | 'compares' | 'replaces' | 'related_to';
  propagation: 'blocking' | 'advisory' | 'none';
  update_policy: 'pinned' | 'track_approved' | 'track_all';
  rationale?: string;
}
export interface SnapshotTarget {
  entity_id: Id;
  revision_id: Id;
  anchor_id?: Id;
}
export interface JsonObject {
  [k: string]: JsonValue;
}
export interface Baseline {
  id: Id;
  name: string;
  kind: 'working' | 'release';
  scope: Scope;
  selected: {
    [k: string]: Id;
  };
  closure_policy: 'require_selected_dependencies';
}
export interface Review {
  id: Id;
  subject: SnapshotTarget;
  semantic_model_version: number;
  subject_semantic_digest: string;
  dependency_manifest_digest: string;
  scope: Scope;
  outcome: 'accepted' | 'rejected' | 'changes_requested';
  reviewer: Actor;
  created_at: string;
}
export interface Task {
  id: Id;
  title: string;
  status: 'planned' | 'active' | 'paused' | 'ready_for_review' | 'integrated' | 'cancelled' | 'failed';
  goal: string;
  acceptance: string[];
  base: {
    commit: string;
    schema_versions: Versions;
    baseline_id: Id;
    baseline_fingerprint: string;
  };
  latest_checkpoint: Id;
  skills: SkillPin[];
  integration_profile: string;
  outputs: string[];
  consumed_proposals: Id[];
}
export interface Versions {
  core: number;
  [k: string]: number;
}
export interface SkillPin {
  id: string;
  version: string;
  digest: string;
}
export interface Checkpoint {
  id: Id;
  task_id: Id;
  created_at: string;
  summary: string;
  working_files: string[];
  decisions: string[];
  open_questions: string[];
  next_actions: string[];
  input_manifest_path: string;
  provider_hint?: {
    type: 'claude' | 'codex' | 'fake';
    session_id?: string;
  };
  external_operations?: {
    operation_id: string;
    idempotency_key?: string;
    job_id?: string;
    state: 'pending' | 'completed' | 'failed' | 'external_state_unknown';
  }[];
}
export interface Proposal {
  id: Id;
  task_id: Id;
  base_commit: string;
  expected_baseline_fingerprint: string;
  input_revisions: SnapshotTarget[];
  /**
   * @minItems 1
   */
  changes: ProposalChange[];
}
export interface Sequence {
  id: Id;
  chapters: {
    id: Id;
    label: string;
    scenes: Reference[];
  }[];
}
export interface SkillManifest {
  id: string;
  version: string;
  description?: string;
  entrypoint: string;
}
export interface McpConfiguration {
  profiles: {
    [k: string]: {
      internal_tools: string[];
      external_connections: {
        id: string;
        credential_ref: string;
        enabled: boolean;
      }[];
    };
  };
}
export interface SchemaLock {
  core: SchemaLockEntry;
  extensions: {
    [k: string]: SchemaLockEntry;
  };
}
export interface SchemaLockEntry {
  schema_id: string;
  version: number;
  digest: string;
  path?: string;
  reference_paths?: string[];
  kinds?: string[];
  plugin?: {
    id: string;
    version: string;
    digest: string;
  };
}
export interface MigrationHistory {
  id: Id;
  tool_version: string;
  base_commit: string;
  from: Versions;
  to: Versions;
  steps: {
    id: string;
    implementation_digest: string;
  }[];
  decisions: {
    key: string;
    value: JsonValue;
    rationale: string;
  }[];
  verification: {
    schema_valid: boolean;
    references_valid: boolean;
    semantic_checks_passed: boolean;
  };
  created_at: string;
}
export interface ContextManifest {
  snapshot_token: string;
  view: 'basis' | 'working';
  baseline_id: Id;
  baseline_fingerprint: string;
  schema_versions: Versions;
  builder_version: string;
  query: JsonObject;
  inputs: ContextInput[];
  skills: SkillPin[];
  omissions: string[];
}
export interface ContextInput {
  target: SnapshotTarget;
  source_path: string;
  source_digest: string;
  semantic_digest?: string;
}
export interface NarrativeCharacter {
  profile: JsonObject;
  initial_state: {
    world_tick: number;
    values: JsonObject;
  };
  links?: Reference[];
}
export interface NarrativeScene {
  start_tick?: number;
  end_tick?: number;
}
export interface StateEvent {
  record_role: 'canon' | 'plan';
  world_tick?: number;
  event_order?: number;
  subject: Reference;
  effective_at: EffectiveAt;
  evidence: Reference;
  field: string;
  value: JsonValue;
  unit?: string;
}
export interface EffectiveAt {
  scene: Reference;
  boundary: 'before' | 'after';
}
export interface KnowledgeEvent {
  record_role: 'canon' | 'plan';
  world_tick?: number;
  event_order?: number;
  subject: Reference;
  effective_at: EffectiveAt;
  evidence: Reference;
  proposition: Reference;
  attitude: 'knows' | 'believes' | 'suspects' | 'explicitly_unaware';
}
export interface RevealEvent {
  record_role: 'canon' | 'plan';
  target: Reference;
  sequence_id: Id;
  scene: Reference;
  boundary: 'before' | 'after';
  revealed_content: string;
}
export interface NarrativeFact {
  record_role: 'canon' | 'plan';
  world_tick?: number;
}
export interface GameDesign {
  category?: string;
  parameters?: {
    [k: string]: Quantity;
  };
  invulnerability_seconds?: number;
  stamina_cost?: number;
}
export interface Quantity {
  value: number;
  unit: string;
  value_type: 'integer' | 'decimal';
  minimum?: number;
  maximum?: number;
}
export interface GameObservation {
  build_id: string;
  observed_at: string;
  conditions: JsonObject;
  /**
   * @minItems 1
   */
  measurements: {
    parameter: string;
    quantity: Quantity;
  }[];
  rule: Reference;
  evidence: Reference[];
}
