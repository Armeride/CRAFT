import { readFile } from 'node:fs/promises';
import { ValidationFailure } from '../packages/domain/src/model.js';
import { repositoryGuard } from '../packages/git-workspace/src/worktree.js';
import { readCommittedFiles } from '../packages/project-fs/src/git-baseline.js';
import { parseYaml } from '../packages/project-fs/src/yaml.js';
import { createProductionRegistry } from '../packages/migrations/src/registry.js';
import { startMigration, resumeMigration } from '../packages/migrations/src/engine.js';
import { validateAudit } from '../packages/migrations/src/audit.js';
import type { DecisionMap } from '../packages/migrations/src/types.js';

try {
  const [command, ...arguments_] = process.argv.slice(2);
  if (!['support', 'plan', 'run', 'resume'].includes(command ?? '')) throw new Error('Usage: migration-cli support|plan|run|resume --registry production|fixture --root <repo> --target-core <n> --managed-root <dir> [--run-id <id>] [--answers <json>]');
  const flags = new Map<string, string>();
  const allowed = new Set(['--registry', '--root', '--target-core', '--managed-root', '--run-id', '--answers']);
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index]!;
    const value = arguments_[index + 1];
    if (!allowed.has(name) || !value || value.startsWith('--') || flags.has(name)) throw new Error(`Invalid/duplicate option ${name}`);
    flags.set(name, value);
  }
  const registryName = flags.get('--registry') ?? 'production';
  if (!['production', 'fixture'].includes(registryName)) throw new Error('Only app-registered production/fixture registries are supported');
  // Import the test registry only after its explicit selection.
  const registry = registryName === 'fixture' ? await (await import('../packages/migrations/src/fixture-registry.js')).createFixtureRegistry() : createProductionRegistry();
  if (command === 'support') console.log(JSON.stringify(registry.supportTable(), null, 2));
  else {
    const root = flags.get('--root');
    if (!root) throw new Error('--root is required');
    let decisions: DecisionMap = {};
    if (flags.has('--answers')) {
      const path = flags.get('--answers')!;
      const text = await readFile(path, 'utf8');
      parseYaml(text, path);
      decisions = JSON.parse(text) as DecisionMap;
      validateAudit('Answers', decisions, path);
    }
    if (command === 'plan') {
      const target = Number(flags.get('--target-core'));
      if (!Number.isSafeInteger(target) || target < 1) throw new Error('--target-core must be a positive integer');
      const source = await repositoryGuard(root);
      const plan = await registry.preflight(registry.read(await readCommittedFiles(source.root, source.commit, false)), { core: target });
      validateAudit('Plan', plan, 'preflight');
      console.log(JSON.stringify(plan, null, 2));
    } else {
      const managedRoot = flags.get('--managed-root');
      if (!managedRoot) throw new Error('--managed-root is required');
      const common = { repositoryRoot: root, managedRoot, registry, decisions };
      let result;
      if (command === 'resume') {
        const runId = flags.get('--run-id');
        if (!runId) throw new Error('--run-id is required');
        result = await resumeMigration({ ...common, runId });
      } else {
        const target = Number(flags.get('--target-core'));
        if (!Number.isSafeInteger(target) || target < 1) throw new Error('--target-core must be a positive integer');
        result = await startMigration({ ...common, target: { core: target } });
      }
      const { report, ...summary } = result;
      console.log(JSON.stringify({ ...summary, ...(report ? { reportPath: `${result.runDirectory}/report.json`, verification: { schema: report.schemaValid, references: report.referencesValid, semantics: report.semanticChecksPassed } } : {}) }, null, 2));
      process.exitCode = result.state === 'completed' || result.state === 'noop' ? 0 : result.state === 'waiting_for_decision' ? 3 : 1;
    }
  }
} catch (error) {
  console.error(JSON.stringify(error instanceof ValidationFailure ? { diagnostics: error.diagnostics } : { error: String(error) }, null, 2));
  process.exitCode = 1;
}
