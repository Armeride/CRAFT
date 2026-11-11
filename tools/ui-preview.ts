import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createWebApp } from '../apps/server/app.js';
import { runGit } from '../packages/git-workspace/src/git.js';
import { registerLocal } from '../packages/tasks/src/projects.js';
import { objectFile } from '../packages/project-fs/src/content.js';
import { parseYaml } from '../packages/project-fs/src/yaml.js';

const args = new Map<string, string>();
for (let n = 2; n < process.argv.length; n += 2) { const key = process.argv[n]!, value = process.argv[n + 1]; if (!['--port', '--home'].includes(key) || !value || args.has(key)) throw new Error('Usage: ui-preview [--port 4173] [--home .tmp/ui-preview]'); args.set(key, value); }
const port = Number(args.get('--port') ?? 4173); if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
const home = resolve(args.get('--home') ?? '.tmp/ui-preview'), root = join(home, 'example-project'), appData = join(home, 'app-data');
await mkdir(home, { recursive: true });
let exists = true; try { await access(root); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; exists = false; }
if (!exists) {
  await cp(resolve('fixtures/state-model'), root, { recursive: true });
  const projectPath = join(root, 'project.yaml'), project = parseYaml(await readFile(projectPath, 'utf8'), projectPath).value as Record<string, unknown>;
  await writeFile(projectPath, objectFile('project.yaml', { ...project, name: '경계의 연대기 · 예시 프로젝트' }).text!);
  const folder = join(root, 'entities/ent_border/revisions/rev_border');
  const body = '# 국경 지역\n\n두 세력의 생활권이 맞닿는 북쪽 능선. 산맥을 따라 이어진 국경은 사람과 물자가 오가는 통로이자, 서로 다른 규칙이 만나는 경계다.\n\n## 지역 개요\n\n이 문서는 이야기와 게임 기획에서 함께 사용하는 지역 설정이다. 현재 채택된 초기 상태는 북쪽 능선을 경계로 삼고, 조약에 의한 변화는 별도의 정의와 발생 기록으로 연결한다.\n\n> 경계가 움직이면, 그곳에 사는 사람들의 이야기도 달라진다.\n\n## 기획 메모\n\n- 초기 소유권과 국경 경로는 아래 상태 정의에 기록한다.\n- 조약 체결의 근거는 별도 문서에서 관리한다.\n- 장면별 지도와 조건에 따른 결과 비교는 후속 상태 조회에서 다룬다.\n';
  await writeFile(join(folder, 'content.md'), body);
  const meta = parseYaml(await readFile(join(folder, 'meta.yaml'), 'utf8'), 'meta.yaml').value as Record<string, unknown>;
  const next = join(root, 'entities/ent_border/revisions/rev_border_proposal'); await mkdir(next);
  await writeFile(join(next, 'meta.yaml'), objectFile('meta.yaml', { ...meta, revision_id: 'rev_border_proposal', parents: ['rev_border'], title: '국경 지역 · 조약 이후 검토안' }).text!);
  await writeFile(join(next, 'content.md'), body + '\n## 검토 중인 변경\n\n조약 체결 이후의 지역 설정을 검토한다. 이 초안은 현재 기준에 채택되지 않았다. 국경 변화는 연결된 조약과 발생 기록을 함께 확인한다.\n');
  await runGit(root, ['init']); await runGit(root, ['add', '.']);
  await runGit(root, ['-c', 'user.name=CRAFT Preview', '-c', 'user.email=preview@localhost', 'commit', '-m', 'preview: preserve example planning project']);
}
const registration = await registerLocal(appData, root);
const app = await createWebApp({ appData, port, webRoot: resolve('dist/web'), examples: [registration.id] });
const address = await app.listen({ port, host: '127.0.0.1' });
console.log(`CRAFT UI draft: ${address}\nExample and working files: ${home}\nCtrl+C stops this preview; files are preserved.`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
