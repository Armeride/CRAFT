import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { fileFailure } from '../../project-fs/src/files.js';

export interface GitOutput { stdout: Buffer; stderr: string }
const gitEnvironment = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('GIT_')) delete env[key];
  env['GIT_OPTIONAL_LOCKS'] = '0';
  return env;
};

async function invoke(root: string, args: readonly string[], input?: Uint8Array, extraEnv?: NodeJS.ProcessEnv, allowNoMatch = false): Promise<GitOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', root, '-c', `safe.directory=${root}`, ...args], { shell: false, windowsHide: true, env: { ...gitEnvironment(), ...extraEnv }, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = '';
    child.on('error', reject);
    child.stdin.on('error', reject);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 32 * 1024 * 1024) { child.kill(); reject(fileFailure('GIT_OUTPUT_LIMIT', 'Git output exceeds limit', 'project.yaml')); }
      else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => { if (stderr.length < 16384) stderr += chunk.toString('utf8'); });
    child.on('close', code => code === 0 || (allowNoMatch && code === 1) ? resolve({ stdout: Buffer.concat(chunks), stderr }) : reject(fileFailure('GIT_COMMAND_FAILED', `${args[0] ?? 'git'} failed: ${stderr.trim()}`, 'project.yaml')));
    child.stdin.end(input);
  });
}

/** No shell, hooks, fsmonitor or configured clean/smudge/process executables. */
export async function runGit(root: string, args: readonly string[], input?: Uint8Array, extraEnv?: NodeJS.ProcessEnv): Promise<GitOutput> {
  const absolute = await realpath(root);
  // Only exit 1 (no matching variables) is allowed; malformed config must fail closed.
  // These builtins do not convert working-file content. Other commands retain the
  // filter discovery/override guard; metadata reads still disable hooks and fsmonitor.
  const metadataOnly = args[0] === 'rev-parse' || args[0] === 'symbolic-ref';
  const configured = metadataOnly ? undefined : await invoke(absolute, ['config', '--null', '--name-only', '--get-regexp', '^filter\\..*\\.(clean|smudge|process|required)$'], undefined, undefined, true);
  const keys = configured?.stdout.toString('utf8').split('\0').filter(Boolean) ?? [];
  const options = ['-c', 'core.hooksPath=NUL', '-c', 'core.fsmonitor=false', '-c', 'core.autocrlf=false', '-c', 'commit.gpgSign=false', '-c', 'submodule.recurse=false'];
  for (const key of keys) options.push('-c', `${key}=${key.endsWith('.required') ? 'false' : ''}`);
  return invoke(absolute, [...options, ...args], input, extraEnv);
}

export const gitText = async (root: string, args: readonly string[], input?: Uint8Array): Promise<string> => (await runGit(root, args, input)).stdout.toString('utf8').trim();
