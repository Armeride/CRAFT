import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { crc32 } from 'node:zlib';
import type { AdapterContext } from '../packages/agent-core/src/contracts.js';
import type { AgentExecution } from '../packages/agent-core/src/contracts.js';
import { metricsSnapshot, resetMetrics } from '../packages/domain/src/instrumentation.js';
import type { MetricTotals } from '../packages/domain/src/instrumentation.js';
import { createWebApp } from '../apps/server/app.js';
import { commitAll, entityId, revisionId, writeScaleProject } from './scale-fixture.js';

/**
 * Task 011 measurement: one sourcebook session without a model.
 * import -> open task -> MCP reads and 6 character drafts with original PNGs and 5 pinned
 * references -> integration diff -> apply -> first image. Model time is zero by construction.
 */
const { values } = parseArgs({ options: {
  entities: { type: 'string', default: '1000' },
  revisions: { type: 'string', default: '10' },
  'png-bytes': { type: 'string', default: '1100000' },
  chapters: { type: 'string', default: '12' },
  progress: { type: 'string' },
  characters: { type: 'string', default: '6' },
} });
const shape = { entities: Number(values.entities), revisions: Number(values.revisions) };
const pngBytes = Number(values['png-bytes']), chapters = Number(values.chapters), characters = Number(values.characters);

function png(bytes: number): Buffer {
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=', 'base64');
  // A private ancillary chunk keeps the file a valid PNG at the requested size.
  const payload = randomBytes(bytes), chunk = Buffer.concat([Buffer.from('crFt'), payload]);
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(payload.length); checksum.writeUInt32BE(crc32(chunk));
  return Buffer.concat([pixel.subarray(0, 33), length, chunk, checksum, pixel.subarray(33)]);
}

type Delta = Record<string, MetricTotals>;
/** Runs async actions one after another (the measured steps must not overlap). */
const sequence = <T, R>(items: readonly T[], action: (item: T, index: number, previous: R | undefined) => Promise<R>): Promise<R | undefined> =>
  items.reduce<Promise<R | undefined>>(async (previous, item, index) => action(item, index, await previous), Promise.resolve(undefined));
interface Step { step: string; elapsedMs: number; cpuUserMs: number; cpuSystemMs: number; rssMb: number; metrics: Delta; error?: string }
const steps: Step[] = [];
/** Times one user-visible step and records the operation counters it caused. */
async function step<T>(name: string, action: () => Promise<T>): Promise<T> {
  resetMetrics();
  const cpu = process.cpuUsage(), started = performance.now();
  const finish = async (error?: unknown): Promise<void> => {
    const elapsedMs = performance.now() - started, used = process.cpuUsage(cpu);
    const entry: Step = { step: name, elapsedMs: Math.round(elapsedMs), cpuUserMs: Math.round(used.user / 1000), cpuSystemMs: Math.round(used.system / 1000), rssMb: Math.round(process.memoryUsage().rss / 1048576), metrics: metricsSnapshot(), ...(error === undefined ? {} : { error: (error instanceof Error ? error.message : JSON.stringify(error)).slice(0, 300) }) };
    steps.push(entry);
    // Long runs keep every finished step even if a later step fails.
    if (values.progress) await appendFile(values.progress, JSON.stringify(entry) + '\n');
  };
  try { const value = await action(); await finish(); return value; }
  catch (error) { await finish(error ?? 'failed'); throw error; }
}

interface Built { workingFingerprint: string }
interface Proposed { entityId: string; revisionId: string }
function scripted(images: readonly string[]) {
  return {
    async execute(context: AdapterContext): Promise<void> {
      await context.session('sourcebook-' + randomUUID());
      const build = () => step('mcp.context.build', () => context.tool('context.build', {}) as Promise<Built>);
      const initial = await build();
      await sequence([0, 1, 2], async sample => {
        const target = sample * 97 % shape.entities;
        await step(`mcp.entity.get#${String(sample + 1)}`, () => context.tool('entity.get', { entityId: entityId(target), revisionId: revisionId(target, shape.revisions - 1), view: 'working' }));
      });
      await step('mcp.knowledge.search', () => context.tool('knowledge.search', { text: '교역로' }));
      await sequence<string, { built: Built; proposed?: Proposed }>(images, async (sourcePath, number, state) => {
        const previous = state?.proposed, fingerprint = (state?.built ?? initial).workingFingerprint;
        const references = previous ? [{ reference_id: 'ref_companion', relation: 'related_to', propagation: 'none', update_policy: 'pinned',
          target: { entity_id: previous.entityId, revision_id: previous.revisionId } }] : [];
        const proposed = await step(`mcp.changes.propose#${String(number + 1)}`, () => context.tool('changes.propose', {
          requestId: randomUUID(), expectedSnapshot: fingerprint, kind: 'narrative.character',
          title: `인물 ${String(number + 1)}`, body: `# 인물 ${String(number + 1)}\n\n국경 마을 출신. 교역로를 지킨다.\n`,
          extensions: { narrative: { profile: { role: number ? 'Supporting' : 'Protagonist' }, initial_state: { world_tick: 0, values: {} } } },
          references, images: [{ sourcePath, alt: `인물 ${String(number + 1)} 초상` }],
        }) as Promise<Proposed>);
        return { built: await build(), proposed };
      });
      await step('mcp.project.validate', () => context.tool('project.validate', {}));
    },
  };
}

