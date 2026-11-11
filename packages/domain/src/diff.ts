import { canonicalJson } from './canonical.js';
import type { RevisionRecord } from './model.js';

export function revisionDiff(before: RevisionRecord, after: RevisionRecord) {
  const fields: { pointer: string; before?: unknown; after?: unknown }[] = [];
  const walk = (a: unknown, b: unknown, pointer: string): void => {
    if (a !== undefined && b !== undefined && canonicalJson(a) === canonicalJson(b)) return;
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], pointer + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1'));
    } else fields.push({ pointer, ...(a === undefined ? {} : { before: a }), ...(b === undefined ? {} : { after: b }) });
  };
  walk(before.meta, after.meta, '');
  const a = before.body.split('\n'), b = after.body.split('\n'); let prefix = 0, suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const refsA = new Map(before.references.map(r => [r.value.reference_id, r.value])), refsB = new Map(after.references.map(r => [r.value.reference_id, r.value]));
  return { fields, body: { changed: before.body !== after.body, before: before.body, after: after.body, hunk: { startLine: prefix + 1, removed: a.slice(prefix, a.length - suffix), added: b.slice(prefix, b.length - suffix) } }, references: [...new Set([...refsA.keys(), ...refsB.keys()])].sort().flatMap(id => canonicalJson(refsA.get(id) ?? null) === canonicalJson(refsB.get(id) ?? null) ? [] : [{ referenceId: id, before: refsA.get(id) ?? null, after: refsB.get(id) ?? null }]) };
}
