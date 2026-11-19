import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ProjectIndex, IndexError } from '../packages/indexer/src/service.js';
import { ValidationFailure } from '../packages/domain/src/model.js';
import { readPerspective } from '../packages/domain/src/story.js';
import type { BaselineAnalysis, QueryScope } from '../packages/domain/src/analysis.js';
import { parseYaml } from '../packages/project-fs/src/yaml.js';
import { statePolicy, stateSupport } from '../packages/state-model/src/contracts.js';
import { statePlugin } from '../packages/project-fs/src/state-support.js';

const commands: Record<string, string[]> = { support: [], rebuild: ['full'], status: [], exact: ['entity', 'revision'], selected: ['entity', 'scope'], search: ['text', 'mode', 'limit', 'history', 'files', 'kind', 'tag', 'scope'], reverse: ['entity', 'revision', 'depth', 'limit', 'history', 'scope'], analyze: [], diff: ['entity', 'before', 'after'], tasks: [], state: ['history', 'scope'], 'state-input': ['entity', 'revision', 'actor', 'inputs', 'scope'], 'state-options': ['scope'], 'state-evaluate': ['query', 'scope'], 'state-compare': ['query', 'scope'], 'story-options': ['scope'], story: ['query', 'scope'], game: ['query', 'scope'] };
let index: ProjectIndex | undefined;
try {
  const [command, ...args] = process.argv.slice(2);
  if (!command || !Object.hasOwn(commands, command)) throw new Error(`Usage: index-cli ${Object.keys(commands).join('|')} --app-data <directory> --registration <id> | --run <id> [--view working|basis] [query options]`);
  if (command === 'support') {
    if (args.length) throw new Error('support takes no project options');
    console.log(JSON.stringify({ stateSupport, statePolicy, statePlugin }, null, 2));
  } else {
  const queryCommand = command !== 'status' && command !== 'rebuild', flags = new Map<string, string>(), common = ['app-data', 'registration', 'run', 'view', 'commit', ...(queryCommand ? ['baseline', 'expected-snapshot', 'allow-stale', 'auto-rebuild', 'perspective'] : [])];
  for (let n = 0; n < args.length; n += 2) { const name = args[n]!, value = args[n + 1]; if (![...common, ...commands[command]!].some(option => name === '--' + option) || !value || value.startsWith('--') || flags.has(name)) throw new Error(`Invalid/duplicate flag ${name}`); flags.set(name, value); }
  const required = (name: string) => { const value = flags.get('--' + name); if (!value) throw new Error(`--${name} is required`); return value; };
  const boolean = (name: string, fallback: boolean) => { const value = flags.get('--' + name); if (value === undefined) return fallback; if (!['true', 'false'].includes(value)) throw new Error(`--${name} must be true or false`); return value === 'true'; };
  const number = (name: string, fallback: number) => { const value = flags.get('--' + name); if (value === undefined) return fallback; const n = Number(value); if (!Number.isSafeInteger(n)) throw new Error(`Invalid --${name}`); return n; };
  const json = async (name: string): Promise<Record<string, unknown>> => { const path = required(name), text = await readFile(path, 'utf8'); parseYaml(text, path); const value: unknown = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`--${name} must contain a JSON object`); return value as Record<string, unknown>; };
  const appData = resolve(required('app-data')), view = flags.get('--view') ?? 'working';
  if (!['working', 'basis'].includes(view) || flags.has('--run') === flags.has('--registration')) throw new Error('Choose exactly one registration/run and a valid view');
  if (flags.has('--run')) { if (flags.has('--commit')) throw new Error('Run basis is fixed; --commit is not allowed'); index = await ProjectIndex.run(appData, required('run'), view as 'working' | 'basis'); }
  else if (view === 'basis') index = await ProjectIndex.committed(appData, required('registration'), required('commit'));
  else { if (flags.has('--commit')) throw new Error('--commit requires --view basis'); index = await ProjectIndex.registered(appData, required('registration')); }
  if (command === 'status') console.log(JSON.stringify(await index.status(index.scopeToken), null, 2));
  else if (command === 'rebuild') console.log(JSON.stringify(await index.rebuild(index.scopeToken, { full: boolean('full', false) }), null, 2));
  else {
    const data: Record<string, unknown> = flags.has('--query') ? await json('query') : {};
    for (const [flag, property] of [['entity', 'entityId'], ['revision', 'revisionId'], ['before', 'before'], ['after', 'after'], ['text', 'text']] as const) if (commands[command]!.includes(flag)) data[property] = required(flag);
    if (command === 'search') { data['mode'] = flags.get('--mode') ?? 'auto'; data['limit'] = number('limit', 50); data['includeHistory'] = boolean('history', false); data['includeFiles'] = boolean('files', false); for (const name of ['kind', 'tag']) if (flags.has('--' + name)) data[name] = required(name); }
    if (command === 'reverse') { data['maxDepth'] = number('depth', 8); data['maxResults'] = number('limit', 100); data['includeHistory'] = boolean('history', false); }
    if (command === 'state') data['includeHistory'] = boolean('history', false);
    if (command === 'state-input') { if (flags.has('--actor')) data['actor'] = required('actor'); if (flags.has('--inputs')) data['overrides'] = await json('inputs'); }
    let scope: QueryScope | undefined;
    if (flags.has('--scope')) { const value = await json('scope'); if (Object.entries(value).some(([key, value]) => !['continuity', 'platform', 'mode'].includes(key) || typeof value !== 'string')) throw new Error('Invalid scope'); scope = value as QueryScope; }
    const perspective = flags.has('--perspective') ? readPerspective(await json('perspective')) : undefined;
    const result = await index.query(command as Parameters<ProjectIndex['query']>[0], data, { scopeToken: index.scopeToken, ...(flags.has('--baseline') ? { baselineId: required('baseline') } : {}), ...(flags.has('--expected-snapshot') ? { expectedSnapshot: required('expected-snapshot') } : {}), ...(scope ? { scope } : {}), ...(perspective ? { perspective } : {}), allowStale: boolean('allow-stale', false), autoRebuild: boolean('auto-rebuild', true) });
    console.log(JSON.stringify(result, null, 2)); if (command === 'analyze' && !(result.data as BaselineAnalysis).releaseEligible) process.exitCode = 2;
  }
  }
} catch (error) { console.error(JSON.stringify(error instanceof ValidationFailure ? { code: 'SOURCE_INVALID', diagnostics: error.diagnostics } : { code: error instanceof IndexError ? error.code : 'COMMAND_INVALID', message: String(error) }, null, 2)); process.exitCode = 1; }
finally { await index?.close(); }
