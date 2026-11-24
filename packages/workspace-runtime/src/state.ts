import { lstat, mkdir, open, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import schema from '../schemas/runtime-v1.schema.json' with { type: 'json' };
import { SchemaValidator } from '../../schema/src/index.js';
import { ValidationFailure } from '../../domain/src/model.js';
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
export async function writeState(appRoot: string, path: string, definition: string, value: unknown): Promise<void> {
  validateState(definition, value, path);
  const text = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(text) > stateLimits(definition).maxBytes) throw new Error('RUNTIME_STATE_SIZE_LIMIT');
  parseYaml(text, path, stateLimits(definition));
  await atomicText(appRoot, path, text);
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
export async function readState<T>(root: string, path: string, definition: string): Promise<T> {
  const owned = await assertOwnedPath(root, path);
  if ((await lstat(owned)).size > stateLimits(definition).maxBytes) throw new Error('RUNTIME_STATE_SIZE_LIMIT');
  const text = await readFile(owned, 'utf8');
  parseYaml(text, path, stateLimits(definition));
  const value: unknown = JSON.parse(text);
  validateState(definition, value, path);
  return value as T;
}
