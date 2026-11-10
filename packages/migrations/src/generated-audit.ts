// Generated from migrations/schemas/audit-v1.schema.json. Run npm run schema:types; do not edit.

export type MigrationAuditV1 = Plan | Report | Journal | DecisionRecord | Attestation;
export type JsonValue =
  | (string | number | boolean | null)
  | JsonValue[]
  | {
      [k: string]: JsonValue;
    };

export interface Plan {
  registryId: string;
  from: Versions;
  to: Versions;
  sourceFingerprint: string;
  steps: Step[];
  expectedFiles: string[];
  decisions: Request[];
  warnings: string[];
  codecs: {
    fromId: string;
    fromDigest: string;
    toId: string;
    toDigest: string;
  };
}
export interface Versions {
  core: number;
  [k: string]: number;
}
export interface Step {
  id: string;
  implementationDigest: string;
}
export interface Request {
  key: string;
  prompt: string;
  requestDigest: string;
  valueSchema: {
    [k: string]: JsonValue;
  };
}
export interface Report {
  schemaValid: boolean;
  referencesValid: boolean;
  semanticChecksPassed: boolean;
  sourceMappings: SourceMapping[];
  semanticMappings: SemanticMapping[];
  reviewMappings: ReviewMapping[];
  contextMappings: ContextMapping[];
  payloadDiffDigest: string;
  diagnostics: Diagnostic[];
  beforeSemanticModelVersion: number;
  afterSemanticModelVersion: number;
}
export interface SourceMapping {
  path: string;
  before: string | null;
  after: string | null;
}
export interface SemanticMapping {
  entity_id: string;
  revision_id: string;
  before_semantic_digest: string;
  after_semantic_digest: string;
  before_dependency_digest: string;
  after_dependency_digest: string;
}
export interface ReviewMapping {
  path: string;
  status: 'semantic_continuity_verified' | 'revalidation_required';
  reason: string;
}
export interface ContextMapping {
  path: string;
  index: number;
  status: 'semantic_continuity_verified' | 'revalidation_required';
  before_source_digest: string;
  after_source_digest: string | null;
}
export interface Diagnostic {
  code: string;
  message: string;
  severity: 'error' | 'warning';
  path: string;
  pointer: string;
  line?: number;
  column?: number;
}
export interface Journal {
  protocol: 1;
  runId: string;
  registryId: string;
  state:
    | 'starting'
    | 'waiting_for_decision'
    | 'staged'
    | 'publishing'
    | 'completed'
    | 'failed'
    | 'review_required';
  source: Guard;
  workspace: Workspace;
  basisPlanDigest: string;
  planDigest: string;
  createdAt: string;
  workspaceGuard?: Guard;
  answersFile?: string;
  resultCommit?: string;
  resultFingerprint?: string;
  error?: {
    code: string;
    message: string;
  };
}
export interface Guard {
  root: string;
  commonDir: string;
  commit: string;
  indexDigest: string | null;
  status: string;
  fingerprint: string;
}
export interface Workspace {
  path: string;
  branch: string;
  baseCommit: string;
  sourceRoot: string;
}
export interface DecisionRecord {
  protocol: 1;
  id: string;
  registry_id: string;
  basis_fingerprint: string;
  answers: Answers;
  created_at: string;
}
export interface Answers {
  [k: string]: Answer;
}
export interface Answer {
  requestDigest: string;
  value: JsonValue;
  rationale: string;
}
export interface Attestation {
  protocol: 1;
  id: string;
  registry_id: string;
  base_commit: string;
  from: Versions;
  to: Versions;
  steps: Step[];
  report: Report;
  decisions_digest: string;
  created_at: string;
}
