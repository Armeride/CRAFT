#!/usr/bin/env node
// CRAFT quality gate runner. Protected file (see AGENTS.md "품질 게이트").
//
//   node tools/quality/run.mjs fast [files...]     check:fast  (changed files; staged files in pre-commit)
//   node tools/quality/run.mjs check               quality part of `npm run check`
//   node tools/quality/run.mjs security            check:security
//   node tools/quality/run.mjs lint [--prune] [files...]
//   node tools/quality/run.mjs guard [--base <ref>]  protected-file / ratchet guard
//   node tools/quality/run.mjs setup               install tooling, pinned binaries, git hooks
//   node tools/quality/run.mjs baseline <eslint|depcruise|knip|semgrep>   (humans only)
//
// Flags: --sarif writes SARIF reports to .tmp/quality-reports/ where the tool supports it.
// No shell is used anywhere: every tool runs with spawnSync(argv, { shell: false }).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const Q = join(ROOT, 'tools', 'quality');
const REPORTS = join(ROOT, '.tmp', 'quality-reports');
const BIN_DIR = join(ROOT, '.tools');
const isWin = process.platform === 'win32';

const PINNED = JSON.parse(readFileSync(join(Q, 'binaries.json'), 'utf8'));
const THRESHOLDS = JSON.parse(readFileSync(join(Q, 'thresholds.json'), 'utf8'));

const LINT_DIRS = ['apps/', 'packages/', 'tools/', 'tests/', 'bench/'];
const LINT_EXT = /\.(?:ts|tsx|mts|cts)$/;
const LINT_GLOBS = ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,mts}', 'tools/**/*.ts', 'tests/**/*.ts', 'bench/**/*.ts', '*.ts'];
const ESLINT_SUPPRESSIONS = 'tools/quality/eslint-suppressions.json';
const DEPCRUISE_KNOWN = 'tools/quality/dependency-cruiser-known-violations.json';
const KNIP_BASELINE = 'tools/quality/knip-baseline.json';
const SEMGREP_BASELINE = 'tools/quality/semgrep-baseline.json';
const SEMGREP_CONFIGS = ['p/typescript', 'p/nodejs', 'p/owasp-top-ten', 'p/react', '.semgrep/'];

// Paths agents must not change (AGENTS.md). ESLint suppressions may only shrink.
const PROTECTED = [
  /^tools\/quality\//, /^\.semgrep\//, /^\.semgrepignore$/, /^\.gitleaks(ignore|\.toml)$/,
  /^lefthook\.ya?ml$/, /^\.github\//, /^\.codex\//, /^AGENTS\.md$/,
  /^tsconfig(\.[\w-]+)?\.json$/, /^apps\/web\/tsconfig\.json$/, /^\.npmrc$/,
];
const SHRINK_ONLY = new Set([ESLINT_SUPPRESSIONS]);
const GATE_SCRIPTS = ['check', 'check:fast', 'check:security', 'lint', 'lint:prune', 'quality:setup'];

// ---------------------------------------------------------------- helpers
const argv = process.argv.slice(2);
const command = argv.shift() ?? 'help';
const flags = new Set(argv.filter(a => a.startsWith('--')));
const optionValue = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--base');
const sarif = flags.has('--sarif');

const color = (code, text) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);
const heading = text => console.log(`\n${color('1;36', `▶ ${text}`)}`);
const failures = [];
const fail = (step, message) => { failures.push(step); console.error(color('31', `✖ ${step}: ${message}`)); };
const pass = (step, message = 'ok') => console.log(color('32', `✔ ${step}: ${message}`));
const rel = p => relative(ROOT, p).split('\\').join('/');

