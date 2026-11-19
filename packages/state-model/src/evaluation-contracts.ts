import type { Scenario } from "./generated.js";
import type {
  ScenePoint,
  StoryQuery,
} from "../../domain/src/story-contracts.js";
import type { SnapshotTarget, JsonValue } from "../../schema/src/generated.js";

export const evaluatorVersion = "state-evaluator-1";
export type ContentMode = "confirmed" | "working";
export type Truth = "true" | "false" | "unknown";
export type Confidence = "confirmed" | "provisional" | "hypothetical";
export interface EvaluationPoint {
  worldTick: number;
  eventOrder?: number;
  boundary?: "before" | "after";
  scene?: SnapshotTarget;
}
export type StatePoint = Pick<
  EvaluationPoint,
  "worldTick" | "eventOrder" | "boundary"
>;
export interface StateQuery extends StatePoint {
  mode?: ContentMode;
  scene?: Pick<StoryQuery, "sequenceId" | "sceneId" | "boundary">;
  scenario?: SnapshotTarget;
  actor?: string;
  occurrenceIds?: string[];
  overrides?: Record<string, JsonValue>;
  actorOverrides?: Record<string, Record<string, JsonValue>>;
  target?: string;
}
export interface StateCell {
  instance: string;
  target: SnapshotTarget;
  field: string;
  unit?: string;
  value?: JsonValue;
  certainty: Confidence | "unknown";
  source?: SnapshotTarget;
  evidence?: SnapshotTarget;
  occurrenceId?: string;
}
export interface StateTrace {
  occurrenceId: string;
  worldTick: number;
  eventOrder: number;
  transition?: SnapshotTarget;
  source?: SnapshotTarget;
  evidence?: SnapshotTarget;
  bindings: Record<string, string>;
  condition?: Truth;
  checks?: Record<string, Truth>;
  outcome: "applied" | "false" | "unknown" | "ignored" | "conflict" | "limit";
  reason?: string;
  certainty: Confidence;
}
export interface EvaluationIssue {
  code: string;
  source?: SnapshotTarget;
  occurrenceId?: string;
  field?: string;
}
export interface StateResult {
  point: EvaluationPoint;
  mode: ContentMode;
  assumption: boolean;
  actor: string | null;
  cells: StateCell[];
  trace: StateTrace[];
  issues: EvaluationIssue[];
}
export interface EvaluationResult extends StateResult {
  inputDigest: string;
  scopeCacheKey: string;
}
export interface StateOptions {
  targets: { id: string; title: string }[];
  sequences: { id: string; scenes: ScenePoint[]; incomplete: boolean }[];
  scenarios: {
    target: SnapshotTarget;
    title: string;
    worldTick: number;
    actors: string[];
    occurrences: Scenario["occurrences"];
    assumptions: string[];
  }[];
}
export interface StateComparison {
  before: StateResult;
  after: StateResult;
  changes: {
    instance: string;
    field: string;
    before: StateCell | null;
    after: StateCell | null;
  }[];
}
