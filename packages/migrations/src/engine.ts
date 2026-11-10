import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { canonicalJson } from '../../domain/src/canonical.js';
import { isProjectPath } from '../../domain/src/path.js';
import { ValidationFailure } from '../../domain/src/model.js';
import type { SourceFile } from '../../domain/src/model.js';
import { readCommittedFiles } from '../../project-fs/src/git-baseline.js';
import { captureFiles, fileFailure, fingerprint, hash, newId } from '../../project-fs/src/files.js';
import { parseYaml } from '../../project-fs/src/yaml.js';
import { assertOwnedPath, assertSourceUnchanged, checkedManagedRoot, commitMigration, createMigrationWorktree, materializeFiles, repositoryGuard, withRepositoryLock } from '../../git-workspace/src/worktree.js';
import type { RepositoryGuard, ScratchWorkspace } from '../../git-workspace/src/worktree.js';
import { canonicalFiles, MigrationRegistry } from './registry.js';
import { objectFile, textFile } from './source.js';
import { validateAudit } from './audit.js';
import { verifyMigration } from './verify.js';
import type { DecisionMap, DecisionRequest, MigrationPlan, MigrationReport, MigrationSnapshot, VersionSet } from './types.js';
import type { Journal as AuditJournal } from './generated-audit.js';

export type RunState = AuditJournal['state'];
interface Journal extends AuditJournal {
  source: RepositoryGuard;
  workspace: ScratchWorkspace;
  workspaceGuard?: RepositoryGuard;
}
export interface MigrationResult {
  state: RunState | 'noop';
  commit?: string;
  runId?: string;
  runDirectory?: string;
  workspace?: ScratchWorkspace;
  plan: MigrationPlan;
  report?: MigrationReport;
  missingDecisions?: readonly DecisionRequest[];
  error?: { code: string; message: string };
}
export type MigrationPhase = 'worktree_created' | 'staged' | 'published_file' | 'before_commit';
export interface MigrationOptions {
  repositoryRoot: string;
  managedRoot: string;
  registry: MigrationRegistry;
  target: VersionSet;
  decisions?: DecisionMap;
  /** Internal instrumentation/fault injection. Never loaded from a project. */
  onPhase?: (phase: MigrationPhase, path: string) => Promise<void>;
}
interface RunContext { managedRoot: string; runDirectory: string; journal: Journal; options: Omit<MigrationOptions, 'target'>; basis: MigrationSnapshot; plan: MigrationPlan }

