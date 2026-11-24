import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { canonicalJson } from '../../domain/src/canonical.js';
import { isProjectPath } from '../../domain/src/path.js';
import { ValidationFailure } from '../../domain/src/model.js';
import type { SourceFile } from '../../domain/src/model.js';

export const hash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
export const newId = (prefix: string): string => {
  if (!/^[a-z][a-z0-9]*$/.test(prefix)) throw new Error('INVALID_ID_PREFIX');
  return `${prefix}_${randomUUID()}`;
};
const roots = new Set(['entities', 'baselines', 'reviews', 'narrative', 'tasks', 'skills', 'integrations', 'schemas', 'migrations', 'assets']);
const rootFiles = new Set(['project.yaml', 'README.md', '.gitignore']);
export const isCanonicalPath = (path: string): boolean => rootFiles.has(path) || roots.has(path.split('/')[0]!);
export const FILE_LIMITS = { fileBytes: 32 * 1024 * 1024, totalBytes: 256 * 1024 * 1024, files: 100_000, depth: 64 } as const;
const limits = FILE_LIMITS;

export function fileFailure(code: string, message: string, path: string): ValidationFailure {
  return new ValidationFailure([{ code, message, path, pointer: '', severity: 'error', line: 1, column: 1 }]);
}

/** Read bytes through one open handle and check identity; never follow project symlinks. */
export async function readSource(root: string, path: string): Promise<SourceFile> {
  if (!isProjectPath(path) || path.split('/').some(part => part.toLowerCase() === '.git')) throw fileFailure('PATH_ESCAPE', 'Invalid portable relative path or Git metadata path', path);
  const absoluteRoot = await realpath(root);
  const absolute = resolve(absoluteRoot, ...path.split('/'));
  if (!absolute.startsWith(absoluteRoot + sep)) throw fileFailure('PATH_ESCAPE', 'Path is outside project', path);
  let current = absoluteRoot;
  for (const segment of path.split('/')) {
    current = join(current, segment);
    if ((await lstat(current)).isSymbolicLink()) throw fileFailure('PATH_SYMLINK', 'Project symlinks/junctions are not supported', path);
  }
  return readRegularSource(absolute, path);
}

async function readRegularSource(absolute: string, path: string, reserve?: (bytes: number) => void): Promise<SourceFile> {
  const before = await lstat(absolute);
  if (before.isSymbolicLink() || await realpath(absolute) !== absolute) throw fileFailure('PATH_SYMLINK', 'Project symlinks/junctions are not supported', path);
  if (!before.isFile() || before.size > limits.fileBytes) throw fileFailure('SOURCE_SIZE_LIMIT', 'Not a regular file or exceeds byte limit', path);
  reserve?.(before.size);
  const handle = await open(absolute, 'r');
  try {
    const opened = await handle.stat();
    if (opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size) throw fileFailure('SOURCE_CHANGED', 'Source identity changed during open', path);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const pathAfter = await lstat(absolute);
    if (bytes.byteLength !== opened.size || opened.size !== after.size || opened.mtimeMs !== after.mtimeMs || opened.ctimeMs !== after.ctimeMs || pathAfter.isSymbolicLink() || pathAfter.ino !== opened.ino || pathAfter.dev !== opened.dev || await realpath(absolute) !== absolute) throw fileFailure('SOURCE_CHANGED', 'Source changed while reading', path);
    let text: string | undefined;
    if (path !== 'assets' && !path.startsWith('assets/') && /\.(?:yaml|yml|json|md|txt)$/.test(path)) {
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { throw fileFailure('INVALID_UTF8', 'Canonical text is not valid UTF-8', path); }
    }
    return { path, contentBase64: bytes.toString('base64'), digest: hash(bytes), ...(text !== undefined ? { text } : {}) };
  } finally {
    await handle.close();
  }
}

export async function captureFiles(root: string, canonicalOnly = true): Promise<ReadonlyMap<string, SourceFile>> {
  const absoluteRoot = await realpath(root);
  const result = new Map<string, SourceFile>();
  const portablePaths = new Set<string>();
  const pending: { absolute: string; path: string }[] = [];
  let total = 0;
  const flush = async (): Promise<void> => {
    const batch = await Promise.all(pending.splice(0).map(({ absolute, path }) => readRegularSource(absolute, path, bytes => {
      total += bytes;
      if (total > limits.totalBytes) throw fileFailure('SOURCE_SIZE_LIMIT', 'Project exceeds capture limit', path);
    })));
    for (const file of batch) result.set(file.path, file);
  };
  const walk = async (directory: string, prefix: string, depth: number): Promise<void> => {
    if (depth > limits.depth) throw fileFailure('SOURCE_SIZE_LIMIT', 'Directory nesting exceeds limit', directory);
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      if (depth === 0 && entry.name.toLowerCase() === '.git') continue;
      if (canonicalOnly && depth === 0 && !(roots.has(entry.name) || rootFiles.has(entry.name))) continue;
      const absolute = join(directory, entry.name);
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.name.toLowerCase() === '.git') throw fileFailure('PATH_ESCAPE', 'Nested Git metadata is not canonical project data', path);
      if (!isProjectPath(path)) throw fileFailure('PATH_ESCAPE', 'Invalid portable path', path);
      const portable = path.normalize('NFC').toLowerCase();
      if (portablePaths.has(portable)) throw fileFailure('PATH_COLLISION', 'Case/Unicode path collision', path);
      portablePaths.add(portable);
      if (entry.isSymbolicLink()) throw fileFailure('PATH_SYMLINK', 'Project symlinks/junctions are not supported', path);
      if (entry.isDirectory()) await walk(absolute, path, depth + 1);
      else if (entry.isFile()) {
        if (result.size + pending.length >= limits.files) throw fileFailure('SOURCE_SIZE_LIMIT', 'Project exceeds capture limit', path);
        pending.push({ absolute, path });
        if (pending.length === 16) await flush();
      } else throw fileFailure('SOURCE_NOT_REGULAR', 'Special files are not supported', path);
    }
  };
  await walk(absoluteRoot, '', 0);
  await flush();
  return result;
}

export function fingerprint(files: ReadonlyMap<string, SourceFile>): string {
  return hash(canonicalJson([...files.values()].map(file => [file.path, file.digest]).sort((a, b) => a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0)));
}
