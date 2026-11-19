import type { QueryScope } from "./analysis.js";
import type { SnapshotTarget } from "../../schema/src/generated.js";
import type { ContentMode } from "../../state-model/src/evaluation-contracts.js";

export interface StoryQuery {
  sequenceId: string;
  sceneId: string;
  boundary: "before" | "after";
  mode?: ContentMode;
  characterId?: string;
  worldTick?: number;
  eventOrder?: number;
}
export type Perspective = {
  kind: "reader" | "character";
  story: StoryQuery;
  scope?: QueryScope;
};
export type Attitude =
  "knows" | "believes" | "suspects" | "explicitly_unaware" | "unrecorded";
export interface Disclosure {
  target: SnapshotTarget;
  text: string;
  certainty: "confirmed" | "provisional";
  attitude?: Attitude;
}
export interface ScenePoint {
  chapterId: string;
  chapter: string;
  target: SnapshotTarget;
  order: number;
  title: string;
  startTick: number | null;
  endTick: number | null;
}
