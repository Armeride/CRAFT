import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson } from '../../packages/domain/src/canonical.js';
import { fileFailure, hash } from '../../packages/project-fs/src/files.js';
import { parseYaml } from '../../packages/project-fs/src/yaml.js';
import { atomicText } from '../../packages/workspace-runtime/src/state.js';
import { assertOwnedPath } from '../../packages/git-workspace/src/worktree.js';
import { withKernelLock } from '../../packages/git-workspace/src/locks.js';
export class HttpCommands {
  constructor(readonly appData: string) {}
  async execute<T>(identity: unknown, scope: string, input: unknown, action: () => Promise<T>): Promise<T> {
    if (typeof identity !== 'string' || !/^[a-f0-9-]{36}$/.test(identity)) throw fileFailure('REQUEST_INVALID', 'An idempotency UUID is required', 'project.yaml');
    const command = join(this.appData, 'http-commands', identity + '.json');
    const lock = await assertOwnedPath(this.appData, command + '.lock');
    const digest = hash(canonicalJson({ scope, input }));
    return withKernelLock(lock, `http-command:${identity}`, async () => {
      const path = await assertOwnedPath(this.appData, command);
      try { const previous = parseYaml(await readFile(path, 'utf8'), path).value as unknown as { version: number; digest: string; state: string; result: T }; if (previous.version !== 1 || previous.digest !== digest) throw fileFailure('REQUEST_ID_REUSED', 'Request UUID has different content', 'project.yaml'); if (previous.state !== 'completed') throw fileFailure('COMMAND_OUTCOME_UNKNOWN', 'Inspect the preserved result before retrying', 'project.yaml'); return previous.result; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await atomicText(this.appData, path, JSON.stringify({ version: 1, digest, state: 'pending' }));
      const result = await action();
      await atomicText(this.appData, path, JSON.stringify({ version: 1, digest, state: 'completed', result })); return result;
    });
  }
}