function run(cmd, args, { cwd = ROOT, capture = false, env } = {}) {
  const result = spawnSync(cmd, args, {
    cwd,
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  return result;
}

/** Resolve a CLI entry point of a package installed in tools/quality (or the app root). */
function binOf(pkg, name = pkg, base = Q) {
  const dir = join(base, 'node_modules', ...pkg.split('/'));
  const manifestPath = join(dir, 'package.json');
  if (!existsSync(manifestPath)) {
    console.error(color('31', `Missing ${pkg}. Run: npm run quality:setup`));
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[name];
  if (!bin) throw new Error(`${pkg} has no bin "${name}"`);
  return join(dir, bin);
}
const node = (script, args, options) => run(process.execPath, [script, ...args], options);

function git(args) {
  const r = run('git', args, { capture: true });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}
const lines = text => text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

function ensureReports() { mkdirSync(REPORTS, { recursive: true }); }
function timed(label, fn) {
  const start = performance.now();
  try { return fn(); } finally { console.log(color('2', `  (${label}: ${((performance.now() - start) / 1000).toFixed(1)}s)`)); }
}

function exe(name) {
  const local = join(BIN_DIR, isWin ? `${name}.exe` : name);
  if (existsSync(local)) return local;
  try {
    const probe = run(name, ['--version'], { capture: true });
    if (probe.status === 0) return name;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error; // not on PATH
  }
  return undefined;
}

// ---------------------------------------------------------------- steps
// The app's own compiler (TypeScript 7 from the root node_modules) does all type checking.
const EXTRA_PROJECTS = ['tools/quality/tsconfig.web-tests.json', 'tools/quality/tsconfig.bench.json'];
function typecheck(projects) {
  heading(`typecheck (${projects.join(', ')})`);
  const tsc = binOf('typescript', 'tsc', ROOT);
  for (const project of projects) {
    const r = node(tsc, ['-p', project, '--noEmit']);
    if (r.status !== 0) fail('typecheck', project); else pass('typecheck', project);
  }
}

function lintable(files) {
  return [...new Set(files.map(f => f.split('\\').join('/')))]
    .filter(f => LINT_EXT.test(f) && (LINT_DIRS.some(d => f.startsWith(d)) || !f.includes('/')))
    .filter(f => !f.startsWith('tools/quality/') && existsSync(join(ROOT, f)));
}

function eslintArgs() {
  return ['-c', 'tools/quality/eslint.config.mjs', '--suppressions-location', ESLINT_SUPPRESSIONS, '--no-warn-ignored'];
}

function lint(files, { full }) {
  heading(full ? 'eslint (all files, type-aware)' : `eslint (${files.length} changed file(s))`);
  if (!full && files.length === 0) { pass('eslint', 'no lintable changed files'); return; }
  const eslint = binOf('eslint');
  const args = [...eslintArgs(), ...(full ? ['--concurrency', 'auto', ...LINT_GLOBS] : ['--pass-on-unpruned-suppressions', ...files])];
  if (flags.has('--prune')) {
    const r = node(eslint, [...eslintArgs(), '--concurrency', 'auto', '--prune-suppressions', ...LINT_GLOBS]);
    if (r.status === 0) pass('eslint', 'suppressions pruned (counts can only go down)'); else fail('eslint', 'prune failed');
    return;
  }
  if (sarif) {
    ensureReports();
    const jsonPath = join(REPORTS, 'eslint.json');
    const r = node(eslint, [...args, '-f', 'json', '-o', jsonPath]);
    writeEslintSarif(jsonPath, join(REPORTS, 'eslint.sarif'));
    const results = JSON.parse(readFileSync(jsonPath, 'utf8'));
    for (const file of results) for (const m of file.messages) console.log(`${rel(file.filePath)}:${m.line}:${m.column} ${m.ruleId ?? 'parse'} ${m.message}`);
    if (r.status !== 0) fail('eslint', 'new violations (see above / eslint.sarif)'); else pass('eslint', 'no new violations');
    return;
  }
  const r = node(eslint, args);
  if (r.status !== 0) {
    fail('eslint', full
      ? 'new violations, or fixed ones whose suppressions must be pruned (`npm run lint:prune`, then commit tools/quality/eslint-suppressions.json)'
      : 'new violations in changed files');
  } else pass('eslint', 'no new violations');
}

function writeEslintSarif(jsonPath, sarifPath) {
  const results = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const rules = new Map();
  const items = [];
  for (const file of results) for (const m of file.messages) {
    const ruleId = m.ruleId ?? 'eslint/parse-error';
    rules.set(ruleId, { id: ruleId });
    items.push({
      ruleId,
      level: m.severity === 2 ? 'error' : 'warning',
      message: { text: m.message },
      locations: [{ physicalLocation: { artifactLocation: { uri: rel(file.filePath) }, region: { startLine: m.line ?? 1, startColumn: m.column ?? 1 } } }],
    });
  }
  writeSarif(sarifPath, 'ESLint', [...rules.values()], items);
}

function writeSarif(path, toolName, rules, results) {
  writeFileSync(path, JSON.stringify({
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [{ tool: { driver: { name: toolName, rules } }, results }],
  }, null, 2));
}

function typeCoverage() {
  heading('type-coverage (ratchet: may only go up)');
  const tc = binOf('type-coverage');
  for (const [project, atLeast] of Object.entries(THRESHOLDS.typeCoverage)) {
    const r = node(tc, ['-p', project, '--strict', '--ignore-catch', '--at-least', String(atLeast)], { capture: true });
    const summary = (r.stdout.match(/\(\d+ \/ \d+\) [\d.]+%/) ?? [r.stdout.trim()])[0];
    if (r.status !== 0) fail('type-coverage', `${project}: ${summary} < ${atLeast}%`);
    else pass('type-coverage', `${project}: ${summary} (floor ${atLeast}%)`);
  }
}

function knipIssues() {
  const r = node(binOf('knip'), ['-c', 'tools/quality/knip.json', '--no-progress', '--reporter', 'json'], { capture: true });
  if (r.status > 1 || !r.stdout.trim().startsWith('{')) { console.error(r.stdout, r.stderr); throw new Error('knip failed to run'); }
  const keys = [];
  for (const issue of JSON.parse(r.stdout).issues) {
    for (const [type, list] of Object.entries(issue)) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const name = Array.isArray(item) ? item.map(i => i.name).join('|') : item.name;
        keys.push(`${type} ${issue.file}${name ? ` ${name}` : ''}`);
      }
    }
  }
  return keys.sort();
}

function knip() {
  heading('knip (unused files / exports / dependencies)');
  const current = knipIssues();
  const known = new Set(JSON.parse(readFileSync(join(ROOT, KNIP_BASELINE), 'utf8')));
  const added = current.filter(k => !known.has(k));
  const fixed = [...known].filter(k => !current.includes(k));
  if (fixed.length) console.log(color('33', `  ${fixed.length} baseline item(s) resolved — a maintainer can shrink ${KNIP_BASELINE} with \`node tools/quality/run.mjs baseline knip\`.`));
  if (added.length) { for (const k of added) console.log(`  new: ${k}`); fail('knip', `${added.length} new issue(s)`); }
  else pass('knip', `no new issues (${current.length} baselined)`);
}

function depcruise() {
  heading('dependency-cruiser (cycles, layers)');
  const args = ['-c', 'tools/quality/dependency-cruiser.cjs', '--ignore-known', DEPCRUISE_KNOWN, 'apps', 'packages', 'tools', 'tests', 'bench'];
  const r = node(binOf('dependency-cruiser', 'depcruise'), ['-T', 'err', ...args]);
  if (r.status !== 0) fail('depcruise', 'new dependency violations'); else pass('depcruise', 'no new violations');
}

function sizeLimit() {
  heading('size-limit (web bundle budget)');
  if (!existsSync(join(ROOT, 'dist', 'web', 'assets'))) { fail('size-limit', 'dist/web missing — run `npm run ui:build` first'); return; }
  const r = node(binOf('size-limit'), [], { cwd: Q });
  if (r.status !== 0) fail('size-limit', 'bundle over budget'); else pass('size-limit');
}

// ---------------------------------------------------------------- security
function semgrepResults() {
  const semgrep = exe('semgrep');
  if (!semgrep) throw new Error(`semgrep not found. Install: uv tool install semgrep==${PINNED.semgrep.version}`);
  const version = run(semgrep, ['--version'], { capture: true }).stdout.trim();
  if (version !== PINNED.semgrep.version) console.log(color('33', `  semgrep ${version} (pinned ${PINNED.semgrep.version})`));
  ensureReports();
  const jsonPath = join(REPORTS, 'semgrep.json');
  const args = ['scan', '--metrics=off', '--disable-version-check', '--quiet', ...SEMGREP_CONFIGS.flatMap(c => ['--config', c]), `--json-output=${jsonPath}`];
  if (sarif) args.push(`--sarif-output=${join(REPORTS, 'semgrep.sarif')}`);
  const r = run(semgrep, [...args, '.'], { capture: true, env: { PYTHONUTF8: '1' } });
  if (r.status !== 0 && r.status !== 1) { console.error(r.stderr); throw new Error(`semgrep exited ${r.status}`); }
  const report = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const counts = {};
  for (const x of report.results) {
    const key = `${x.check_id} ${x.path.split('\\').join('/')}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return { counts, report };
}

function semgrep() {
  heading('semgrep (registry rulesets + .semgrep/)');
  let result;
  try { result = semgrepResults(); } catch (error) { fail('semgrep', error.message); return; }
  const baseline = JSON.parse(readFileSync(join(ROOT, SEMGREP_BASELINE), 'utf8')).findings;
  const grown = Object.entries(result.counts).filter(([k, n]) => n > (baseline[k] ?? 0));
  for (const x of result.report.results) {
    const key = `${x.check_id} ${x.path.split('\\').join('/')}`;
    if (grown.some(([k]) => k === key)) console.log(`  ${x.path}:${x.start.line} ${x.check_id}\n    ${x.extra.message.split('\n')[0]}`);
  }
  if (grown.length) fail('semgrep', `${grown.length} rule/file pair(s) above baseline`);
  else pass('semgrep', `no new findings (${result.report.results.length} baselined, ${result.report.errors.length} parse warning(s))`);
}

function osv() {
  heading('osv-scanner (dependency vulnerabilities)');
  const bin = exe(PINNED.osvScanner.exe);
  if (!bin) { fail('osv-scanner', 'not installed — run `npm run quality:setup`'); return; }
  const args = ['scan', 'source', '--config', 'tools/quality/osv-scanner.toml', '--lockfile', 'package-lock.json', '--lockfile', 'tools/quality/package-lock.json'];
  if (sarif) { ensureReports(); run(bin, [...args, '--format', 'sarif', '--output-file', join(REPORTS, 'osv-scanner.sarif')], { capture: true }); }
  const r = run(bin, [...args, '--format', 'table']);
  if (r.status !== 0) fail('osv-scanner', 'vulnerable dependencies (or scanner error)'); else pass('osv-scanner');
}

function gitleaks({ staged }) {
  heading(staged ? 'gitleaks (staged changes)' : 'gitleaks (git history)');
  const bin = exe(PINNED.gitleaks.exe);
  if (!bin) { fail('gitleaks', 'not installed — run `npm run quality:setup`'); return; }
  const args = ['git', '--no-banner', '--redact', ...(staged ? ['--pre-commit', '--staged'] : [])];
  if (sarif && !staged) { ensureReports(); args.push('--report-format', 'sarif', '--report-path', join(REPORTS, 'gitleaks.sarif')); }
  const r = run(bin, [...args, '.']);
  if (r.status !== 0) fail('gitleaks', 'possible secret found'); else pass('gitleaks');
}

// ---------------------------------------------------------------- guard
function countSuppressions(text) {
  if (!text) return {};
  const data = JSON.parse(text);
  const out = {};
  for (const [file, rules] of Object.entries(data)) for (const [rule, { count }] of Object.entries(rules)) out[`${file} ${rule}`] = count;
  return out;
}

// Two modes:
// - Local (pre-commit, staged changes): blocks unless the maintainer commits with
//   QUALITY_GATE_OVERRIDE=1. Gives agents immediate feedback before they commit.
// - PR (--base): report only. Agents push and open PRs through GitHub Apps, which can
//   also label PRs, so a label cannot prove maintainer intent. Enforcement is the main
//   ruleset (1 approval + Code Owner review, .github/CODEOWNERS); this mode lists what
//   the reviewer must look at, as annotations and in the job summary.
function guard() {
  const base = optionValue('--base');
  heading(base ? `guard (changes since ${base}, report only)` : 'guard (staged changes)');
  const allowed = !base && process.env.QUALITY_GATE_OVERRIDE === '1';
  const changed = lines(base ? git(['diff', '--name-only', `${base}...HEAD`]) : git(['diff', '--cached', '--name-only']));
  const show = spec => { const r = run('git', ['show', spec], { capture: true }); return r.status === 0 ? r.stdout : ''; };
  const violations = [];

  for (const file of changed.filter(f => SHRINK_ONLY.has(f))) {
    const before = countSuppressions(show(`${base ?? 'HEAD'}:${file}`));
    const after = countSuppressions(base ? show(`HEAD:${file}`) : show(`:${file}`));
    const grown = Object.entries(after).filter(([k, n]) => n > (before[k] ?? 0));
    if (grown.length) { for (const [k, n] of grown) console.log(`  ${k}: ${before[k] ?? 0} -> ${n}`); violations.push(`${file} grew (baselines may only shrink)`); }
    else pass('guard', `${file} only shrank`);
  }
  if (changed.includes('package.json')) {
    // package.json is shared with app work; only the gate entry points are protected.
    const scripts = text => { try { return JSON.parse(text).scripts ?? {}; } catch { return {}; } };
    const before = scripts(show(`${base ?? 'HEAD'}:package.json`));
    const after = scripts(base ? show('HEAD:package.json') : show(':package.json'));
    const altered = GATE_SCRIPTS.filter(name => before[name] !== undefined && before[name] !== after[name]);
    if (altered.length) violations.push(`package.json gate scripts changed: ${altered.join(', ')}`);
    else pass('guard', 'package.json gate scripts unchanged');
  }
  const touched = changed.filter(f => !SHRINK_ONLY.has(f) && PROTECTED.some(p => p.test(f)));
  for (const f of touched) console.log(`  protected: ${f}`);
  if (touched.length) violations.push(`${touched.length} protected file(s) changed`);

  if (violations.length === 0) { pass('guard', 'no protected changes'); return; }
  if (base) { reportGuard(violations, touched); return; }
  if (allowed) { console.log(color('33', `  maintainer-approved gate change: ${violations.join('; ')}`)); pass('guard', 'allowed by maintainer signal'); return; }
  fail('guard', `${violations.join('; ')}. Quality-gate files are maintainer-only (AGENTS.md): report instead of editing; to apply intentionally, maintainers commit with QUALITY_GATE_OVERRIDE=1.`);
}

function reportGuard(violations, touched) {
  const title = 'Quality-gate change: maintainer review required';
  if (process.env.GITHUB_ACTIONS === 'true') {
    const esc = s => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    for (const f of touched) console.log(`::warning file=${esc(f)},title=${esc(title)}::Protected file changed (AGENTS.md)`);
    for (const v of violations) console.log(`::warning title=${esc(title)}::${esc(v)}`);
  }
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const body = [`## ${title}`, '', ...violations.map(v => `- ${v}`), '', ...touched.map(f => `- \`${f}\``), ''].join('\n');
    writeFileSync(summary, body, { flag: 'a' });
  }
  console.log(color('33', `  ${title}: ${violations.join('; ')}`));
  pass('guard', 'reported (enforced by CODEOWNERS review)');
}

// ---------------------------------------------------------------- setup
function sha256(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }

async function download(url, dest) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`download failed ${response.status} ${url}`);
  writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
}

