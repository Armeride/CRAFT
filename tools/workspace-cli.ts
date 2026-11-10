import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ValidationFailure } from '../packages/domain/src/model.js';
import { TaskService } from '../packages/tasks/src/service.js';
import { cloneProject, getRegistration, registerLocal, relocateRegistration } from '../packages/tasks/src/projects.js';
import { discoverTasks } from '../packages/tasks/src/discovery.js';
import { importDocuments } from '../packages/tasks/src/import.js';
import { parseYaml } from '../packages/project-fs/src/yaml.js';

const commands: Record<string, string[]> = {
  open: ['root'], clone: ['url', 'fixture-bare'], tasks: ['registration'], start: ['registration', 'goal', 'title', 'baseline', 'target-ref', 'selection'],
  status: ['run'], fake: ['run', 'entity', 'body-file'], save: ['run', 'file', 'body-file', 'expected-digest'], checkpoint: ['run'], cancel: ['run'], recover: ['run'], clean: ['run'],
  resume: ['registration', 'task', 'ref', 'commit'], import: ['registration', 'selection', 'name'], integration: ['registration', 'result-commit', 'target-ref'], relocate: ['registration', 'root'],
};
try {
  const [command, ...args] = process.argv.slice(2);
  if (!command || !Object.hasOwn(commands, command)) throw new Error(`Usage: workspace-cli ${Object.keys(commands).join('|')} --app-data <directory> [options]`);
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]!, value = args[index + 1];
    if (!['app-data', ...commands[command]!].some(name => flag === '--' + name) || value === undefined || value.startsWith('--') || flags.has(flag)) throw new Error(`Invalid/duplicate option ${flag}`);
    flags.set(flag, value);
  }
  const required = (name: string): string => { const value = flags.get('--' + name); if (!value) throw new Error(`--${name} is required`); return value; };
  const selection = async (): Promise<string[]> => {
    const path = required('selection'), text = await readFile(path, 'utf8'); parseYaml(text, path);
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) throw new Error('--selection requires a JSON array of project-relative paths');
    return value as string[];
  };
  const appData = resolve(required('app-data')), service = new TaskService(appData);
  let result: unknown;
  switch (command) {
    case 'open': result = await registerLocal(appData, required('root')); break;
    case 'clone': {
      if (flags.has('--fixture-bare') && required('fixture-bare') !== 'true') throw new Error('--fixture-bare must be true and is limited to a local bare fixture');
      result = await cloneProject(appData, required('url'), flags.has('--fixture-bare')); break;
    }
    case 'tasks': { const registration = await getRegistration(appData, required('registration')); result = registration.projectId ? await discoverTasks(registration.root, registration.projectId) : []; break; }
    case 'start': result = await service.start(required('registration'), { goal: required('goal'), ...(flags.has('--title') ? { title: required('title') } : {}), ...(flags.has('--baseline') ? { baselineId: required('baseline') } : {}), ...(flags.has('--target-ref') ? { targetRef: required('target-ref') } : {}), ...(flags.has('--selection') ? { includeWorkingPaths: await selection() } : {}) }); break;
    case 'status': result = (await service.run(required('run'), false)).run; break;
    case 'fake': {
      const run = await service.fakeDraft(required('run'), { entityId: required('entity'), body: await readFile(required('body-file'), 'utf8') });
      result = run; if (run.status === 'failed' || run.workspaceState === 'recovering') process.exitCode = 1; break;
    }
    case 'save': { const digest = required('expected-digest'); if (digest !== 'null' && !/^[a-f0-9]{64}$/.test(digest)) throw new Error('Expected SHA-256 digest or null'); await service.saveDraft(required('run'), required('file'), await readFile(required('body-file'), 'utf8'), digest === 'null' ? null : digest); result = { saved: true }; break; }
    case 'checkpoint': result = await service.checkpoint(required('run')); break;
    case 'cancel': result = await service.cancel(required('run')); break;
    case 'recover': result = await service.recover(required('run')); break;
    case 'clean': await service.cleanup(required('run')); result = { removedWorktree: true, branchRetained: true }; break;
    case 'resume': result = await service.resume(required('registration'), required('task'), required('ref'), required('commit')); break;
    case 'import': result = await importDocuments(appData, required('registration'), await selection(), flags.get('--name')); break;
    case 'integration': result = await service.prepareIntegration(required('registration'), required('result-commit'), flags.get('--target-ref')); break;
    case 'relocate': result = await relocateRegistration(appData, required('registration'), required('root')); break;
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify(error instanceof ValidationFailure ? { diagnostics: error.diagnostics } : { error: String(error) }, null, 2));
  process.exitCode = 1;
}
