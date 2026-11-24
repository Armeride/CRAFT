import { execFile, spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { promisify } from 'node:util';
import { isProjectPath } from '../../domain/src/path.js';
import { ValidationFailure } from '../../domain/src/model.js';
import type { ProjectSnapshot, SourceFile } from '../../domain/src/model.js';
import { checkImmutability } from './changes.js';
import { captureFiles, fileFailure, fingerprint, hash, isCanonicalPath, isProjectTextPath } from './files.js';
import { parseProject } from './project.js';

const exec = promisify(execFile);

/** Read-only Git adapter for immutable-record validation. No worktree/ref mutations. */
export async function readCommittedFiles(root: string, ref: string, canonicalOnly = true): Promise<ReadonlyMap<string, SourceFile>> {
  const absolute = await realpath(root);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('GIT_')) delete env[key];
  env['GIT_OPTIONAL_LOCKS'] = '0';
  const args = ['-C', absolute, '-c', `safe.directory=${absolute}`];
  const resolved = await exec('git', [...args, 'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { encoding: 'utf8', windowsHide: true, env });
  const commit = resolved.stdout.trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) throw fileFailure('GIT_INVALID_COMMIT', 'Git did not resolve a commit', 'project.yaml');
  const listing = await exec('git', [...args, 'ls-tree', '-r', '-z', '--full-tree', commit], { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024, env });
  const entries: { path: string; object: string }[] = [];
  for (const entry of listing.stdout.split('\0').filter(Boolean)) {
    const match = /^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(entry);
    if (!match) throw fileFailure('GIT_INVALID_TREE', 'Invalid Git tree record', 'project.yaml');
    const [, mode, type, object, path] = match;
    if (canonicalOnly && !isCanonicalPath(path!)) continue;
    if (!isProjectPath(path!) || !['100644', '100755'].includes(mode!) || type !== 'blob') throw fileFailure('PATH_SYMLINK', 'Canonical Git trees must contain regular project files', path!);
    entries.push({ path: path!, object: object! });
  }
  const output = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn('git', [...args, 'cat-file', '--batch'], { shell: false, windowsHide: true, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let size = 0;
    let error = '';
    child.on('error', reject);
    child.stdin.on('error', reject);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 256 * 1024 * 1024) { child.kill(); reject(fileFailure('SOURCE_SIZE_LIMIT', 'Git snapshot exceeds capture limit', 'project.yaml')); }
      else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => { if (error.length < 8192) error += chunk.toString('utf8'); });
    child.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(fileFailure('GIT_READ_FAILED', error, 'project.yaml')));
    child.stdin.end(entries.map(entry => entry.object).join('\n') + (entries.length ? '\n' : ''));
  });
  const files = new Map<string, SourceFile>();
  let cursor = 0;
  const portablePaths = new Set<string>();
  for (const entry of entries) {
    const newline = output.indexOf(10, cursor);
    const header = output.subarray(cursor, newline).toString('ascii');
    const match = /^([a-f0-9]+) blob (\d+)$/.exec(header);
    if (newline < 0 || !match || match[1] !== entry.object) throw fileFailure('GIT_INVALID_BLOB', 'Unexpected cat-file output', entry.path);
    const length = Number(match[2]);
    const end = newline + 1 + length;
    if (length > 32 * 1024 * 1024 || end >= output.length || output[end] !== 10) throw fileFailure('GIT_INVALID_BLOB', 'Invalid or oversized Git blob', entry.path);
    const bytes = output.subarray(newline + 1, end);
    const key = entry.path.normalize('NFC').toLowerCase();
    if (portablePaths.has(key)) throw fileFailure('PATH_COLLISION', 'Case/Unicode path collision in Git tree', entry.path);
    portablePaths.add(key);
    let text: string | undefined;
    if (isProjectTextPath(entry.path)) {
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { throw fileFailure('INVALID_UTF8', 'Canonical Git text is not valid UTF-8', entry.path); }
    }
    files.set(entry.path, { path: entry.path, contentBase64: bytes.toString('base64'), digest: hash(bytes), ...(text !== undefined ? { text } : {}) });
    cursor = end + 1;
  }
  return files;
}

export async function loadCommittedProject(root: string, ref: string): Promise<ProjectSnapshot> {
  return parseProject(await readCommittedFiles(root, ref));
}

export async function validateAgainstGit(root: string, ref: string): Promise<ProjectSnapshot> {
  const before = await loadCommittedProject(root, ref);
  const files = await captureFiles(root);
  const immutable = checkImmutability(before, { ...before, files });
  if (immutable.length) throw new ValidationFailure(immutable);
  const after = parseProject(files);
  const kindChanges = checkImmutability(before, after);
  if (kindChanges.length) throw new ValidationFailure(kindChanges);
  if (fingerprint(files) !== fingerprint(await captureFiles(root))) throw fileFailure('SOURCE_CHANGED', 'Project changed during Git comparison', 'project.yaml');
  return after;
}
