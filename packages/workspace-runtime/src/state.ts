import { lstat, mkdir, open, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import schema from '../schemas/runtime-v1.schema.json' with { type: 'json' };
import { SchemaValidator } from '../../schema/src/index.js';
import { ValidationFailure } from '../../domain/src/model.js';
import { measured } from '../../domain/src/instrumentation.js';
import { assertOwnedPath } from '../../git-workspace/src/worktree.js';
import { newId } from '../../project-fs/src/files.js';
import { parseYaml, YAML_LIMITS } from '../../project-fs/src/yaml.js';
import { renameWithRetry } from '../../git-workspace/src/fs.js';

const validator = new SchemaValidator(schema, schema.$id);
const stateLimits = (definition: string) => definition === 'Transaction' ? { ...YAML_LIMITS, maxBytes: 64 * 1024 * 1024, maxNodes: 1_000_000 } : YAML_LIMITS;
export function validateState(definition: string, value: unknown, path: string): void {
  const errors = validator.validate(definition, value, path);
  if (errors.length) throw new ValidationFailure(errors);
}
/** Counted as `state.write.<definition>` (units: bytes). */
export function writeState(appRoot: string, path: string, definition: string, value: unknown): Promise<void> {
  return measured(`state.write.${definition}`, async () => {
    validateState(definition, value, path);
    const text = JSON.stringify(value, null, 2) + '\n';
    const bytes = Buffer.byteLength(text);
    if (bytes > stateLimits(definition).maxBytes) throw new Error('RUNTIME_STATE_SIZE_LIMIT');
    parseYaml(text, path, stateLimits(definition));
    await atomicText(appRoot, path, text);
    return bytes;
  }, bytes => bytes).then(() => undefined);
}
export async function atomicText(root: string, path: string, text: string): Promise<void> {
  return atomicBytes(root, path, Buffer.from(text, 'utf8'));
}
export async function atomicBytes(root: string, path: string, bytes: Uint8Array): Promise<void> {
  const owned = await assertOwnedPath(root, path);
  await mkdir(dirname(owned), { recursive: true });
  const temporary = `${owned}.${newId('tmp')}`;
  const handle = await open(temporary, 'wx');
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await renameWithRetry(temporary, owned);
}
/** Counted as `state.read.<definition>` (units: bytes). */
export async function readState<T>(root: string, path: string, definition: string): Promise<T> {
  const { value } = await measured(`state.read.${definition}`, async () => {
    const owned = await assertOwnedPath(root, path);
    if ((await lstat(owned)).size > stateLimits(definition).maxBytes) throw new Error('RUNTIME_STATE_SIZE_LIMIT');
    const text = await readFile(owned, 'utf8');
    parseYaml(text, path, stateLimits(definition));
    const parsed: unknown = JSON.parse(text);
    validateState(definition, parsed, path);
    return { value: parsed, bytes: Buffer.byteLength(text) };
  }, result => result.bytes);
  return value as T;
}
