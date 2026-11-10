// Generated from workspace-runtime/schemas/runtime-v1.schema.json. Run npm run schema:types; do not edit.

export type WorkspaceRuntimeV1 = Registration | Run | Operation | Transaction;

export interface Registration {
  protocol: 1;
  id: string;
  root: string;
  commonDir: string;
  projectId: string | null;
  selectedRef: string | null;
  head: string | null;
  status: 'ready' | 'import_required' | 'unborn' | 'unsupported' | 'invalid';
  remoteUrl?: string;
  createdAt: string;
}
export interface Run {
  protocol: 1;
  registrationId: string;
  projectId: string;
  taskId: string;
  runId: string;
  worktreeId: string;
  branch: string;
  path: string;
  basisCommit: string;
  targetRef: string;
  status:
    | 'queued'
    | 'starting'
    | 'running'
    | 'waiting_for_input'
    | 'cancelling'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'interrupted'
    | 'unknown';
  workspaceState: 'present' | 'removed' | 'missing' | 'recovering';
  cancelRequested: boolean;
  omittedWorkingChanges: boolean;
  selectedSnapshotRef?: string;
  initialCommit?: string;
  headCommit?: string;
  checkpointId?: string;
  resumedFrom?: {
    ref: string;
    commit: string;
    checkpointId: string;
  };
  validation?: {
    valid: boolean;
    codes: string[];
  };
  error?: string;
  createdAt: string;
}
export interface Operation {
  protocol: 1;
  id: string;
  kind: 'snapshot' | 'import' | 'integration';
  registrationId: string;
  path: string;
  branch: string;
  basisCommit: string;
  status: 'starting' | 'ready' | 'completed' | 'failed';
  resultCommit?: string;
  inputCommit?: string;
  error?: string;
}
export interface Transaction {
  protocol: 1;
  id: string;
  scopeId: string;
  root: string;
  branch: string;
  beforeFingerprint: string;
  afterFingerprint: string;
  state: 'prepared' | 'writing' | 'applied' | 'conflict';
  edits: Edit[];
  completed: string[];
  error?: string;
  createdAt: string;
}
export interface Edit {
  path: string;
  before: SourceFile | null;
  after: SourceFile | null;
}
export interface SourceFile {
  path: string;
  text?: string;
  contentBase64: string;
  digest: string;
}