async function writeAtomic(root: string, path: string, text: string): Promise<void> {
  await assertOwnedPath(root, path);
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + `.${newId('tmp')}`;
  const handle = await open(temporary, 'wx');
  try { await handle.writeFile(text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, path);
}
async function writeAudit(root: string, path: string, definition: string, value: unknown): Promise<void> {
  validateAudit(definition, value, path);
  await writeAtomic(root, path, JSON.stringify(value, null, 2) + '\n');
}
async function saveJournal(context: RunContext): Promise<void> { await writeAudit(context.managedRoot, join(context.runDirectory, 'run.json'), 'Journal', context.journal); }

function applyStep(input: MigrationSnapshot, changes: Awaited<ReturnType<import('./types.js').MigrationStep['transform']>>, expectedFiles: readonly string[]): ReadonlyMap<string, SourceFile> {
  if (changes.expectedSnapshot !== fingerprint(input.files)) throw fileFailure('BASE_CHANGED', 'Step input fingerprint changed', 'project.yaml');
  const files = new Map(input.files);
  const seen = new Set<string>();
  for (const change of changes.changes) {
    if (!isProjectPath(change.path) || !expectedFiles.includes(change.path) || seen.has(change.path)) throw fileFailure('MIGRATION_CHANGE_OUT_OF_PLAN', 'Step wrote a duplicate, unsafe or undeclared path', change.path);
    seen.add(change.path);
    if ((files.get(change.path)?.digest ?? null) !== change.expectedDigest) throw fileFailure('FILE_CHANGED_EXTERNALLY', 'Step expected source digest differs', change.path);
    if (change.content === null) files.delete(change.path);
    else files.set(change.path, textFile(change.path, change.content));
  }
  return files;
}
function answerErrors(requests: readonly DecisionRequest[], answers: DecisionMap): string[] {
  const errors: string[] = [];
  for (const request of requests) {
    const answer = answers[request.key];
    if (!answer) continue;
    if (answer.requestDigest !== request.requestDigest || !answer.rationale.trim()) { errors.push(`MIGRATION_DECISION_INVALID: ${request.key} has a stale digest or empty rationale`); continue; }
    const validate = new Ajv2020({ strict: true }).compile(request.valueSchema);
    if (!validate(answer.value)) errors.push(`MIGRATION_DECISION_INVALID: ${request.key} does not match its value schema`);
  }
  return errors;
}

async function execute(context: RunContext, answers: DecisionMap): Promise<MigrationResult> {
  const { options, journal, runDirectory, managedRoot, basis } = context;
  let current = basis;
  const requests: DecisionRequest[] = [];
  const expected = new Set<string>();
  try {
    try { validateAudit('Answers', answers, 'answers.json'); }
    catch (error) {
      journal.state = 'waiting_for_decision';
      journal.error = { code: 'MIGRATION_DECISION_INVALID', message: String(error) };
      journal.workspaceGuard = await repositoryGuard(journal.workspace.path);
      await saveJournal(context);
      return { state: journal.state, runId: journal.runId, runDirectory, workspace: journal.workspace, plan: context.plan, missingDecisions: context.plan.decisions, error: journal.error };
    }
    const answersFile = `decisions/${newId('answer')}.json`;
    await writeAudit(managedRoot, join(runDirectory, answersFile), 'Answers', answers);
    journal.answersFile = answersFile;
    for (const [stepIndex, step] of options.registry.path(basis.versions, context.plan.to).entries()) {
      const preflight = await step.preflight(current);
      preflight.expectedFiles.forEach(path => expected.add(path));
      requests.push(...preflight.decisions);
      const errors = answerErrors(preflight.decisions, answers);
      const missing = preflight.decisions.filter(request => !answers[request.key] || errors.some(error => error.includes(request.key)));
      context.plan = { ...context.plan, decisions: requests, expectedFiles: [...expected].sort() };
      journal.planDigest = hash(canonicalJson(context.plan));
      await writeAudit(managedRoot, join(runDirectory, 'plan.json'), 'Plan', context.plan);
      if (missing.length || errors.length) {
        journal.state = 'waiting_for_decision';
        if (errors.length) journal.error = { code: 'MIGRATION_DECISION_INVALID', message: errors.join('\n') };
        else delete journal.error;
        journal.workspaceGuard = await repositoryGuard(journal.workspace.path);
        await assertSourceUnchanged(journal.source);
        await saveJournal(context);
        return { state: journal.state, runId: journal.runId, runDirectory, workspace: journal.workspace, plan: context.plan, missingDecisions: missing, ...(journal.error ? { error: journal.error } : {}) };
      }
      const candidateFiles = applyStep(current, await step.transform(current, answers), preflight.expectedFiles);
      let candidate: MigrationSnapshot;
      try { candidate = options.registry.read(candidateFiles); }
      catch (error) {
        const rejected = join(runDirectory, `invalid-stage-${stepIndex}`);
        await mkdir(rejected);
        await materializeFiles(rejected, candidateFiles);
        throw error;
      }
      if (canonicalJson(candidate.versions) !== canonicalJson(step.destination(current.versions))) throw fileFailure('MIGRATION_VERSION_MISMATCH', 'Step did not produce its declared version set', 'project.yaml');
      const stepReport = await step.verify(current, candidate);
      const mandatoryReport = verifyMigration(current, candidate);
      if (!stepReport.semanticChecksPassed || !mandatoryReport.semanticChecksPassed) {
        const rejected = join(runDirectory, `verification-failed-${stepIndex}`);
        await mkdir(rejected);
        await materializeFiles(rejected, candidate.files);
        await writeAudit(managedRoot, join(runDirectory, 'report.json'), 'Report', mandatoryReport);
        journal.state = 'review_required';
        journal.error = { code: mandatoryReport.diagnostics[0]?.code ?? 'MIGRATION_VERIFICATION_FAILED', message: 'Semantic verification did not pass; source and workspace are preserved' };
        await saveJournal(context);
        return { state: journal.state, runId: journal.runId, runDirectory, workspace: journal.workspace, plan: context.plan, report: mandatoryReport, error: journal.error };
      }
      current = candidate;
    }
    const knownKeys = new Set(requests.map(request => request.key));
    if (Object.keys(answers).some(key => !knownKeys.has(key))) throw fileFailure('MIGRATION_DECISION_UNEXPECTED', 'An answer does not correspond to any request', 'project.yaml');
    const report = verifyMigration(basis, current);
    if (!report.semanticChecksPassed || !report.referencesValid) throw fileFailure('MIGRATION_VERIFICATION_FAILED', 'Final semantic verification failed', 'project.yaml');
    await writeAudit(managedRoot, join(runDirectory, 'report.json'), 'Report', report);
    const decisionRecord = { protocol: 1, id: journal.runId, registry_id: options.registry.id, basis_fingerprint: fingerprint(basis.files), answers, created_at: journal.createdAt };
    validateAudit('DecisionRecord', decisionRecord, 'migration decisions');
    const attestation = { protocol: 1, id: journal.runId, registry_id: options.registry.id, base_commit: journal.source.commit, from: basis.versions, to: current.versions, steps: context.plan.steps, report, decisions_digest: hash(canonicalJson(decisionRecord)), created_at: journal.createdAt };
    validateAudit('Attestation', attestation, 'migration attestation');
    const finalFiles = new Map(current.files);
    const append = (path: string, value: unknown): void => {
      if (finalFiles.has(path)) throw fileFailure('MIGRATION_AUDIT_COLLISION', 'Audit record already exists', path);
      finalFiles.set(path, objectFile(path, value));
    };
    append(`migrations/decisions/${journal.runId}.json`, decisionRecord);
    append(`migrations/attestations/${journal.runId}.json`, attestation);
    append(`migrations/history/${journal.runId}.yaml`, { id: journal.runId, tool_version: '0.0.0', base_commit: journal.source.commit, from: basis.versions, to: current.versions, steps: context.plan.steps.map(step => ({ id: step.id, implementation_digest: step.implementationDigest })), decisions: Object.entries(answers).map(([key, answer]) => ({ key, value: answer.value, rationale: answer.rationale })), verification: { schema_valid: true, references_valid: true, semantic_checks_passed: true }, created_at: journal.createdAt });
    options.registry.read(finalFiles);
    const staging = join(runDirectory, 'staging');
    await assertOwnedPath(managedRoot, staging);
    await mkdir(staging);
    await materializeFiles(staging, finalFiles);
    const capturedStage = await captureFiles(staging, false);
    options.registry.read(capturedStage);
    // Every canonical staged byte must match the planned candidate before any publishing.
    if (fingerprint(capturedStage) !== fingerprint(finalFiles)) throw fileFailure('SOURCE_CHANGED', 'Staged file set differs from validated candidate', 'project.yaml');
    journal.state = 'staged';
    await saveJournal(context);
    await options.onPhase?.('staged', staging);
    if (fingerprint(await captureFiles(staging, false)) !== fingerprint(capturedStage)) throw fileFailure('SOURCE_CHANGED', 'Staging changed after verification', 'project.yaml');
    await assertSourceUnchanged(journal.source);
    if (journal.workspaceGuard) await assertSourceUnchanged(journal.workspaceGuard);
    else if ((await repositoryGuard(journal.workspace.path)).commit !== journal.source.commit) throw fileFailure('BASE_CHANGED', 'Migration workspace moved', 'project.yaml');
    journal.state = 'publishing';
    await saveJournal(context);
    const changed = [...new Set([...basis.files.keys(), ...finalFiles.keys()])].filter(path => basis.files.get(path)?.digest !== finalFiles.get(path)?.digest);
    for (const path of changed) {
      const target = join(journal.workspace.path, ...path.split('/'));
      await assertOwnedPath(journal.workspace.path, target);
      const original = basis.files.get(path);
      try {
        const actual = hash(await readFile(target));
        if (!original || actual !== original.digest) throw fileFailure('FILE_CHANGED_EXTERNALLY', 'Worktree file changed before migration publish', path);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || original) throw error; }
      const file = finalFiles.get(path);
      if (file) await writeAtomic(journal.workspace.path, target, Buffer.from(file.contentBase64, 'base64').toString('utf8'));
      else await unlink(target);
      await options.onPhase?.('published_file', path);
    }
    const published = await captureFiles(journal.workspace.path, false);
    if (fingerprint(published) !== fingerprint(capturedStage)) throw fileFailure('SOURCE_CHANGED', 'Published canonical bytes differ from the validated stage', 'project.yaml');
    options.registry.read(published);
    await options.onPhase?.('before_commit', journal.workspace.path);
    if (fingerprint(await captureFiles(journal.workspace.path, false)) !== fingerprint(finalFiles)) throw fileFailure('SOURCE_CHANGED', 'Migration workspace changed before commit', 'project.yaml');
    await assertSourceUnchanged(journal.source);
    const commit = await commitMigration(journal.workspace, changed.map(path => ({ path, file: finalFiles.get(path) ?? null })), `migration: ${context.plan.steps.map(step => step.id).join(', ')}`);
    const committed = await readCommittedFiles(journal.workspace.path, commit, false);
    if (fingerprint(committed) !== fingerprint(finalFiles)) throw fileFailure('MIGRATION_COMMIT_MISMATCH', 'Committed tree differs from the verified candidate', 'project.yaml');
    await assertSourceUnchanged(journal.source);
    journal.state = 'completed';
    journal.resultCommit = commit;
    journal.resultFingerprint = fingerprint(committed);
    delete journal.error;
    await saveJournal(context);
    return { state: journal.state, commit, runId: journal.runId, runDirectory, workspace: journal.workspace, plan: context.plan, report };
  } catch (error) {
    journal.state = 'failed';
    journal.error = { code: error instanceof ValidationFailure ? error.diagnostics[0]?.code ?? 'MIGRATION_FAILED' : 'MIGRATION_FAILED', message: error instanceof Error ? error.message : String(error) };
    if (current !== basis) {
      const recovery = join(runDirectory, `recovery-${newId('stage')}`);
      await mkdir(recovery);
      await materializeFiles(recovery, current.files);
    }
    await saveJournal(context);
    return { state: journal.state, runId: journal.runId, runDirectory, workspace: journal.workspace, plan: context.plan, error: journal.error };
  }
}

