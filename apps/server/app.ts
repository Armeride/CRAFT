import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ProjectIndex, IndexError } from '../../packages/indexer/src/service.js';
import { getRegistration, registerLocal } from '../../packages/tasks/src/projects.js';
import { TaskService } from '../../packages/tasks/src/service.js';
import { ValidationFailure } from '../../packages/domain/src/model.js';
import type { Catalog, ProjectChoice } from './contracts.js';

import { registerDraftRoutes } from './drafts.js';

export interface WebOptions { appData: string; port: number; webRoot?: string; examples?: string[] }
const secret = () => randomBytes(32).toString('hex');
const equal = (a: unknown, b: string) => typeof a === 'string' && /^[a-f0-9]{64}$/.test(a) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const idParams = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string', pattern: '^reg_[a-f0-9-]+$' } } };
export async function createWebApp(options: WebOptions) {
  await mkdir(options.appData, { recursive: true });
  const app = Fastify({ logger: false, bodyLimit: 512 * 1024, trustProxy: false, ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } } });
  const csrf = secret(), session = secret(), cookieName = `craft_preview_${options.port}`;
  const hosts = new Set([`127.0.0.1:${options.port}`, `localhost:${options.port}`]);
  const choices = new Map<string, ProjectChoice>(), indexes = new Map<string, ProjectIndex>(), tails = new Map<string, Promise<unknown>>();
  const tasks = new TaskService(options.appData);
  async function withIndex<T>(id: string, action: (index: ProjectIndex) => Promise<T>): Promise<T> {
    if (!choices.has(id)) throw new IndexError('CONTEXT_FORBIDDEN');
    const next = (tails.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => {
      let index = indexes.get(id);
      if (!index) { index = await ProjectIndex.registered(options.appData, id); indexes.set(id, index); }
      return action(index);
    });
    tails.set(id, next); return next;
  }
  async function addProject(id: string) {
    const registration = await getRegistration(options.appData, id);
    if (!registration.projectId || !['ready', 'unsupported'].includes(registration.status)) throw new IndexError('PROJECT_NOT_READY');
    choices.set(id, { id, name: registration.projectId, example: options.examples?.includes(id) ?? false });
    try { const catalog = await withIndex(id, index => index.query<Catalog>('catalog', {}, { scopeToken: index.scopeToken })); choices.get(id)!.name = catalog.data.project.name; }
    catch (error) { choices.delete(id); await indexes.get(id)?.close(); indexes.delete(id); throw error; }
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
    const status = ['CONTEXT_FORBIDDEN'].includes(code) ? 403 : ['BASE_CHANGED', 'FILE_CHANGED_EXTERNALLY', 'WORKTREE_BUSY', 'SOURCE_CHANGED'].includes(code) ? 409 : 400;
    reply.code(status).send({ code, message: 'The request could not be completed', details: { diagnostics }, retryable: ['WORKTREE_BUSY', 'SOURCE_CHANGED'].includes(code), request_id: request.id });
  });
  app.get('/api/session', async (_request, reply) => { reply.header('Set-Cookie', `${cookieName}=${session}; HttpOnly; SameSite=Strict; Path=/`); return { csrf, projects: [...choices.values()], demo: !!options.examples?.length }; });
  app.post<{ Body: { root: string } }>('/api/projects/open', { schema: { body: { type: 'object', additionalProperties: false, required: ['root'], properties: { root: { type: 'string', minLength: 1, maxLength: 4096 } } } } }, async request => { const registration = await registerLocal(options.appData, request.body.root); await addProject(registration.id); return choices.get(registration.id); });
  app.post<{ Params: { id: string }; Body: { operation: 'catalog' | 'exact' | 'search' | 'analyze' | 'reverse' | 'diff' | 'tasks' | 'state'; args?: Record<string, unknown>; baselineId?: string } }>('/api/projects/:id/query', { schema: { params: idParams, body: { type: 'object', additionalProperties: false, required: ['operation'], properties: { operation: { enum: ['catalog', 'exact', 'search', 'analyze', 'reverse', 'diff', 'tasks', 'state'] }, args: { type: 'object', maxProperties: 12 }, baselineId: { type: 'string', minLength: 1, maxLength: 256 } } } } }, request => withIndex(request.params.id, index => index.query(request.body.operation, request.body.args ?? {}, { scopeToken: index.scopeToken, ...(request.body.baselineId ? { baselineId: request.body.baselineId } : {}) })));
  await registerDraftRoutes(app, { appData: options.appData, tasks, withIndex, authorize: id => { if (!choices.has(id)) throw new IndexError('CONTEXT_FORBIDDEN'); } });
  if (options.webRoot) { await app.register(staticFiles, { root: options.webRoot, index: ['index.html'], cacheControl: false }); }
  app.addHook('onClose', async () => { await Promise.allSettled(tails.values()); await Promise.all([...indexes.values()].map(index => index.close())); });
  return app;
}