async function setup() {
  heading('npm ci (tools/quality)');
  const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const npm = existsSync(npmCli) ? [process.execPath, [npmCli]] : ['npm', []];
  let r = run(npm[0], [...npm[1], 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: Q });
  if (r.status !== 0) { fail('setup', 'npm ci failed in tools/quality'); return; }

  heading('pinned binaries (.tools/)');
  mkdirSync(BIN_DIR, { recursive: true });
  const platform = `${process.platform}-${process.arch}`;
  for (const tool of [PINNED.gitleaks, PINNED.osvScanner]) {
    const asset = tool.assets[platform];
    if (!asset) { fail('setup', `${tool.exe}: no pinned asset for ${platform}`); continue; }
    const target = join(BIN_DIR, isWin ? `${tool.exe}.exe` : tool.exe);
    if (existsSync(target) && existsSync(`${target}.sha256`) && readFileSync(`${target}.sha256`, 'utf8') === asset.sha256) { pass('setup', `${tool.exe} ${tool.version} present`); continue; }
    const url = tool.url.replaceAll('{version}', tool.version).replaceAll('{file}', asset.file);
    const tmp = join(BIN_DIR, asset.file);
    await download(url, tmp);
    const digest = sha256(tmp);
    if (digest !== asset.sha256) { rmSync(tmp); fail('setup', `${asset.file} checksum mismatch (${digest})`); continue; }
    if (asset.archive) {
      const extract = join(BIN_DIR, `extract-${tool.exe}`);
      rmSync(extract, { recursive: true, force: true }); mkdirSync(extract);
      const tar = isWin ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
      r = run(tar, ['-xf', tmp, '-C', extract]);
      if (r.status !== 0) { fail('setup', `cannot extract ${asset.file}`); continue; }
      writeFileSync(target, readFileSync(join(extract, asset.archive)));
      rmSync(extract, { recursive: true, force: true });
      rmSync(tmp);
    } else {
      writeFileSync(target, readFileSync(tmp)); rmSync(tmp);
    }
    if (!isWin) run('chmod', ['+x', target]);
    writeFileSync(`${target}.sha256`, asset.sha256);
    pass('setup', `${tool.exe} ${tool.version} installed (sha256 verified)`);
  }

  heading('semgrep');
  const semgrepBin = exe('semgrep');
  if (!semgrepBin) console.log(color('33', `  semgrep not found. Install (user scope): uv tool install semgrep==${PINNED.semgrep.version}`));
  else pass('setup', `semgrep ${run(semgrepBin, ['--version'], { capture: true }).stdout.trim()}`);

  if (!flags.has('--no-hooks')) {
    heading('git hooks (lefthook)');
    r = node(binOf('lefthook'), ['install', '--force']);
    if (r.status !== 0) fail('setup', 'lefthook install failed'); else pass('setup', 'git hooks installed');
  }
}

