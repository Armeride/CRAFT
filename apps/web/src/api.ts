import type { Session } from '../../server/contracts.js';
import type { QueryEnvelope } from '../../../packages/indexer/src/types.js';
let csrf = '';
export class ApiError extends Error { constructor(readonly code: string, readonly details: unknown) { super(code); } }
export async function api<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const response = await fetch(path, { method, credentials: 'same-origin', headers: { ...(csrf ? { 'X-Craft-CSRF': csrf } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json(); if (!response.ok) throw new ApiError(value.code ?? 'REQUEST_FAILED', value.details); return value as T;
}
export async function session() { const value = await api<Session>('/api/session'); csrf = value.csrf; return value; }
export const query = <T>(project: string, operation: string, args: Record<string, unknown> = {}, baselineId?: string) => api<QueryEnvelope<T>>(`/api/projects/${encodeURIComponent(project)}/query`, { operation, args, ...(baselineId ? { baselineId } : {}) });
export function stored(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
export function remember(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* local preferences are optional */ } }
