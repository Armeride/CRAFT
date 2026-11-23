import { canonicalJson } from '../../domain/src/canonical.js';
import type { SourceFile } from '../../domain/src/model.js';
import { fileFailure } from '../../project-fs/src/files.js';
import type { MigrationRegistry } from './registry.js';
import { applyStep } from './step-changes.js';
import type { MigrationSnapshot, MigrationStep, VersionSet } from './types.js';
import { verifyMigration } from './verify.js';

function unsupported(message: string) {
  return fileFailure('MIGRATION_MERGE_UNSUPPORTED', message, 'project.yaml');
}

async function normalize(registry: MigrationRegistry, input: MigrationSnapshot, target: VersionSet) {
  const steps = registry.path(input.versions, target);
  const snapshot = await steps.reduce<Promise<MigrationSnapshot>>(async (previous, step) => {
    const before = await previous;
    const plan = await step.preflight(before);
    if (plan.decisions.length) throw unsupported('Normalization requires a shared, verified decision mapping');
    const after = registry.read(applyStep(before, await step.transform(before, {}), plan.expectedFiles));
    if (canonicalJson(after.versions) !== canonicalJson(step.destination(before.versions))) throw unsupported('Conversion did not produce the expected schema set');
    const stepReport = await step.verify(before, after);
    const report = verifyMigration(before, after);
    if (!stepReport.semanticChecksPassed || !stepReport.referencesValid || !report.semanticChecksPassed || !report.referencesValid) throw unsupported('Conversion did not preserve verified semantics');
    return after;
  }, Promise.resolve(input));
  if (canonicalJson(snapshot.versions) !== canonicalJson(target)) throw unsupported('All three inputs must have the exact target schema set');
  const report = verifyMigration(input, snapshot);
  if (!report.semanticChecksPassed || !report.referencesValid) throw unsupported('The full conversion did not preserve verified semantics');
  return { snapshot, report, steps: steps.map(({ id, implementationDigest }) => ({ id, implementationDigest })) };
}

/** Prepares comparison inputs only. Branches, worktrees and historical reviews stay intact. */
export async function normalizeMergeInputs(registry: MigrationRegistry, inputs: {
  basis: ReadonlyMap<string, SourceFile>; target: ReadonlyMap<string, SourceFile>; result: ReadonlyMap<string, SourceFile>;
}) {
  try {
    const basis = registry.read(inputs.basis), target = registry.read(inputs.target), result = registry.read(inputs.result);
    const [normalizedBasis, normalizedResult] = await Promise.all([
      normalize(registry, basis, target.versions), normalize(registry, result, target.versions),
    ]);
    const identities = (steps: readonly Pick<MigrationStep, 'id' | 'implementationDigest'>[]) => steps.map(step => canonicalJson(step));
    const basisSteps = identities(normalizedBasis.steps), resultSteps = identities(normalizedResult.steps);
    if (resultSteps.some((step, index) => step !== basisSteps[basisSteps.length - resultSteps.length + index])) throw unsupported('The conversion paths do not share the same registered steps');
    return { basis: normalizedBasis, target, result: normalizedResult };
  } catch (error) {
    throw unsupported(error instanceof Error ? error.message : 'No verified normalization is available');
  }
}
