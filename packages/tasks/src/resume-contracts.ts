export interface ResumeNotes {
  decisions: string[];
  openQuestions: string[];
  nextActions: string[];
}

export interface ResumeContext extends ResumeNotes {
  taskId: string;
  goal: string;
  acceptance: string[];
  originalBasis: string;
  runBasis: string;
  currentTarget: string;
  baselineId: string;
  checkpointId: string;
  checkpointSummary: string;
  changedInputs: {
    entityId: string;
    preservedRevision: string | null;
    currentRevision: string | null;
  }[];
  preservedWork: string[];
  skillPins: { id: string; version: string; digest: string }[];
  previous?: {
    provider: string;
    prompt: string;
    result: string;
    state: string;
    code?: string;
  };
  external: { operation_id: string; state: string; job_id?: string }[];
  notesDigest: string | null;
}

export function readResumeNotes(value: ResumeNotes): ResumeNotes {
  for (const items of [
    value.decisions,
    value.openQuestions,
    value.nextActions,
  ]) {
    if (
      !Array.isArray(items) ||
      items.length > 30 ||
      items.some((item) => typeof item !== "string" || item.length > 1500)
    ) {
      throw new Error("Invalid continuation notes");
    }
  }
  return {
    decisions: value.decisions,
    openQuestions: value.openQuestions,
    nextActions: value.nextActions,
  };
}
