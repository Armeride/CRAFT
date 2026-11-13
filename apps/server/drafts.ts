import type { FastifyInstance } from 'fastify';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { posix } from 'node:path';
import { HttpCommands } from './commands.js';
import { getRegistration } from '../../packages/tasks/src/projects.js';
import { readCommittedFiles } from '../../packages/project-fs/src/git-baseline.js';
import { gitText } from '../../packages/git-workspace/src/git.js';
import { ProjectIndex, IndexError } from '../../packages/indexer/src/service.js';
import { TaskService } from '../../packages/tasks/src/service.js';
import { parseYaml } from '../../packages/project-fs/src/yaml.js';
import type { Draft, DraftSource, DraftSummary, EntityDetail, WorkRequest } from './contracts.js';
interface Options { appData: string; changed?: (registrationId: string, type: string, runId?: string) => Promise<void>; tasks: TaskService; authorize: (registration: string) => void; withIndex: <T>(id: string, action: (index: ProjectIndex) => Promise<T>) => Promise<T> }
const idParams = (prefix: string) => ({ type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string', pattern: `^${prefix}_[a-f0-9-]+$` } } });
const digest = { anyOf: [{ type: 'null' }, { type: 'string', pattern: '^[a-f0-9]{64}$' }] };
const text = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength });
function sourceContext(value: unknown): DraftSource {
  if (!value || typeof value !== 'object') throw new IndexError('WORKING_CONTEXT_INVALID');
  const data = value as { version?: unknown; source?: Record<string, unknown> };
  const source = data.source;
  if (data.version !== 1 || !source || !['entityId', 'revisionId', 'baselineId'].every(key => typeof source[key] === 'string' && /^[a-z][a-z0-9_-]{0,255}$/.test(source[key])) || !['sourceDigest', 'bodyDigest'].every(key => typeof source[key] === 'string' && /^[a-f0-9]{64}$/.test(source[key]))) throw new IndexError('WORKING_CONTEXT_INVALID');
  return source as unknown as DraftSource;
}
function requestLog(value: unknown): WorkRequest[] {
  const log = value as { version?: unknown; requests?: unknown } | null;
  if (!log || log.version !== 1 || !Array.isArray(log.requests) || log.requests.length > 100) throw new IndexError('WORKING_CONTEXT_INVALID');
  const ids = new Set<string>();
  for (const entry of log.requests) { const request = entry as WorkRequest; if (!request || typeof request.id !== 'string' || !/^[a-f0-9-]{36}$/.test(request.id) || ids.has(request.id) || typeof request.text !== 'string' || request.text.length > 12000 || !request.text.trim() || typeof request.createdAt !== 'string' || !Number.isFinite(Date.parse(request.createdAt))) throw new IndexError('WORKING_CONTEXT_INVALID'); ids.add(request.id); }
  return log.requests as WorkRequest[];
}
export async function registerDraftRoutes(app: FastifyInstance, options: Options) {
  const { tasks, withIndex, authorize } = options;
  const commands = new HttpCommands(options.appData);
  async function readDraft(id: string): Promise<Draft> {
    const { run } = await tasks.run(id); authorize(run.registrationId);
    const snapshot = await tasks.project(id), prefix = `tasks/${run.taskId}/working/`;
    const file = snapshot.files.get(prefix + 'ui-draft.md'), context = snapshot.files.get(prefix + 'ui-context.json'), notes = snapshot.files.get(prefix + 'ui-requests.json');
    const task = snapshot.documents.get(`tasks/${run.taskId}/task.yaml`) as { goal: string } | undefined;
    return { runId: id, registrationId: run.registrationId, goal: task?.goal ?? '', text: file?.text ?? '', digest: file?.digest ?? null, state: run.status, source: context?.text ? sourceContext(parseYaml(context.text, context.path).value) : null, requests: notes?.text ? requestLog(parseYaml(notes.text, notes.path).value) : [], requestsDigest: notes?.digest ?? null };
  }
  app.get<{ Params: { id: string } }>('/api/projects/:id/drafts', { schema: { params: idParams('reg') } }, async request => {
    authorize(request.params.id); let folders: string[]; try { folders = await readdir(join(options.appData, 'runs')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { drafts: [], truncated: false }; throw error; }
    const drafts: DraftSummary[] = [], candidates = folders.filter(name => /^run_[a-f0-9-]+$/.test(name)).sort(); let unavailable = 0;
    for (const id of candidates.slice(0, 200)) { const { run } = await tasks.run(id, false); if (run.registrationId !== request.params.id || run.workspaceState !== 'present') continue; try { const value = await readDraft(id); if (value.digest || value.source) drafts.push({ runId: id, registrationId: run.registrationId, goal: value.goal, source: value.source, state: value.state }); } catch { unavailable++; } }
    return { drafts, truncated: candidates.length > 200, unavailable };
  });
  app.post<{ Params: { id: string }; Body: { entityId: string; revisionId: string; goal: string; expectedSnapshot: string; baselineId: string } }>('/api/projects/:id/drafts', { schema: { params: idParams('reg'), body: { type: 'object', additionalProperties: false, required: ['entityId', 'revisionId', 'goal', 'expectedSnapshot', 'baselineId'], properties: { entityId: text(256), revisionId: text(256), goal: text(4000), expectedSnapshot: { type: 'string', pattern: '^[a-f0-9]{64}$' }, baselineId: text(256) } } } }, request => { authorize(request.params.id); return commands.execute(request.headers['x-craft-request-id'], 'draft:' + request.params.id, request.body, () => withIndex(request.params.id, async index => {
    const source = await index.query<EntityDetail>('exact', { entityId: request.body.entityId, revisionId: request.body.revisionId }, { scopeToken: index.scopeToken, expectedSnapshot: request.body.expectedSnapshot, baselineId: request.body.baselineId });
    const registration = await getRegistration(options.appData, request.params.id), committed = await readCommittedFiles(registration.root, await gitText(registration.root, ['rev-parse', 'HEAD']));
    if (committed.get(source.data.sourcePath)?.digest !== source.data.sourceDigest || committed.get(posix.join(posix.dirname(source.data.sourcePath), source.data.meta.body_path))?.digest !== source.data.bodyDigest) throw new IndexError('DRAFT_BASIS_MISMATCH');
    const run = await tasks.start(request.params.id, { goal: request.body.goal, baselineId: request.body.baselineId });
    await tasks.saveDraft(run.runId, 'ui-draft.md', source.data.body, null);
    const context: DraftSource = { entityId: source.data.entityId, revisionId: source.data.revisionId, baselineId: request.body.baselineId, sourceDigest: source.data.sourceDigest, bodyDigest: source.data.bodyDigest };
    await tasks.saveDraft(run.runId, 'ui-context.json', JSON.stringify({ version: 1, source: context }, null, 2) + '\n', null);
    await options.changed?.(run.registrationId, 'task.changed', run.runId);
    return readDraft(run.runId);
  })); });
  app.get<{ Params: { id: string } }>('/api/runs/:id/draft', { schema: { params: idParams('run') } }, request => readDraft(request.params.id));
  app.put<{ Params: { id: string }; Body: { text: string; expectedDigest: string | null } }>('/api/runs/:id/draft', { schema: { params: idParams('run'), body: { type: 'object', additionalProperties: false, required: ['text', 'expectedDigest'], properties: { text: { type: 'string', maxLength: 300000 }, expectedDigest: digest } } } }, async request => { const { run } = await tasks.run(request.params.id); authorize(run.registrationId); await tasks.saveDraft(run.runId, 'ui-draft.md', request.body.text, request.body.expectedDigest); await options.changed?.(run.registrationId, 'task.changed', run.runId); return readDraft(run.runId); });
  app.post<{ Params: { id: string }; Body: { text: string; expectedDigest: string | null; requestId: string } }>('/api/runs/:id/requests', { schema: { params: idParams('run'), body: { type: 'object', additionalProperties: false, required: ['text', 'expectedDigest', 'requestId'], properties: { text: text(12000), expectedDigest: digest, requestId: { type: 'string', pattern: '^[a-f0-9-]{36}$' } } } } }, async request => {
    const value = await readDraft(request.params.id), existing = value.requests.find(entry => entry.id === request.body.requestId);
    if (existing) { if (existing.text !== request.body.text.trim()) throw new IndexError('REQUEST_ID_REUSED'); return value; }
    if (value.requests.length >= 100 || !request.body.text.trim()) throw new IndexError('REQUEST_INVALID');
    const requests = [...value.requests, { id: request.body.requestId, text: request.body.text.trim(), createdAt: new Date().toISOString() }];
    const serialized = JSON.stringify({ version: 1, requests }, null, 2) + '\n';
    if (Buffer.byteLength(serialized, 'utf8') > 1024 * 1024) throw new IndexError('WORKING_REQUEST_LIMIT');
    await tasks.saveDraft(value.runId, 'ui-requests.json', serialized, request.body.expectedDigest);
    await options.changed?.(value.registrationId, 'task.changed', value.runId);
    return readDraft(value.runId);
  });
}