// ---------------------------------------------------------------- baselines (maintainers)
function baseline(tool) {
  heading(`baseline ${tool} (maintainer action — commit with QUALITY_GATE_OVERRIDE=1)`);
  if (tool === 'eslint') {
    const r = node(binOf('eslint'), [...eslintArgs(), '--concurrency', 'auto', '--suppress-all', ...LINT_GLOBS]);
    if (r.status !== 0) fail('baseline', 'eslint');
  } else if (tool === 'depcruise') {
    node(binOf('dependency-cruiser', 'depcruise'), ['-c', 'tools/quality/dependency-cruiser.cjs', '-T', 'baseline', '-f', DEPCRUISE_KNOWN, 'apps', 'packages', 'tools', 'tests', 'bench']);
  } else if (tool === 'knip') {
    writeFileSync(join(ROOT, KNIP_BASELINE), `${JSON.stringify(knipIssues(), null, 2)}\n`);
  } else if (tool === 'semgrep') {
    const { counts } = semgrepResults();
    const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(join(ROOT, SEMGREP_BASELINE), `${JSON.stringify({ comment: 'Existing Semgrep findings: "<rule> <path>": count. Counts may only go down.', findings: sorted }, null, 2)}\n`);
  } else fail('baseline', `unknown tool ${tool}`);
}

