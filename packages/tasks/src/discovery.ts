import type { Task, Checkpoint } from '../../schema/src/generated.js';
import { SchemaValidator } from '../../schema/src/index.js';
import { gitText } from '../../git-workspace/src/git.js';
import { loadCommittedProject, readCommittedFiles } from '../../project-fs/src/git-baseline.js';
import { checkImmutability } from '../../project-fs/src/changes.js';
import { rawObject } from '../../project-fs/src/content.js';
import { parseProject } from '../../project-fs/src/project.js';

export interface TaskLocation {
  taskId: string;
  ref: string;
  commit: string;
  runId: string | null;
  projectId: string;
  task: Task;
  checkpoint: Checkpoint;
  runnable: boolean;
  localPreserved: boolean;
  remotePreserved: boolean;
  remoteRefs: readonly string[];
}
export async function discoverTasks(root: string, projectId: string): Promise<TaskLocation[]> {
  const records = (await gitText(root, ['for-each-ref', '--format=%(refname)%00%(objectname)', 'refs/heads', 'refs/remotes'])).split('\n').filter(Boolean).map(line => { const [ref, commit] = line.split('\0'); return { ref: ref!, commit: commit! }; });
  const selected = records.filter(record => /^(?:refs\/heads|refs\/remotes\/[^/]+)\/workbench\/task\/task_[a-z0-9_-]+\/run_[a-f0-9-]+$/.test(record.ref));
  const head = await gitText(root, ['rev-parse', '--verify', 'HEAD^{commit}']);
  selected.unshift({ ref: 'HEAD', commit: head });
  const validator = new SchemaValidator();
  const cache = new Map<string, Awaited<ReturnType<typeof readCommittedFiles>>>();
  const result: TaskLocation[] = [];
  for (const record of selected) {
    try {
    let files = cache.get(record.commit);
    if (!files) { files = await readCommittedFiles(root, record.commit); cache.set(record.commit, files); }
    if (!files.has('project.yaml')) continue;
    const manifest = rawObject<{ project_id?: string; schema_version?: number }>(files, 'project.yaml');
    if (manifest.project_id !== projectId || manifest.schema_version !== 1) continue;
    let runnable = true;
    try { const snapshot = parseProject(files); runnable = snapshot.writable; } catch { runnable = false; }
    for (const [path] of files) {
      const match = /^tasks\/([^/]+)\/task\.yaml$/.exec(path);
      if (!match) continue;
      const task = rawObject<Task>(files, path);
      if (validator.validate('Task', task, path).length || task.id !== match[1]) continue;
      const branchMatch = /\/workbench\/task\/([^/]+)\/([^/]+)$/.exec(record.ref);
      if (branchMatch && branchMatch[1] !== task.id) continue;
      const checkpointPath = `tasks/${task.id}/checkpoints/${task.latest_checkpoint}.yaml`;
      if (!files.has(checkpointPath)) continue;
      const checkpoint = rawObject<Checkpoint>(files, checkpointPath);
      if (validator.validate('Checkpoint', checkpoint, checkpointPath).length || checkpoint.task_id !== task.id) continue;
      const remoteRefs = records.filter(other => other.ref.startsWith('refs/remotes/') && other.commit === record.commit).map(other => other.ref);
      let taskRunnable = runnable;
      if (taskRunnable) try { taskRunnable = checkImmutability(await loadCommittedProject(root, task.base.commit), parseProject(files)).length === 0; } catch { taskRunnable = false; }
      result.push({ taskId: task.id, ref: record.ref, commit: record.commit, runId: branchMatch?.[2] ?? null, projectId, task, checkpoint, runnable: taskRunnable, localPreserved: record.ref === 'HEAD' || record.ref.startsWith('refs/heads/'), remotePreserved: record.ref.startsWith('refs/remotes/') || remoteRefs.length > 0, remoteRefs });
    }
    } catch { /* An unreadable tip must not hide other preserved task refs. An explicit older checkpoint can still be resumed. */ }
  }
  return result;
}
