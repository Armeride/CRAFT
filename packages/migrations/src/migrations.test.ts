import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson } from '../../domain/src/canonical.js';
import { ValidationFailure } from '../../domain/src/model.js';
import { captureFiles, fingerprint, hash } from '../../project-fs/src/files.js';
import { loadProject } from '../../project-fs/src/project.js';
import { loadCommittedProject, readCommittedFiles } from '../../project-fs/src/git-baseline.js';
import { parseYaml } from '../../project-fs/src/yaml.js';
import { gitText, runGit } from '../../git-workspace/src/git.js';
import { removePreservedMigration, repositoryGuard } from '../../git-workspace/src/worktree.js';
import { createProductionRegistry, MigrationRegistry, productionV1Codec } from './registry.js';
import { createFixtureRegistry } from './fixture-registry.js';
import { fixtureV2Codec } from './fixture-codecs.js';
import { createFixtureStep } from './steps/fixture-v1-v2.js';
import { objectFile, rawObject, textFile } from './source.js';
import { startMigration, resumeMigration } from './engine.js';
import { validateAudit } from './audit.js';
import { verifyMigration } from './verify.js';
import { commitFixtureEdit, fixtureRepository, removeTestRepository } from './test-helpers.js';
import type { FixtureRepository } from './test-helpers.js';
import type { DecisionMap, MigrationSnapshot, MigrationStep } from './types.js';

const repositories: FixtureRepository[] = [];
async function setup(name?: string): Promise<FixtureRepository> { const result = await fixtureRepository(name); repositories.push(result); return result; }
afterEach(async () => { for (const fixture of repositories.splice(0)) await removeTestRepository(fixture); });
const code = async (operation: Promise<unknown>, expected: string): Promise<void> => {
  try { await operation; expect.fail(`Expected ${expected}`); }
  catch (error) { expect(error).toBeInstanceOf(ValidationFailure); expect((error as ValidationFailure).diagnostics.some(d => d.code === expected)).toBe(true); }
};
const options = async (fixture: FixtureRepository) => ({ repositoryRoot: fixture.root, managedRoot: fixture.managed, registry: await createFixtureRegistry(), target: { core: 2 } });
const answer = (request: { key: string; requestDigest: string }): DecisionMap => ({ [request.key]: { requestDigest: request.requestDigest, value: { given_name: '준', family_name: '김', display_order: 'family_given' }, rationale: '원자료 작성자가 성은 김, 이름은 준이며 원래 표시는 성 다음 이름임을 확인했다.' } });

