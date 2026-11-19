import { loadCommittedProject } from "../../project-fs/src/git-baseline.js";
import { rawObject } from "../../project-fs/src/content.js";
import { gitText } from "../../git-workspace/src/git.js";
import { semanticDigest } from "../../project-fs/src/changes.js";
import type { Checkpoint, Task } from "../../schema/src/generated.js";
import { externalOperations } from "./external-records.js";
import { readResumeNotes } from "./resume-contracts.js";
import type { ResumeContext, ResumeNotes } from "./resume-contracts.js";
import type { TaskService } from "./service.js";

export async function resumeContext(
  tasks: TaskService,
  runId: string,
): Promise<ResumeContext> {
  const { run, registration } = await tasks.run(runId);
  const snapshot = await tasks.project(runId);
  const root = `tasks/${run.taskId}/`,
    prefix = root + "working/";
  const task = rawObject<Task>(snapshot.files, root + "task.yaml");
  const checkpoint = rawObject<Checkpoint>(
    snapshot.files,
    root + `checkpoints/${task.latest_checkpoint}.yaml`,
  );
  const notesPath = prefix + "resume-notes.json";
  const notes = snapshot.files.has(notesPath)
    ? readResumeNotes(rawObject<ResumeNotes>(snapshot.files, notesPath))
    : {
        decisions: checkpoint.decisions,
        openQuestions: checkpoint.open_questions,
        nextActions: checkpoint.next_actions,
      };
  const ref = run.targetRef.startsWith("refs/heads/")
    ? run.targetRef
    : "refs/heads/" + run.targetRef;
  const currentTarget = await gitText(registration.root, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    ref + "^{commit}",
  ]);
  const changedInputs =
    currentTarget === task.base.commit
      ? []
      : await compareInputs(registration.root, task, currentTarget);

  const results = task.outputs.filter(
    (path) =>
      path.startsWith(prefix + "agent-result-") && snapshot.files.has(path),
  );
  const latestResult = results.at(-1);
  let previous: ResumeContext["previous"];
  if (latestResult) {
    const requestFile = latestResult.replace(
      "/agent-result-",
      "/agent-request-",
    );
    const result = rawObject<{
      provider: string;
      message: string;
      state: string;
      code?: string;
    }>(snapshot.files, latestResult);
    const request = snapshot.files.has(requestFile)
      ? rawObject<{ prompt: string }>(snapshot.files, requestFile)
      : undefined;
    previous = {
      provider: result.provider,
      prompt: request?.prompt?.slice(0, 4000) ?? "",
      result: result.message?.slice(0, 5000) ?? "",
      state: result.state,
      ...(result.code ? { code: result.code } : {}),
    };
  }
  return {
    ...notes,
    taskId: task.id,
    goal: task.goal,
    acceptance: task.acceptance,
    originalBasis: task.base.commit,
    runBasis: run.basisCommit,
    currentTarget,
    baselineId: task.base.baseline_id,
    checkpointId: checkpoint.id,
    checkpointSummary: checkpoint.summary,
    changedInputs,
    preservedWork: task.outputs
      .filter((path) => snapshot.files.has(path))
      .slice(-100),
    skillPins: task.skills,
    ...(previous ? { previous } : {}),
    external: externalOperations(snapshot, task.id),
    notesDigest: snapshot.files.get(notesPath)?.digest ?? null,
  };
}

async function compareInputs(
  root: string,
  task: Task,
  target: string,
): Promise<ResumeContext["changedInputs"]> {
  const [original, current] = await Promise.all([
    loadCommittedProject(root, task.base.commit),
    loadCommittedProject(root, target),
  ]);
  const before =
    original.baselines.get(task.base.baseline_id)?.value.selected ?? {};
  const after =
    current.baselines.get(task.base.baseline_id)?.value.selected ?? {};
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
    .flatMap((entityId) => {
      const preservedRevision = before[entityId] ?? null,
        currentRevision = after[entityId] ?? null;
      if (preservedRevision && preservedRevision === currentRevision) {
        const prior = original.entities
          .get(entityId)
          ?.revisions.get(preservedRevision);
        const next = current.entities
          .get(entityId)
          ?.revisions.get(preservedRevision);
        if (
          prior?.writable &&
          next?.writable &&
          semanticDigest(original, entityId, preservedRevision) ===
            semanticDigest(current, entityId, preservedRevision)
        )
          return [];
      }
      return [{ entityId, preservedRevision, currentRevision }];
    });
}
