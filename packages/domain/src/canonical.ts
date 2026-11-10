import type { JsonValue, Scope } from '../../schema/src/generated.js';
import type { RevisionRecord } from './model.js';

/** Arrays keep their order unless the owning field explicitly defines set semantics. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  throw new Error('NON_JSON_VALUE');
}

export function normalizedScope(scope: Scope): Scope {
  return {
    continuity: scope.continuity ?? 'main',
    ...(scope.platform ? { platform: [...scope.platform].sort() } : {}),
    ...(scope.mode ? { mode: [...scope.mode].sort() } : {}),
  };
}

export function semanticRevision(record: RevisionRecord, kind: string): JsonValue {
  const { created_at: _at, created_by: _by, body_path: _path, ...meta } = record.meta;
  return JSON.parse(canonicalJson({
    semantic_model_version: 1,
    kind,
    ...meta,
    parents: [...meta.parents].sort(),
    aliases: [...(meta.aliases ?? [])].sort(),
    tags: [...(meta.tags ?? [])].sort(),
    scope: normalizedScope(meta.scope),
    references: [...meta.references].sort((a, b) => a.reference_id < b.reference_id ? -1 : a.reference_id > b.reference_id ? 1 : 0),
    body: record.body.replace(/\r\n?/g, '\n'),
  })) as JsonValue;
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
