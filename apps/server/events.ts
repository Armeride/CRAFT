import { readFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { atomicText } from '../../packages/workspace-runtime/src/state.js';
import { parseYaml } from '../../packages/project-fs/src/yaml.js';
import { withKernelLock } from '../../packages/git-workspace/src/locks.js';
import { ValidationFailure } from '../../packages/domain/src/model.js';
import { isCanonicalPath } from '../../packages/project-fs/src/files.js';
export interface WorkspaceEvent { sequence: number; projectId: string; type: string; runId?: string }
export class WorkspaceEvents {
  private sequence = 0;
  private events: WorkspaceEvent[] = [];
  private tail: Promise<void> = Promise.resolve();
  private listeners = new Set<(event: WorkspaceEvent) => void>();
  private watchers = new Map<string, FSWatcher>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(readonly appData: string) {}
  async init() {
    const path = join(this.appData, 'web-events.json');
    try { const value = parseYaml(await readFile(path, 'utf8'), path).value as unknown as { version: number; sequence: number; events: WorkspaceEvent[] }; if (value.version !== 1 || !Number.isSafeInteger(value.sequence) || value.sequence < 0 || !Array.isArray(value.events) || value.events.length > 200 || value.events.some((event, index) => !Number.isSafeInteger(event.sequence) || event.sequence > value.sequence || event.sequence <= (value.events[index - 1]?.sequence ?? 0) || typeof event.projectId !== 'string' || typeof event.type !== 'string')) throw Error('EVENT_JOURNAL_INVALID'); this.sequence = value.sequence; this.events = value.events; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.then(async () => {
      for (let attempt = 0; ; attempt++) try { return await withKernelLock(join(this.appData, 'web-events.lock'), 'web-events', async () => { await this.init(); return action(); }); }
      catch (error) { if (attempt >= 99 || !(error instanceof ValidationFailure) || !error.diagnostics.some(value => value.code === 'WORKTREE_BUSY')) throw error; await new Promise(resolve => setTimeout(resolve, 10)); }
    }); this.tail = next.then(() => {}, () => {}); return next;
  }
  publish(projectId: string, type: string, runId?: string): Promise<void> {
    return this.enqueue(async () => { if (!Number.isSafeInteger(this.sequence + 1)) throw Error('EVENT_SEQUENCE_LIMIT'); const event = { sequence: this.sequence + 1, projectId, type, ...(runId ? { runId } : {}) }, events = [...this.events, event].slice(-200); await atomicText(this.appData, join(this.appData, 'web-events.json'), JSON.stringify({ version: 1, sequence: event.sequence, events })); this.sequence = event.sequence; this.events = events; for (const listener of this.listeners) { try { listener(event); } catch { this.listeners.delete(listener); } } });
  }
  subscribe(projectId: string, cursor: number, listener: (event: WorkspaceEvent) => void): Promise<() => void> {
    return this.enqueue(async () => {
      const scoped = (event: WorkspaceEvent) => { if (event.projectId === projectId) listener(event); }; this.listeners.add(scoped);
      if (cursor > this.sequence || cursor < (this.events[0]?.sequence ?? 1) - 1 || cursor === 0) listener({ sequence: this.sequence, projectId, type: 'sync.required' });
      else for (const event of this.events) if (event.sequence > cursor) scoped(event);
      return () => { this.listeners.delete(scoped); };
    });
  }
  watch(projectId: string, root: string, selectedRef: string | null) {
    if (this.watchers.has(projectId)) return;
    const hint = () => { clearTimeout(this.timers.get(projectId)); this.timers.set(projectId, setTimeout(() => { this.timers.delete(projectId); void this.publish(projectId, 'project.changed').catch(() => {}); }, 300)); };
    try { const watcher = watch(root, { recursive: true }, (_event, filename) => { const path = filename?.toString().replaceAll('\\', '/'); if (path && (isCanonicalPath(path) || path === '.git/HEAD' || path === '.git/index' || path === '.git/' + selectedRef)) hint(); }); watcher.on('error', hint); this.watchers.set(projectId, watcher); } catch { hint(); }
  }
  async close() { for (const watcher of this.watchers.values()) watcher.close(); for (const timer of this.timers.values()) clearTimeout(timer); this.watchers.clear(); this.timers.clear(); this.listeners.clear(); await this.tail.catch(() => {}); }
}
export function registerEventRoute(app: FastifyInstance, events: WorkspaceEvents, authorize: (id: string) => void) {
  const clients = new Set<() => void>();
  app.get<{ Querystring: { projectId: string; cursor?: string } }>('/api/events', { schema: { querystring: { type: 'object', additionalProperties: false, required: ['projectId'], properties: { projectId: { type: 'string', pattern: '^reg_[a-f0-9-]+$' }, cursor: { type: 'string', pattern: '^(0|[1-9][0-9]{0,14})$' } } } } }, async (request, reply) => {
    authorize(request.query.projectId);
    reply.hijack(); reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Connection': 'keep-alive' });
    const send = (event: WorkspaceEvent) => { if (reply.raw.writableLength > 65536) reply.raw.destroy(); if (!reply.raw.destroyed) reply.raw.write(`id: ${event.sequence}\nevent: workspace\ndata: ${JSON.stringify(event)}\n\n`); };
    const unsubscribe = await events.subscribe(request.query.projectId, Number(request.query.cursor ?? 0), send), heartbeat = setInterval(() => { if (!reply.raw.destroyed) reply.raw.write(': heartbeat\n\n'); }, 15000);
    if (reply.raw.destroyed) { clearInterval(heartbeat); unsubscribe(); return reply; }
    const close = () => { clearInterval(heartbeat); unsubscribe(); clients.delete(close); reply.raw.end(); }; clients.add(close); reply.raw.on('close', close);
    return reply;
  });
  app.addHook('preClose', async () => { for (const close of [...clients]) close(); });
}