const home = await mkdtemp(join(tmpdir(), 'craft-sourcebook-scale-'));
try {
  const root = join(home, 'novel'), appData = join(home, 'app');
  await writeScaleProject(root, shape);
  await mkdir(join(root, 'manuscript')); await mkdir(join(root, 'illustrations'));
  const paths = Array.from({ length: chapters }, (_, n) => `manuscript/chapter-${String(n + 1).padStart(2, '0')}.md`);
  await Promise.all(paths.map((path, n) => writeFile(join(root, path), `# ${String(n + 1)}장\n\n${'국경 마을과 교역로의 이야기. '.repeat(800)}\n`)));
  const images = Array.from({ length: characters }, (_, n) => `illustrations/character-${String(n + 1)}.png`);
  const digests = await Promise.all(images.map(async path => { const bytes = png(pngBytes); await writeFile(join(root, path), bytes); return createHash('sha256').update(bytes).digest('hex'); }));
  await commitAll(root, 'sourcebook fixture');

  const port = 4173, app = await createWebApp({ appData, port, agentAdapters: { fake: scripted(images) } });
  try {
    await app.ready();
    const headers: Record<string, string> = { host: `127.0.0.1:${String(port)}` };
    const session = await app.inject({ url: '/api/session', headers });
    const cookie = session.cookies[0];
    if (!cookie) throw new Error('Session cookie missing');
    headers['cookie'] = `${cookie.name}=${cookie.value}`;
    headers['x-craft-csrf'] = session.json<{ csrf: string }>().csrf;
    const call = async <T>(method: 'GET' | 'POST', url: string, payload?: object): Promise<T> => {
      const response = await app.inject({ method, url, headers: { ...headers, 'x-craft-request-id': randomUUID() }, ...(payload ? { payload } : {}) });
      if (response.statusCode !== 200) throw new Error(`${method} ${url} -> ${String(response.statusCode)}: ${response.body.slice(0, 400)}`);
      return response.json<T>();
    };
    const source = await step('open.source', () => call<{ id: string }>('POST', '/api/projects/open', { root }));
    const imported = await step('import.documents', () => call<{ choice: { id: string } }>('POST', '/api/library/import', { registrationId: source.id, paths, name: '설정집', narrative: true }));
    const project = imported.choice.id;
    const run = await step('task.open', () => call<{ runId: string }>('POST', `/api/projects/${project}/tasks`, { goal: '설정집 인물 초안', baselineId: 'baseline_main' }));
    const started = await call<AgentExecution>('POST', `/api/runs/${run.runId}/agents`, { provider: 'fake', prompt: '설정집 인물 6명을 초안으로 작성한다.' });
    const agentStarted = performance.now();
    const settle = async (current: AgentExecution): Promise<AgentExecution> => {
      if (['completed', 'failed', 'cancelled', 'interrupted'].includes(current.state)) return current;
      await new Promise(resolve => setTimeout(resolve, 500));
      return settle(await call<AgentExecution>('GET', `/api/agent-executions/${started.id}`));
    };
    const execution = await settle(started);
    const agentMs = Math.round(performance.now() - agentStarted);
    if (execution.state !== 'completed') throw new Error(`Agent run ${execution.state}: ${execution.code ?? ''}`);
    const manual = await step('review.open', () => call<{ proposals: { id: string }[] }>('GET', `/api/runs/${run.runId}/manual`));
    const prepared = await step('integration.prepare', () => call<{ id: string; token: string; diff: string }>('POST', `/api/runs/${run.runId}/integrations`, { requestId: randomUUID(), proposalIds: manual.proposals.map(value => value.id) }));
    const diffFiles = prepared.diff.split(/^diff --git /m).slice(1).map(part => ({ path: part.slice(0, part.indexOf('\n')), bytes: Buffer.byteLength(part) })).sort((a, b) => b.bytes - a.bytes);
    await step('integration.apply', () => call('POST', `/api/integrations/${prepared.id}/apply`, { token: prepared.token }));
    const [first] = digests;
    if (!first) throw new Error('Image fixture missing');
    const second = digests[1] ?? first;
    const image = await step('image.first', () => call<{ base64: string }>('GET', `/api/projects/${project}/images/${first}`));
    if (createHash('sha256').update(Buffer.from(image.base64, 'base64')).digest('hex') !== first) throw new Error('Image digest mismatch');
    await step('image.repeat', () => call('GET', `/api/projects/${project}/images/${second}`));
    console.log(JSON.stringify({ platform: process.platform, node: process.version, shape, chapters, characters, pngBytes,
      proposals: manual.proposals.length, diffBytes: Buffer.byteLength(prepared.diff), diffFiles: diffFiles.slice(0, 15), agentWallMs: agentMs,
      maxRssMb: Math.round(process.resourceUsage().maxRSS / 1024), steps }, null, 2));
  } finally { await app.close(); }
} finally { await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
