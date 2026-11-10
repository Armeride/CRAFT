import { canonicalJson } from '../../domain/src/canonical.js';
import type { SourceFile } from '../../domain/src/model.js';
import { fileFailure, hash } from '../../project-fs/src/files.js';
import { parseYaml, serializeYaml } from '../../project-fs/src/yaml.js';

export function textFile(path: string, text: string): SourceFile {
  return { path, text, digest: hash(text), contentBase64: Buffer.from(text, 'utf8').toString('base64') };
}
export function objectFile(path: string, value: unknown): SourceFile {
  return textFile(path, path.endsWith('.json') ? JSON.stringify(JSON.parse(canonicalJson(value)), null, 2) + '\n' : serializeYaml(value));
}
/** Call only after the owning codec has structurally validated the source file. */
export function rawObject<T>(files: ReadonlyMap<string, SourceFile>, path: string): T {
  const source = files.get(path);
  if (source?.text === undefined) throw fileFailure('FILE_MISSING', 'Expected a UTF-8 record', path);
  return parseYaml(source.text, path).value as T;
}
