import type { Session } from '../../server/contracts.js';
import type { QueryEnvelope } from '../../../packages/indexer/src/types.js';
let csrf = '';
let renewal: Promise<void> | undefined;
export class ApiError extends Error { constructor(readonly code: string, readonly details: unknown) { super(code); } }
async function request<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const tracked = method === 'POST' && /^\/api\/(?:library\/(?:clone|import)|projects\/[^/]+\/(?:drafts|tasks|resume|migration)|runs\/[^/]+\/(?:conflict-resolution|agents)|agent-executions\/[^/]+\/fork)$/.test(path);
  const identityKey = tracked ? 'craft.pending-command:' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(method + path + JSON.stringify(body))))).map(value => value.toString(16).padStart(2, '0')).join('') : '';
  const identity = identityKey ? stored(identityKey) ?? crypto.randomUUID() : '';
  if (identityKey) remember(identityKey, identity);
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(path, { method, credentials: 'same-origin', headers: { ...(identity ? { 'X-Craft-Request-ID': identity } : {}), ...(csrf ? { 'X-Craft-CSRF': csrf } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json();
    // AUTH_REQUIRED is returned by the local pre-handler before any operation.
    // Network errors or ambiguous write outcomes are never retried automatically.
    if (response.status === 401 && value.code === 'AUTH_REQUIRED' && path !== '/api/session' && attempt === 0) { if (!renewal) renewal = session().then(() => {}).finally(() => { renewal = undefined; }); await renewal; continue; }
    if (!response.ok) throw new ApiError(value.code ?? 'REQUEST_FAILED', value.details); if (identityKey) { try { localStorage.removeItem(identityKey); } catch {} } return value as T;
  }
  throw new ApiError('AUTH_REQUIRED', {});
}
const runTails = new Map<string, Promise<unknown>>();
export function api<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const run = /^\/api\/runs\/([^/]+)\//.exec(path)?.[1];
  if (!run) return request<T>(path, body, method);
  const next = (runTails.get(run) ?? Promise.resolve()).catch(() => {}).then(() => request<T>(path, body, method));
  runTails.set(run, next); void next.finally(() => { if (runTails.get(run) === next) runTails.delete(run); }).catch(() => {}); return next;
}
export function runCommand<T>(runId: string, action: (send: typeof request) => Promise<T>): Promise<T> {
  const next = (runTails.get(runId) ?? Promise.resolve()).catch(() => {}).then(() => action(request)); runTails.set(runId, next); void next.finally(() => { if (runTails.get(runId) === next) runTails.delete(runId); }).catch(() => {}); return next;
}
export async function eventResponse(projectId: string, cursor: number, signal: AbortSignal): Promise<Response> {
  const headers = { 'X-Craft-CSRF': csrf }, url = '/api/events?projectId=' + encodeURIComponent(projectId) + '&cursor=' + cursor;
  let response = await fetch(url, { headers, credentials: 'same-origin', signal });
  if (response.status === 401) { await session(); response = await fetch(url, { headers: { 'X-Craft-CSRF': csrf }, credentials: 'same-origin', signal }); }
  if (!response.ok) throw new ApiError('EVENT_CONNECTION_FAILED', {}); return response;
}
export async function session() { const value = await api<Session>('/api/session'); csrf = value.csrf; return value; }
export const query = <T>(project: string, operation: string, args: Record<string, unknown> = {}, baselineId?: string) => api<QueryEnvelope<T>>(`/api/projects/${encodeURIComponent(project)}/query`, { operation, args, ...(baselineId ? { baselineId } : {}) });
export function stored(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
export function remember(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* local preferences are optional */ } }