// ---------------------------------------------------------------- commands
function changedFiles() {
  if (positional.length) return positional;
  const tracked = lines(git(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD']));
  const untracked = lines(git(['ls-files', '--others', '--exclude-standard']));
  return [...tracked, ...untracked];
}

async function main() {
  const started = performance.now();
  switch (command) {
    case 'fast': {
      const files = lintable(changedFiles());
      // Web-tests tsconfig is a superset of apps/web/tsconfig.json (adds tests + vite config).
      timed('typecheck', () => { typecheck(['tsconfig.json', ...EXTRA_PROJECTS]); });
      timed('eslint', () => { lint(files, { full: false }); });
      break;
    }
    case 'check':
      timed('typecheck', () => { typecheck(EXTRA_PROJECTS); }); // app tsconfigs already ran in `npm run typecheck`
      timed('eslint', () => { lint([], { full: true }); });
      timed('type-coverage', typeCoverage);
      timed('knip', knip);
      timed('depcruise', depcruise);
      timed('size-limit', sizeLimit);
      break;
    case 'security':
      timed('semgrep', semgrep);
      timed('osv-scanner', osv);
      timed('gitleaks', () => { gitleaks({ staged: false }); });
      break;
    case 'codex-hook': {
      // Codex PostToolUse adapter: run check:fast quietly; on failure return
      // {"decision":"block","reason":...} so the failure is fed back to the model.
      const r = node(fileURLToPath(import.meta.url), ['fast'], { capture: true, env: { FORCE_COLOR: '0' } });
      if (r.status === 0) return;
      const output = `${r.stdout}\n${r.stderr}`.split(/\r?\n/).filter(l => l.trim()).slice(-60).join('\n');
      process.stdout.write(JSON.stringify({ decision: 'block', reason: `check:fast failed after this edit. Fix the code (do not edit gate files):\n${output}` }));
      return;
    }
    case 'pre-commit':
      guard();
      gitleaks({ staged: true });
      break;
    case 'lint': {
      const files = lintable(positional);
      lint(files, { full: positional.length === 0 });
      break;
    }
    case 'typecheck': typecheck(EXTRA_PROJECTS); break;
    case 'typecov': typeCoverage(); break;
    case 'knip': knip(); break;
    case 'depcruise': depcruise(); break;
    case 'size': sizeLimit(); break;
    case 'semgrep': semgrep(); break;
    case 'osv': osv(); break;
    case 'gitleaks': gitleaks({ staged: flags.has('--staged') }); break;
    case 'guard': guard(); break;
    case 'setup': await setup(); break;
    case 'baseline': baseline(positional[0]); break;
    default:
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 13).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
      process.exit(command === 'help' ? 0 : 2);
  }
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  if (failures.length) {
    console.error(color('1;31', `\nQuality gate FAILED (${[...new Set(failures)].join(', ')}) in ${seconds}s`));
    console.error('Fix the code. Do not edit gate configs/baselines; if you believe it is a false positive, report file:line and reason (AGENTS.md).');
    process.exit(1);
  }
  console.log(color('1;32', `\nQuality gate passed (${command}) in ${seconds}s`));
}

await main();