describe('registered versions and independent fixtures', () => {
  it('keeps production v1 separate from the fixture-only v2', async () => {
    const production = createProductionRegistry();
    const fixture = await createFixtureRegistry();
    expect(production.supportTable().map(row => row.core)).toEqual([1]);
    expect(fixture.supportTable().map(row => row.core)).toEqual([1, 2]);
    const v2 = await captureFiles('fixtures/migrations/v2-expected', false);
    expect(() => production.read(v2)).toThrow(/SCHEMA_UNSUPPORTED/);
    expect(fixture.read(v2).versions.core).toBe(2);
    expect(() => production.path({ core: 1 }, { core: 2 })).toThrow(/SCHEMA_UNSUPPORTED/);
  });

  it('plans explicit stepwise paths and rejects downgrade/missing steps', async () => {
    const registry = await createFixtureRegistry();
    expect(registry.path({ core: 1 }, { core: 2 }).map(step => step.id)).toEqual(['fixture-core-1-to-2']);
    expect(registry.path({ core: 2 }, { core: 2 })).toEqual([]);
    expect(() => registry.path({ core: 2 }, { core: 1 })).toThrow(/MIGRATION_PATH_UNSUPPORTED/);
    expect(() => registry.path({ core: 1 }, { core: 99 })).toThrow(/SCHEMA_UNSUPPORTED/);
  });

  it('composes adjacent steps without inventing a skipped conversion', async () => {
    const first = await createFixtureStep();
    const codec3 = { ...fixtureV2Codec, core: 3, id: 'urn:test:planning-only:3' };
    const registry = new MigrationRegistry('planning-only').registerCodec(productionV1Codec).registerCodec(fixtureV2Codec).registerCodec(codec3).registerStep(first);
    expect(() => registry.path({ core: 1 }, { core: 3 })).toThrow(/MIGRATION_PATH_UNSUPPORTED/);
    registry.registerStep({ ...first, id: 'planning-only-2-to-3', from: { core: 2 }, destination: current => ({ ...current, core: 3 }) });
    expect(registry.path({ core: 1 }, { core: 3 }).map(step => step.id)).toEqual([first.id, 'planning-only-2-to-3']);
  });

  it('matches an independently authored golden v2 and preserves meaning/old refs', async () => {
    const registry = await createFixtureRegistry();
    const before = registry.read(await captureFiles('fixtures/migrations/v1-input', false));
    const step = registry.path(before.versions, { core: 2 })[0]!;
    const changes = await step.transform(before, {});
    const actual = new Map(before.files);
    for (const change of changes.changes) actual.set(change.path, { ...objectFile(change.path, parseYaml(change.content!, change.path).value) });
    const golden = await captureFiles('fixtures/migrations/v2-expected', false);
    expect([...actual.keys()].sort()).toEqual([...golden.keys()].sort());
    for (const [path, expected] of golden) expect(actual.get(path)?.digest, path).toBe(expected.digest);
    const after = registry.read(actual);
    const report = verifyMigration(before, after);
    expect(report.semanticChecksPassed).toBe(true);
    expect(report.semanticMappings.length).toBeGreaterThan(10);
    expect(report.semanticMappings.every(mapping => mapping.before_semantic_digest === mapping.after_semantic_digest && mapping.before_dependency_digest === mapping.after_dependency_digest)).toBe(true);
    expect(report.reviewMappings[0]?.status).toBe('semantic_continuity_verified');
    expect(report.sourceMappings.some(mapping => mapping.before !== mapping.after && mapping.path.endsWith('meta.yaml'))).toBe(true);
    validateAudit('Report', report, 'report.json');
  });

  it('requires revalidation when semantic model equivalence is not proven (AT-40)', async () => {
    const registry = await createFixtureRegistry();
    const before = registry.read(await captureFiles('fixtures/migrations/v1-input', false));
    const after = { ...registry.read(await captureFiles('fixtures/migrations/v2-expected', false)), semanticModelVersion: 2 };
    const report = verifyMigration(before, after);
    expect(report.semanticChecksPassed).toBe(false);
    expect(report.diagnostics.some(d => d.code === 'REVIEW_REVALIDATION_REQUIRED')).toBe(true);
    expect(report.reviewMappings.every(mapping => mapping.status === 'revalidation_required')).toBe(true);
  });

  it('detects loss of historical task meaning and changes to fixed content', async () => {
    const registry = await createFixtureRegistry();
    const before = registry.read(await captureFiles('fixtures/migrations/v1-input', false));
    const files = new Map(await captureFiles('fixtures/migrations/v2-expected', false));
    const taskPath = 'tasks/task_outline/task.yaml';
    const task = rawObject<any>(files, taskPath); task.base.schema_versions.core = 2;
    files.set(taskPath, objectFile(taskPath, task));
    const report = verifyMigration(before, registry.read(files));
    expect(report.semanticChecksPassed).toBe(false);
    expect(report.diagnostics.some(d => d.code === 'MIGRATION_HISTORICAL_RECORD_CHANGED')).toBe(true);
    const metaPath = 'entities/ent_overview/revisions/rev_overview_a/meta.yaml';
    const meta = rawObject<any>(files, metaPath); meta.heading = '뜻을 바꾸는 수정'; files.set(metaPath, objectFile(metaPath, meta));
    expect(verifyMigration(before, registry.read(files)).diagnostics.some(d => d.code === 'MIGRATION_MEANING_CHANGED')).toBe(true);
  });

  it('rejects corrupt audit records and never repairs invalid historical reviews into valid ones', async () => {
    const registry = await createFixtureRegistry();
    const beforeFiles = new Map(await captureFiles('fixtures/migrations/v1-input', false));
    const afterFiles = new Map(await captureFiles('fixtures/migrations/v2-expected', false));
    const path = 'reviews/review_overview.yaml';
    const review = rawObject<any>(beforeFiles, path); review.subject_semantic_digest = '0'.repeat(64);
    const record = objectFile(path, review);
    beforeFiles.set(path, record); afterFiles.set(path, record);
    const report = verifyMigration(registry.read(beforeFiles), registry.read(afterFiles));
    expect(report.semanticChecksPassed).toBe(true);
    expect(report.reviewMappings[0]?.status).toBe('revalidation_required');
    afterFiles.set('migrations/attestations/mig_invalid.json', textFile('migrations/attestations/mig_invalid.json', '{}'));
    expect(() => registry.read(afterFiles)).toThrow(/SCHEMA_INVALID/);
  });
});