export async function startMigration(options: MigrationOptions): Promise<MigrationResult> {
  return withRepositoryLock(options.repositoryRoot, async () => {
    const source = await repositoryGuard(options.repositoryRoot);
    const basis = options.registry.read(await readCommittedFiles(source.root, source.commit, false));
    const visibleFiles = await captureFiles(source.root);
    if (canonicalJson([...visibleFiles.keys()].sort()) !== canonicalJson([...canonicalFiles(basis.files).keys()].sort())) throw fileFailure('WORKTREE_DIRTY', 'Ignored/untracked canonical files are outside the committed migration basis', 'project.yaml');
    const plan = await options.registry.preflight(basis, options.target);
    validateAudit('Plan', plan, 'preflight plan');
    if (!plan.steps.length) return { state: 'noop', commit: source.commit, plan };
    const managedRoot = await checkedManagedRoot(options.managedRoot, source.root);
    const runId = newId('mig');
    const runDirectory = join(managedRoot, 'runs', runId);
    await assertOwnedPath(managedRoot, runDirectory);
    await mkdir(runDirectory, { recursive: true });
    const workspace = { path: join(managedRoot, 'worktrees', runId), branch: `workbench/migration/${runId}`, baseCommit: source.commit, sourceRoot: source.root };
    const journal: Journal = { protocol: 1, runId, registryId: options.registry.id, state: 'starting', source, workspace, basisPlanDigest: hash(canonicalJson(plan)), planDigest: hash(canonicalJson(plan)), createdAt: new Date().toISOString() };
    const context: RunContext = { managedRoot, runDirectory, journal, options, basis, plan };
    await writeAudit(managedRoot, join(runDirectory, 'plan.json'), 'Plan', plan);
    await saveJournal(context);
    try {
      await assertSourceUnchanged(source);
      journal.workspace = await createMigrationWorktree(source, managedRoot, runId, basis.files);
      journal.workspaceGuard = await repositoryGuard(journal.workspace.path);
      await saveJournal(context);
      await options.onPhase?.('worktree_created', workspace.path);
    } catch (error) {
      journal.state = 'failed';
      journal.error = { code: 'MIGRATION_PREPARATION_FAILED', message: String(error) };
      await saveJournal(context);
      return { state: journal.state, runId, runDirectory, workspace, plan, error: journal.error };
    }
    return execute(context, options.decisions ?? {});
  });
}

