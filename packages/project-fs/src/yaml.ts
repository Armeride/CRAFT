import { isAlias, isMap, isScalar, isSeq, LineCounter, parseDocument, stringify } from 'yaml';
import type { Node } from 'yaml';
import type { JsonValue } from '../../schema/src/generated.js';
import { canonicalJson } from '../../domain/src/canonical.js';
import { ValidationFailure } from '../../domain/src/model.js';
import type { Diagnostic } from '../../domain/src/model.js';

export const YAML_LIMITS = { maxBytes: 2 * 1024 * 1024, maxDepth: 64, maxNodes: 100_000 } as const;
export const pointerEscape = (key: string): string => key.replace(/~/g, '~0').replace(/\//g, '~1');

export interface ParsedSource {
  readonly value: JsonValue;
  readonly text: string;
  position(pointer: string): { line: number; column: number };
}

export function parseYaml(text: string, path: string, limits: { maxBytes: number; maxDepth: number; maxNodes: number } = YAML_LIMITS): ParsedSource {
  const counter = new LineCounter();
  const positions = new Map<string, number>();
  function fail(code: string, message: string, offset = 0, pointer = ''): never {
    const pos = counter.linePos(offset);
    throw new ValidationFailure([{ code, message, path, pointer, severity: 'error', line: pos.line, column: pos.col }]);
  }
  if (Buffer.byteLength(text, 'utf8') > limits.maxBytes) fail('YAML_SIZE_LIMIT', 'YAML exceeds the byte limit');
  let document;
  try {
    document = parseDocument(text, { version: '1.2', schema: 'core', uniqueKeys: true, merge: false, intAsBigInt: true, lineCounter: counter, keepSourceTokens: true });
  } catch (error) {
    return fail('YAML_PARSE', String(error));
  }
  const error = document.errors[0] ?? document.warnings[0];
  if (error) fail(`YAML_${error.code}`, error.message, error.pos[0]);
  if (document.directives?.yaml.version !== '1.2' || Object.keys(document.directives?.tags ?? {}).some(key => key !== '!!')) fail('YAML_DIRECTIVE', 'Only YAML 1.2 without custom directives is supported');
  let count = 0;
  const convert = (node: unknown, pointer: string, depth: number): JsonValue => {
    const ast = node as Node | null;
    const offset = ast?.range?.[0] ?? 0;
    positions.set(pointer, offset);
    if (depth > limits.maxDepth || ++count > limits.maxNodes) fail('YAML_COMPLEXITY_LIMIT', 'YAML exceeds the depth or node limit', offset, pointer);
    if (ast === null) return null;
    if (isAlias(ast)) fail('YAML_ALIAS_FORBIDDEN', 'Aliases are not supported', offset, pointer);
    if (ast.tag) fail('YAML_TAG_FORBIDDEN', 'Explicit tags are not supported', offset, pointer);
    if ('anchor' in ast && ast.anchor) fail('YAML_ANCHOR_FORBIDDEN', 'Anchors are not supported', offset, pointer);
    if (isSeq(ast)) return ast.items.map((item, index) => convert(item, `${pointer}/${index}`, depth + 1));
    if (isMap(ast)) {
      const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
      for (const pair of ast.items) {
        if (!isScalar(pair.key) || typeof pair.key.value !== 'string') fail('YAML_KEY_NOT_STRING', 'Mapping keys must be strings', offset, pointer);
        const key = pair.key.value;
        if (key === '<<') fail('YAML_MERGE_FORBIDDEN', 'Merge keys are not supported', pair.key.range?.[0] ?? offset, pointer);
        result[key] = convert(pair.value, `${pointer}/${pointerEscape(key)}`, depth + 1);
      }
      return result;
    }
    if (isScalar(ast)) {
      const value: unknown = ast.value;
      if (typeof value === 'bigint') {
        if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) fail('YAML_UNSAFE_INTEGER', 'Integer cannot be represented without loss', offset, pointer);
        return Number(value);
      }
      if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) fail('YAML_NON_JSON_NUMBER', 'Only finite, lossless JSON numbers are supported', offset, pointer);
      if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value;
    }
    return fail('YAML_NON_JSON_VALUE', 'Unsupported YAML value', offset, pointer);
  };
  const value = convert(document.contents, '', 0);
  return {
    value,
    text,
    position(pointer) {
      let candidate = pointer;
      while (!positions.has(candidate) && candidate) candidate = candidate.slice(0, candidate.lastIndexOf('/'));
      const pos = counter.linePos(positions.get(candidate) ?? 0);
      return { line: pos.line, column: pos.col };
    },
  };
}

/** Keep original bytes (including comments/CRLF) if nothing changed. Never write on read. */
export function serializeYaml(value: unknown, original?: ParsedSource): string {
  const canonical = canonicalJson(value);
  if (original && canonical === canonicalJson(original.value)) return original.text;
  return stringify(JSON.parse(canonical), { version: '1.2', sortMapEntries: true, lineWidth: 0, aliasDuplicateObjects: false }).replace(/\r\n?/g, '\n');
}

export function locateDiagnostics(diagnostics: readonly Diagnostic[], sources: ReadonlyMap<string, ParsedSource>): Diagnostic[] {
  return diagnostics.map(d => ({ ...d, ...sources.get(d.path)?.position(d.pointer) }));
}