describe('isolated migration worktrees and preservation', () => {
  it('commits a complete result on a separate branch, retains old Git bytes and writes mappings (AT-39)', async () => {
    const fixture = await setup();
    const before = await repositoryGuard(fixture.root);
    const result = await startMigration(await options(fixture));
    expect(result.state, result.error?.message).toBe('completed');
    expect(await repositoryGuard(fixture.root)).toEqual(before);
    expect((await loadCommittedProject(fixture.root, before.commit)).project.schema_version).toBe(1);
    expect(await readFile(join(result.workspace!.path, '.git'), 'utf8')).toMatch(/^gitdir: /);
    expect(result.workspace!.branch).toMatch(/^workbench\/migration\/mig_/);
    const committed = await readCommittedFiles(result.workspace!.path, result.commit!, false);
    const interpreted = (await createFixtureRegistry()).read(committed);
    expect(interpreted.versions.core).toBe(2);
    expect(rawObject<any>(committed, 'tasks/task_outline/task.yaml').base.schema_versions.core).toBe(1);
    const history = rawObject<any>(committed, `migrations/history/${result.runId}.yaml`);
    expect(history.base_commit).toBe(before.commit);
    expect(history.from.core).toBe(1); expect(history.to.core).toBe(2);
    const attestation = JSON.parse(committed.get(`migrations/attestations/${result.runId}.json`)!.text!);
    validateAudit('Attestation', attestation, 'attestation.json');
    expect(attestation.report.reviewMappings[0].status).toBe('semantic_continuity_verified');
    expect(committed.get('reviews/review_overview.yaml')?.digest).toBe((await readCommittedFiles(fixture.root, before.commit)).get('reviews/review_overview.yaml')?.digest);
    expect(committed.get('notes/original text.txt')?.text).toContain('기존 파일도 보존');
  }, 30_000);

  it('re-runs at the target version as a true no-op without a new history/commit/worktree (AT-15)', async () => {
    const fixture = await setup();
    const initial = await startMigration(await options(fixture));
    expect(initial.state).toBe('completed');
    const before = await repositoryGuard(initial.workspace!.path);
    const worktrees = await gitText(fixture.root, ['worktree', 'list', '--porcelain']);
    const history = await readdir(join(initial.workspace!.path, 'migrations/history'));
    const second = await startMigration({ ...await options(fixture), repositoryRoot: initial.workspace!.path });
    expect(second.state).toBe('noop'); expect(second.commit).toBe(initial.commit);
    expect(second.workspace).toBeUndefined();
    expect(await repositoryGuard(initial.workspace!.path)).toEqual(before);
    expect(await gitText(fixture.root, ['worktree', 'list', '--porcelain'])).toBe(worktrees);
    expect(await readdir(join(initial.workspace!.path, 'migrations/history'))).toEqual(history);
  }, 30_000);

  it.each(['staged', 'published_file', 'before_commit'] as const)('preserves the source and failed artifacts after a failure at %s (AT-14)', async phase => {
    const fixture = await setup();
    const before = await repositoryGuard(fixture.root);
    const result = await startMigration({ ...await options(fixture), onPhase: async point => { if (point === phase) throw new Error('injected disk/process failure'); } });
    expect(result.state).toBe('failed');
    expect(await repositoryGuard(fixture.root)).toEqual(before);
    expect(await gitText(result.workspace!.path, ['rev-parse', 'HEAD'])).toBe(before.commit);
    expect((await readdir(result.runDirectory!)).includes('staging')).toBe(true);
    expect(JSON.parse(await readFile(join(result.runDirectory!, 'run.json'), 'utf8')).state).toBe('failed');
    await expect(removePreservedMigration(fixture.managed, result.workspace!, before.commit)).rejects.toBeDefined();
  }, 30_000);

  it('rejects a modified staging file and does not publish it', async () => {
    const fixture = await setup();
    const before = await repositoryGuard(fixture.root);
    const result = await startMigration({ ...await options(fixture), onPhase: async (phase, path) => { if (phase === 'staged') await writeFile(join(path, 'README.md'), 'external mutation'); } });
    expect(result.state).toBe('failed'); expect(result.error?.code).toBe('SOURCE_CHANGED');
    expect(await repositoryGuard(fixture.root)).toEqual(before);
  }, 30_000);

  it('blocks dirty source input and future versions before allocating a worktree (AT-18)', async () => {
    const fixture = await setup();
    const original = await readFile(join(fixture.root, 'README.md'));
    await writeFile(join(fixture.root, 'README.md'), 'dirty');
    const status = await gitText(fixture.root, ['status', '--porcelain=v1']);
    await code(startMigration(await options(fixture)), 'WORKTREE_DIRTY');
    expect(await gitText(fixture.root, ['status', '--porcelain=v1'])).toBe(status);
    await writeFile(join(fixture.root, 'README.md'), original);
    const path = 'project.yaml'; const files = await captureFiles(fixture.root);
    const project = rawObject<any>(files, path); project.schema_version = 99;
    await writeFile(join(fixture.root, path), objectFile(path, project).text!);
    await commitFixtureEdit(fixture.root);
    await code(startMigration(await options(fixture)), 'SCHEMA_UNSUPPORTED');
    expect((await gitText(fixture.root, ['worktree', 'list', '--porcelain'])).match(/^worktree /gm)).toHaveLength(1);
  }, 30_000);

  it('cleans only a fully committed clean result and keeps its branch', async () => {
    const fixture = await setup();
    const result = await startMigration(await options(fixture)); expect(result.state).toBe('completed');
    await removePreservedMigration(fixture.managed, result.workspace!, result.commit!);
    expect(await gitText(fixture.root, ['rev-parse', `refs/heads/${result.workspace!.branch}`])).toBe(result.commit);
    expect((await gitText(fixture.root, ['worktree', 'list', '--porcelain'])).match(/^worktree /gm)).toHaveLength(1);
  }, 30_000);

  it('does not steal an existing metadata lock', async () => {
    const fixture = await setup();
    const guard = await repositoryGuard(fixture.root);
    const path = join(guard.commonDir, 'craft-migration.lock');
    await writeFile(path, JSON.stringify({ token: 'another-owner', pid: 99999 }));
    await code(startMigration(await options(fixture)), 'WORKTREE_BUSY');
    expect(JSON.parse(await readFile(path, 'utf8')).token).toBe('another-owner');
  }, 30_000);

  it('blocks ignored canonical files outside the committed basis', async () => {
    const fixture = await setup();
    await writeFile(join(fixture.root, '.gitignore'), 'assets/*\n');
    await commitFixtureEdit(fixture.root);
    await mkdir(join(fixture.root, 'assets'));
    await writeFile(join(fixture.root, 'assets', 'uncommitted.txt'), 'not in Git');
    expect(await gitText(fixture.root, ['status', '--porcelain=v1'])).toBe('');
    await code(startMigration(await options(fixture)), 'WORKTREE_DIRTY');
    expect(await readFile(join(fixture.root, 'assets', 'uncommitted.txt'), 'utf8')).toBe('not in Git');
  }, 30_000);

  it('does not inherit another repository or index from Git environment variables', async () => {
    const fixture = await setup();
    const other = await setup('manual-v1-input');
    const keys = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'] as const;
    const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    try {
      process.env['GIT_DIR'] = join(other.root, '.git');
      process.env['GIT_WORK_TREE'] = other.root;
      process.env['GIT_INDEX_FILE'] = join(other.root, '.git', 'index');
      const project = await loadCommittedProject(fixture.root, 'HEAD');
      expect(project.entities.size).toBeGreaterThan(5);
      expect(project.project.extensions['fixture.person']).toBeUndefined();
    } finally {
      for (const key of keys) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  }, 30_000);

  it('refuses cleanup when a completed worktree has unpreserved local data', async () => {
    const fixture = await setup();
    const result = await startMigration(await options(fixture)); expect(result.state, JSON.stringify(result.error)).toBe('completed');
    await writeFile(join(result.workspace!.path, 'local-draft.txt'), 'uncommitted result');
    await code(removePreservedMigration(fixture.managed, result.workspace!, result.commit!), 'WORKTREE_UNPRESERVED');
    expect(await readFile(join(result.workspace!.path, 'local-draft.txt'), 'utf8')).toBe('uncommitted result');
  }, 30_000);
});

describe('explicit decisions and review boundaries', () => {
  it('waits without guessing, resumes from persisted files, and preserves a manual mapping (AT-16)', async () => {
    const fixture = await setup('manual-v1-input');
    const before = await repositoryGuard(fixture.root);
    const configuration = await options(fixture);
    const waiting = await startMigration(configuration);
    expect(waiting.state).toBe('waiting_for_decision');
    expect(await repositoryGuard(fixture.root)).toEqual(before);
    expect((await loadProject(waiting.workspace!.path)).project.schema_version).toBe(1);
    const request = waiting.missingDecisions![0]!;
    const done = await resumeMigration({ repositoryRoot: fixture.root, managedRoot: fixture.managed, registry: await createFixtureRegistry(), runId: waiting.runId!, decisions: answer(request) });
    expect(done.state, done.error?.message).toBe('completed');
    expect(done.runId).toBe(waiting.runId);
    expect(await repositoryGuard(fixture.root)).toEqual(before);
    const golden = await captureFiles('fixtures/migrations/manual-v2-expected', false);
    const actual = await captureFiles(done.workspace!.path, false);
    for (const [path, file] of golden) expect(actual.get(path)?.digest, path).toBe(file.digest);
    expect(done.report?.reviewMappings[0]?.status).toBe('revalidation_required');
    const decisionFile = rawObject<any>(actual, `migrations/decisions/${done.runId}.json`);
    expect(decisionFile.answers[request.key].value.given_name).toBe('준');
    await code(resumeMigration({ ...configuration, runId: waiting.runId!, decisions: answer(request) }), 'MIGRATION_RUN_NOT_RESUMABLE');
  }, 30_000);

  it('keeps stale/invalid answers waiting and rejects a split that changes meaning', async () => {
    const fixture = await setup('manual-v1-input'); const configuration = await options(fixture);
    const waiting = await startMigration(configuration); const request = waiting.missingDecisions![0]!;
    const stale = { ...answer(request), [request.key]: { ...answer(request)[request.key]!, requestDigest: '0'.repeat(64) } };
    const again = await resumeMigration({ ...configuration, runId: waiting.runId!, decisions: stale });
    expect(again.state).toBe('waiting_for_decision'); expect(again.error?.code).toBe('MIGRATION_DECISION_INVALID');
    const changed: DecisionMap = { [request.key]: { requestDigest: request.requestDigest, value: { given_name: '다른', family_name: '인물', display_order: 'given_family' }, rationale: 'invalid content edit' } };
    const rejected = await resumeMigration({ ...configuration, runId: waiting.runId!, decisions: changed });
    expect(rejected.state).toBe('failed'); expect(rejected.error?.code).toBe('MIGRATION_DECISION_CHANGES_MEANING');
    expect((await loadProject(fixture.root)).project.schema_version).toBe(1);
  }, 30_000);

  it('invalidates a paused plan when its source changes', async () => {
    const fixture = await setup('manual-v1-input'); const configuration = await options(fixture);
    const waiting = await startMigration(configuration);
    await writeFile(join(fixture.root, 'README.md'), 'user edit after preflight');
    await code(resumeMigration({ ...configuration, runId: waiting.runId!, decisions: answer(waiting.missingDecisions![0]!) }), 'WORKTREE_DIRTY');
    expect(await readFile(join(fixture.root, 'README.md'), 'utf8')).toBe('user edit after preflight');
  }, 30_000);

  it('rejects a paused journal whose guard points to another scope', async () => {
    const fixture = await setup('manual-v1-input'); const configuration = await options(fixture);
    const waiting = await startMigration(configuration);
    const path = join(waiting.runDirectory!, 'run.json');
    const journal = JSON.parse(await readFile(path, 'utf8')); journal.workspaceGuard.root = fixture.root;
    await writeFile(path, JSON.stringify(journal));
    await code(resumeMigration({ ...configuration, runId: waiting.runId!, decisions: answer(waiting.missingDecisions![0]!) }), 'MIGRATION_RUN_SCOPE_MISMATCH');
    expect((await loadProject(fixture.root)).project.schema_version).toBe(1);
  }, 30_000);

  it('cannot accept a step that reports success while changing content', async () => {
    const fixture = await setup();
    const realStep = await createFixtureStep();
    const broken: MigrationStep = { ...realStep, async transform(input, decisions) {
      const result = await realStep.transform(input, decisions);
      return { ...result, changes: result.changes.map(change => change.path.endsWith('rev_overview_a/meta.yaml') ? { ...change, content: change.content!.replace('기획 개요', '조작된 내용') } : change) };
    }, async verify(before, after) { return { ...verifyMigration(before, after), semanticChecksPassed: true, diagnostics: [] }; } };
    // A fake success report is still followed by the engine's independent mandatory verifier.
    const registry = new MigrationRegistry('fault-fixture').registerCodec(productionV1Codec).registerCodec(fixtureV2Codec).registerStep(broken);
    const result = await startMigration({ ...await options(fixture), registry });
    expect(result.state).toBe('review_required');
    expect(result.report?.diagnostics.some(d => d.code === 'MIGRATION_MEANING_CHANGED')).toBe(true);
    expect(await readFile(join(result.runDirectory!, 'verification-failed-0/entities/ent_overview/revisions/rev_overview_a/meta.yaml'), 'utf8')).toContain('조작된 내용');
    expect(await gitText(result.workspace!.path, ['rev-parse', 'HEAD'])).toBe(result.workspace!.baseCommit);
  }, 30_000);
});
