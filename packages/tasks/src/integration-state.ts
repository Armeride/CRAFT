import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertOwnedPath } from '../../git-workspace/src/worktree.js';
import { atomicText } from '../../workspace-runtime/src/state.js';
import { fileFailure } from '../../project-fs/src/files.js';
import { parseYaml } from '../../project-fs/src/yaml.js';
export interface IntegrationGuard { version: 1; operationId: string; runId: string; state: 'applying' | 'ready' }
function path(appData: string, registrationId: string) { if (!/^reg_[a-f0-9-]+$/.test(registrationId)) throw fileFailure('CONTEXT_FORBIDDEN', 'Invalid registration scope', 'project.yaml'); return join(appData, 'integration-guards', registrationId + '.json'); }
export async function readIntegrationGuard(appData: string, registrationId: string): Promise<IntegrationGuard | null> {
  const file = await assertOwnedPath(appData, path(appData, registrationId)); try { const value = parseYaml(await readFile(file, 'utf8'), file).value as unknown as IntegrationGuard; if (value.version !== 1 || !/^op_[a-f0-9-]{36}$/.test(value.operationId) || !/^run_[a-f0-9-]+$/.test(value.runId) || !['applying', 'ready'].includes(value.state)) throw fileFailure('RECOVERY_REQUIRED', 'Integration guard needs inspection', 'project.yaml'); return value; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
export async function writeIntegrationGuard(appData: string, registrationId: string, guard: IntegrationGuard): Promise<void> { await atomicText(appData, path(appData, registrationId), JSON.stringify(guard)); }
export async function assertIntegrationReady(appData: string, registrationId: string): Promise<void> { if ((await readIntegrationGuard(appData, registrationId))?.state === 'applying') throw fileFailure('RECOVERY_REQUIRED', 'Finish or restore the interrupted integration first', 'project.yaml'); }
