import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { QueryScope } from '../../packages/domain/src/analysis.js';
import type { Perspective } from '../../packages/domain/src/story-contracts.js';
import { queryOperations, type QueryOperation } from '../../packages/indexer/src/types.js';
import { ProjectIndex, IndexError } from '../../packages/indexer/src/service.js';
import { getRegistration, registerLocal } from '../../packages/tasks/src/projects.js';
import { TaskService } from '../../packages/tasks/src/service.js';
import { ValidationFailure } from '../../packages/domain/src/model.js';
import type { Catalog, ProjectChoice } from './contracts.js';

import { registerDraftRoutes } from './drafts.js';
import { registerManualRoutes } from './manual.js';
import { registerLibraryRoutes } from './library.js';
import { registerConflictRoutes } from './conflicts.js';
import { WorkspaceEvents, registerEventRoute } from './events.js';
import { registerAgentRoutes } from './agents.js';
import type { AgentServiceOptions } from '../../packages/agent-core/src/service.js';

export interface WebOptions { appData: string; port: number; webRoot?: string; examples?: string[]; agentAdapters?: AgentServiceOptions['adapters'] }
const secret = () => randomBytes(32).toString('hex');
const equal = (a: unknown, b: string) => typeof a === 'string' && /^[a-f0-9]{64}$/.test(a) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const idParams = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string', pattern: '^reg_[a-f0-9-]+$' } } };
export async function createWebApp(options: WebOptions) {
  await mkdir(options.appData, { recursive: true });
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024, trustProxy: false, ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } } });
  const csrf = secret(), session = secret(), cookieName = `craft_preview_${options.port}`;
  const hosts = new Set([`127.0.0.1:${options.port}`, `localhost:${options.port}`]);
  const choices = new Map<string, ProjectChoice>(), indexes = new Map<string, ProjectIndex>(), tails = new Map<string, Promise<unknown>>();
  const tasks = new TaskService(options.appData), events = new WorkspaceEvents(options.appData); await events.init();
  const authorize = (id: string) => { if (!choices.has(id)) throw new IndexError('CONTEXT_FORBIDDEN'); };
  const changed = (id: string, type: string, runId?: string) => events.publish(id, type, runId);
  async function withProject<T>(id: string, action: () => Promise<T>): Promise<T> {
    const next = (tails.get(id) ?? Promise.resolve()).catch(() => {}).then(action); tails.set(id, next); return next;
  }
  async function withIndex<T>(id: string, action: (index: ProjectIndex) => Promise<T>): Promise<T> {
    authorize(id); return withProject(id, async () => { let index = indexes.get(id); if (!index) { index = await ProjectIndex.registered(options.appData, id); indexes.set(id, index); } return action(index); });
  }
  async function addProject(id: string) {
    const registration = await getRegistration(options.appData, id);
    if (!registration.projectId || !['ready', 'unsupported'].includes(registration.status)) throw new IndexError('PROJECT_NOT_READY');
    events.watch(id, registration.root, registration.selectedRef);
    choices.set(id, { id, name: registration.projectId, example: options.examples?.includes(id) ?? false });
    try { const catalog = await withIndex(id, index => index.query<Catalog>('catalog', {}, { scopeToken: index.scopeToken })); choices.get(id)!.name = catalog.data.project.name; }
    catch (error) { if ((error as { code?: string }).code === 'RECOVERY_REQUIRED' || error instanceof ValidationFailure && error.diagnostics.some(issue => issue.code === 'RECOVERY_REQUIRED')) return; choices.delete(id); await indexes.get(id)?.close(); indexes.delete(id); throw error; }
  }
  try { for (const name of await readdir(join(options.appData, 'registrations'))) if (/^reg_[a-f0-9-]+\.json$/.test(name)) { const registration = await getRegistration(options.appData, name.slice(0, -5)); if (registration.projectId && ['ready', 'unsupported'].includes(registration.status)) { try { await addProject(registration.id); } catch { choices.set(registration.id, { id: registration.id, name: registration.projectId, example: options.examples?.includes(registration.id) ?? false }); } } } }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  app.addHook('onRequest', async (request, reply) => {
    const host = request.headers.host ?? '', origin = request.headers.origin;
    if (!hosts.has(host) || origin !== undefined && origin !== `http://${host}` || request.headers['sec-fetch-site'] === 'cross-site') return reply.code(403).send({ code: 'CONTEXT_FORBIDDEN', message: 'Request origin refused', details: {}, retryable: false, request_id: request.id });
    if (!request.url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    if (request.url === '/api/session' && request.method === 'GET') return;
    const cookie = request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    if (!equal(cookie, session) || !equal(request.headers['x-craft-csrf'], csrf)) return reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Session required', details: {}, retryable: false, request_id: request.id });
  });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer').header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"); return payload;
  });
  app.setErrorHandler((error: Error & { code?: string; validation?: unknown }, request, reply) => {
    const diagnostics = error instanceof ValidationFailure ? error.diagnostics : [];
    const code = diagnostics[0]?.code ?? (error.validation ? 'REQUEST_INVALID' : error.code ?? 'REQUEST_FAILED');
    const status = ['CONTEXT_FORBIDDEN'].includes(code) ? 403 : ['BASE_CHANGED', 'FILE_CHANGED_EXTERNALLY', 'WORKTREE_BUSY', 'SOURCE_CHANGED', 'INTEGRATION_CONFLICT', 'INTEGRATION_SEMANTIC_CONFLICT', 'MIGRATION_MERGE_UNSUPPORTED', 'REVIEW_TOKEN_INVALID', 'APPROVAL_BLOCKED', 'CHECKPOINT_REQUIRED', 'PROPOSAL_ALREADY_CONSUMED'].includes(code) ? 409 : 400;
    reply.code(status).send({ code, message: 'The request could not be completed', details: { diagnostics }, retryable: ['WORKTREE_BUSY', 'SOURCE_CHANGED'].includes(code), request_id: request.id });
  });
  app.get('/api/session', async (_request, reply) => { reply.header('Set-Cookie', `${cookieName}=${session}; HttpOnly; SameSite=Strict; Path=/`); return { csrf, projects: [...choices.values()], demo: !!options.examples?.length }; });
  app.post<{ Body: { root: string } }>('/api/projects/open', { schema: { body: { type: 'object', additionalProperties: false, required: ['root'], properties: { root: { type: 'string', minLength: 1, maxLength: 4096 } } } } }, async request => { const registration = await registerLocal(options.appData, request.body.root); await addProject(registration.id); return choices.get(registration.id); });
  const queryBody = { type: 'object', additionalProperties: false, required: ['operation'], properties: {
    operation: { enum: queryOperations }, args: { type: 'object', maxProperties: 12 },
    baselineId: { type: 'string', minLength: 1, maxLength: 256 }, expectedSnapshot: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    perspective: { anyOf: [{ const: 'author' }, { type: 'object', maxProperties: 3 }] },
    scope: { type: 'object', additionalProperties: false, properties: Object.fromEntries(['continuity', 'platform', 'mode'].map(key => [key, { type: 'string', minLength: 1, maxLength: 256 }])) },
  } };
  type QueryBody = { operation: QueryOperation; args?: Record<string, unknown>; baselineId?: string; expectedSnapshot?: string; perspective?: 'author' | Perspective; scope?: QueryScope };
  app.post<{ Params: { id: string }; Body: QueryBody }>('/api/projects/:id/query', { schema: { params: idParams, body: queryBody } }, request => {
    const { operation, args, ...options } = request.body;
    return withIndex(request.params.id, index => index.query(operation, args ?? {}, { scopeToken: index.scopeToken, ...options }));
  });
  app.post<{ Params: { id: string; view: 'basis' | 'working' }; Body: QueryBody }>('/api/runs/:id/query/:view', { schema: {
    params: { type: 'object', required: ['id', 'view'], additionalProperties: false, properties: { id: { type: 'string', pattern: '^run_[a-f0-9-]+$' }, view: { enum: ['basis', 'working'] } } }, body: queryBody,
  } }, async request => {
    const { run } = await tasks.run(request.params.id); authorize(run.registrationId);
    const { operation, args, ...queryOptions } = request.body;
    const index = await ProjectIndex.run(options.appData, run.runId, request.params.view);
    try { return await index.query(operation, args ?? {}, { scopeToken: index.scopeToken, ...queryOptions }); }
    finally { await index.close(); }
  });
  await registerDraftRoutes(app, { appData: options.appData, tasks, withIndex, authorize, changed });
  await registerManualRoutes(app, { appData: options.appData, authorize, changed, withProject });
  registerEventRoute(app, events, authorize);
  await registerConflictRoutes(app, { appData: options.appData, authorize, withProject });
  await registerLibraryRoutes(app, { appData: options.appData, authorize, changed, withProject, attach: async id => { await addProject(id); return choices.get(id)!; } });
  await registerAgentRoutes(app, { appData: options.appData, port: options.port, authorize, changed, ...(options.agentAdapters ? { adapters: options.agentAdapters } : {}) });
  if (options.webRoot) { await app.register(staticFiles, { root: options.webRoot, index: ['index.html'], cacheControl: false }); }
  app.addHook('onClose', async () => { await events.close(); await Promise.allSettled(tails.values()); await Promise.all([...indexes.values()].map(index => index.close())); });
  return app;
}