export interface ResumeOptions extends Omit<MigrationOptions, 'target'> { runId: string }
export async function resumeMigration(options: ResumeOptions): Promise<MigrationResult> {
  if (!/^mig_[a-f0-9-]+$/.test(options.runId)) throw new Error('Invalid run ID');
  return withRepositoryLock(options.repositoryRoot, async () => {
    const sourceRoot = (await repositoryGuard(options.repositoryRoot)).root;
    const managedRoot = await checkedManagedRoot(options.managedRoot, sourceRoot);
    const runDirectory = join(managedRoot, 'runs', options.runId);
    await assertOwnedPath(managedRoot, runDirectory);
    await assertOwnedPath(managedRoot, join(runDirectory, 'run.json'));
    const journal = JSON.parse(await readFile(join(runDirectory, 'run.json'), 'utf8')) as Journal;
    validateAudit('Journal', journal, 'run.json');
    const workspacePath = join(managedRoot, 'worktrees', options.runId);
    if (journal.runId !== options.runId || journal.registryId !== options.registry.id || journal.source.root !== sourceRoot || journal.workspace.sourceRoot !== sourceRoot || journal.workspace.path !== workspacePath || journal.workspace.branch !== `workbench/migration/${options.runId}`) throw fileFailure('MIGRATION_RUN_SCOPE_MISMATCH', 'Journal does not belong to this repository/run', 'project.yaml');
    if (journal.workspace.baseCommit !== journal.source.commit || (journal.workspaceGuard && (journal.workspaceGuard.root !== workspacePath || journal.workspaceGuard.commonDir !== journal.source.commonDir || journal.workspaceGuard.commit !== journal.source.commit))) throw fileFailure('MIGRATION_RUN_SCOPE_MISMATCH', 'Workspace guard/base does not belong to this run', 'project.yaml');
    await assertOwnedPath(managedRoot, workspacePath);
    if (journal.state !== 'waiting_for_decision') throw fileFailure('MIGRATION_RUN_NOT_RESUMABLE', 'Only a decision-waiting run can resume; failed worktrees are preserved for inspection', 'project.yaml');
    await assertSourceUnchanged(journal.source);
    if (!journal.workspaceGuard) throw new Error('Waiting workspace guard is missing');
    await assertSourceUnchanged(journal.workspaceGuard);
    const basis = options.registry.read(await readCommittedFiles(sourceRoot, journal.source.commit, false));
    await assertOwnedPath(managedRoot, join(runDirectory, 'plan.json'));
    const storedPlan = JSON.parse(await readFile(join(runDirectory, 'plan.json'), 'utf8')) as MigrationPlan;
    validateAudit('Plan', storedPlan, 'plan.json');
    const originalPlan = await options.registry.preflight(basis, storedPlan.to);
    if (hash(canonicalJson(originalPlan)) !== journal.basisPlanDigest || hash(canonicalJson(storedPlan)) !== journal.planDigest) throw fileFailure('MIGRATION_PLAN_STALE', 'Migration implementation, codec or saved plan changed', 'project.yaml');
    let prior: DecisionMap = {};
    if (journal.answersFile) {
      if (!/^decisions\/answer_[a-f0-9-]+\.json$/.test(journal.answersFile)) throw new Error('Unsafe answer record path');
      await assertOwnedPath(managedRoot, join(runDirectory, journal.answersFile));
      prior = JSON.parse(await readFile(join(runDirectory, journal.answersFile), 'utf8')) as DecisionMap;
      validateAudit('Answers', prior, 'answers.json');
    }
    return execute({ managedRoot, runDirectory, journal, options, basis, plan: storedPlan }, { ...prior, ...options.decisions });
  });
}
