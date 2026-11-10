import { describe, expect, it } from 'vitest';
import { ValidationFailure } from '../../domain/src/model.js';
import { parseYaml, serializeYaml } from './yaml.js';

describe('safe YAML contract (AT-50)', () => {
  it.each([
    ['duplicate key', 'title: 하나\ntitle: 둘\n'],
    ['alias', 'value: *missing\n'],
    ['anchor', 'value: &shared hello\n'],
    ['custom tag', 'value: !custom hello\n'],
    ['explicit tag', 'value: !!str 123\n'],
    ['merge', 'value: { <<: { a: 1 } }\n'],
    ['non-string key', '? [a, b]\n: value\n'],
    ['infinity', 'value: .inf\n'],
    ['NaN', 'value: .nan\n'],
    ['integer loss', 'value: 9007199254740993\n'],
    ['multiple documents', 'value: one\n---\nvalue: two\n'],
    ['old YAML directive', '%YAML 1.1\n---\nvalue: yes\n'],
  ])('rejects %s with a file and location', (_name, text) => {
    try {
      parseYaml(text, 'unsafe.yaml');
      expect.fail('Unsafe YAML was accepted');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationFailure);
      const diagnostic = (error as ValidationFailure).diagnostics[0]!;
      expect(diagnostic.path).toBe('unsafe.yaml');
      expect(diagnostic.line).toBeGreaterThanOrEqual(1);
      expect(diagnostic.column).toBeGreaterThanOrEqual(1);
      expect(diagnostic.code).toMatch(/^YAML_/);
    }
  });

  it('preserves strings, safe numbers, null/false, Unicode and literal dates', () => {
    const source = parseYaml('title: 한국어 🎮\ndate: 2026-11-10\nitems: [0, false, null, 1.25]\n', 'safe.yaml');
    expect(source.value).toEqual({ title: '한국어 🎮', date: '2026-11-10', items: [0, false, null, 1.25] });
  });

  it('reports the exact duplicate-key and nested value line', () => {
    expect(() => parseYaml('a: 1\na: 2\n', 'duplicate.yaml')).toThrow(/duplicate.yaml:2:1/);
    const parsed = parseYaml('outer:\n  title: hello\n', 'nested.yaml');
    expect(parsed.position('/outer/title')).toEqual({ line: 2, column: 10 });
    expect(parsed.position('/outer/missing')).toEqual({ line: 2, column: 3 });
  });

  it('rejects byte/depth/node overflow', () => {
    expect(() => parseYaml('a: 글', 'size.yaml', { maxBytes: 4, maxDepth: 10, maxNodes: 100 })).toThrow(/YAML_SIZE_LIMIT/);
    expect(() => parseYaml('a: { b: { c: 1 } }', 'depth.yaml', { maxBytes: 100, maxDepth: 2, maxNodes: 100 })).toThrow(/YAML_COMPLEXITY_LIMIT/);
    expect(() => parseYaml('[1, 2, 3]', 'nodes.yaml', { maxBytes: 100, maxDepth: 10, maxNodes: 2 })).toThrow(/YAML_COMPLEXITY_LIMIT/);
  });

  it('does not mutate prototypes when a source contains __proto__', () => {
    const parsed = parseYaml('__proto__: { polluted: true }\n', 'prototype.yaml');
    expect(Object.getPrototypeOf(parsed.value)).toBe(null);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(serializeYaml(parsed.value, parsed)).toBe(parsed.text);
  });

  it('round-trips unchanged source bytes, including comments and CRLF', () => {
    const text = '# 원문\r\ntitle: "문서"\r\narray: [b, a]\r\n';
    const parsed = parseYaml(text, 'round-trip.yaml');
    expect(serializeYaml(parsed.value, parsed)).toBe(text);
  });

  it('serializes changed JSON data deterministically with LF and without anchors', () => {
    const one = serializeYaml({ z: '문서', a: [1, false] });
    const two = serializeYaml({ a: [1, false], z: '문서' });
    expect(one).toBe(two);
    expect(one).not.toContain('\r');
    expect(one.endsWith('\n')).toBe(true);
    expect(parseYaml(one, 'written.yaml').value).toEqual({ a: [1, false], z: '문서' });
    expect(() => serializeYaml({ value: NaN })).toThrow(/NON_JSON_VALUE/);
  });
});
