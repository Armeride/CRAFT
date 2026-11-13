import type { FastifyInstance } from 'fastify';
import { TaskService } from '../../packages/tasks/src/service.js';
import { ManualService } from '../../packages/tasks/src/manual.js';
import { textFile } from '../../packages/project-fs/src/content.js';
import { fileFailure, newId } from '../../packages/project-fs/src/files.js';
import { HttpCommands } from './commands.js';
interface Options { appData: string; authorize: (id: string) => void; withProject: <T>(id: string, action: () => Promise<T>) => Promise<T> }
const params = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string', pattern: '^run_[a-f0-9-]+$' } } }, digest = { anyOf: [{ type: 'null' }, { type: 'string', pattern: '^[a-f0-9]{64}$' }] };
export async function registerConflictRoutes(app: FastifyInstance, options: Options) {
  const tasks = new TaskService(options.appData), manual = new ManualService(options.appData), commands = new HttpCommands(options.appData);
  app.post<{ Params: { id: string }; Body: { localText: string; expectedDigest: string | null; resource: 'body' | 'editor'; mode: 'server' | 'fork' | 'overwrite' } }>('/api/runs/:id/conflict-resolution', { schema: { params, body: { type: 'object', additionalProperties: false, required: ['localText', 'expectedDigest', 'resource', 'mode'], properties: { localText: { type: 'string', maxLength: 400000 }, expectedDigest: digest, resource: { enum: ['body', 'editor'] }, mode: { enum: ['server', 'fork', 'overwrite'] } } } } }, async request => {
    const { run } = await tasks.run(request.params.id); options.authorize(run.registrationId);
    return commands.execute(request.headers['x-craft-request-id'], 'conflict:' + run.runId, request.body, async () => {
      const { localText, expectedDigest, resource, mode } = request.body;
      if (resource === 'body' && mode === 'overwrite' || resource === 'editor' && mode !== 'overwrite') throw fileFailure('REQUEST_INVALID', 'Choose a supported conflict resolution', 'project.yaml');
      const current = await tasks.project(run.runId), path = `tasks/${run.taskId}/working/${resource === 'body' ? 'ui-draft.md' : 'ui-editor.json'}`, backup = `tasks/${run.taskId}/working/${newId('conflict')}.${resource === 'body' ? 'md' : 'json'}`;
      await tasks.edit(run.runId, current.fingerprint, snapshot => { const original = snapshot.files.get(path); if ((original?.digest ?? null) !== expectedDigest) throw fileFailure('FILE_CHANGED_EXTERNALLY', 'Conflict version changed again', path); return { files: resource === 'body' ? [textFile(backup, localText)] : [textFile(backup, original?.text ?? 'null'), textFile(path, localText)], result: null }; });
      if (resource === 'editor') return { runId: run.runId, backup, editor: (await manual.inspect(run.runId)).editor };
      if (mode === 'server') return { runId: run.runId, backup };
      const source = await tasks.run(run.runId), fork = await options.withProject(run.registrationId, () => tasks.resume(run.registrationId, run.taskId, 'refs/heads/' + run.branch, source.run.headCommit!));
      const forkProject = await tasks.project(fork.runId), forkPath = `tasks/${fork.taskId}/working/ui-draft.md`;
      await tasks.saveDraft(fork.runId, 'ui-draft.md', localText, forkProject.files.get(forkPath)?.digest ?? null);
      return { runId: fork.runId, backup };
    });
  });
  app.get<{ Params: { id: string }; Querystring: { path: string } }>('/api/runs/:id/artifact', { schema: { params, querystring: { type: 'object', additionalProperties: false, required: ['path'], properties: { path: { type: 'string', minLength: 1, maxLength: 4096 } } } } }, async request => {
    const { run } = await tasks.run(request.params.id); options.authorize(run.registrationId); const current = await tasks.project(run.runId), path = request.query.path;
    if (!path.startsWith(`tasks/${run.taskId}/working/`)) throw fileFailure('CONTEXT_FORBIDDEN', 'Read artifacts only in this task', 'project.yaml');
    const file = current.files.get(path); if (file?.text === undefined) throw fileFailure('FILE_MISSING', 'Working artifact is unavailable', 'project.yaml'); return { path, text: file.text, digest: file.digest };
  });
  app.get<{ Params: { id: string } }>('/api/runs/:id/artifacts', { schema: { params } }, async request => { const { run } = await tasks.run(request.params.id); options.authorize(run.registrationId); const current = await tasks.project(run.runId); return { paths: [...current.files.keys()].filter(path => path.startsWith(`tasks/${run.taskId}/working/`) && /\/conflict_[^/]+\.(md|json)$/.test(path)) }; });
}
