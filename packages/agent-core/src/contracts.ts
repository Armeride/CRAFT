export type ProviderId = "codex" | "claude" | "fake";
export type AgentState =
  | "starting"
  | "running"
  | "waiting_for_input"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface AgentCapabilities {
  streaming: boolean;
  interruption: boolean;
  interactiveApproval: boolean;
  userQuestions: boolean;
  mcp: boolean;
  resume: boolean;
  usageReporting: boolean;
}

export interface AgentInstallation {
  provider: ProviderId;
  path: string | null;
  version: string | null;
  authentication:
    "authenticated" | "unauthenticated" | "unknown" | "not_required";
  available: boolean;
  code?: string;
  capabilities: AgentCapabilities;
}

export interface AgentQuestion {
  id: string;
  question: string;
  options: string[];
  multiple: boolean;
}

export interface AgentRequest {
  id: string;
  kind: "approval" | "question";
  title: string;
  details: string;
  questions: AgentQuestion[];
}

export interface AgentAnswer {
  allow: boolean;
  answers?: Record<string, string[]>;
}

export interface AgentEvent {
  sequence: number;
  type:
    | "run.started"
    | "message.delta"
    | "tool.started"
    | "tool.completed"
    | "approval.requested"
    | "input.requested"
    | "usage.updated"
    | "artifact.created"
    | "run.completed"
    | "run.failed"
    | "run.cancelled";
  createdAt: string;
  text?: string;
  tool?: string;
  code?: string;
  request?: AgentRequest;
  usage?: Record<string, number>;
}

export interface AgentExecution {
  version: 1;
  id: string;
  runId: string;
  registrationId: string;
  provider: ProviderId;
  requestDigest: string;
  installationVersion: string | null;
  state: AgentState;
  prompt: string;
  message: string;
  events: AgentEvent[];
  lastSequence: number;
  pending: AgentRequest | null;
  source: { entityId: string; revisionId: string } | null;
  baselineId: string;
  checkpointId?: string;
  providerSession?: string;
  code?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdapterContext {
  cwd: string;
  prompt: string;
  userPrompt: string;
  model?: string;
  installation: AgentInstallation;
  mcp: { url: string; token: string };
  signal: AbortSignal;
  emit: (event: Omit<AgentEvent, "sequence" | "createdAt">) => Promise<void>;
  ask: (request: Omit<AgentRequest, "id">) => Promise<AgentAnswer>;
  session: (id: string) => Promise<void>;
  tool: (name: string, input: Record<string, unknown>) => Promise<unknown>;
}

export interface AgentAdapter {
  execute(context: AdapterContext): Promise<void>;
}

export class AgentError extends Error {
  constructor(
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(code);
    this.name = "AgentError";
  }
}
