import { canonicalJson, deepFreeze } from '../../domain/src/canonical.js';
import { fileFailure, fingerprint } from '../../project-fs/src/files.js';
import { builtinSchemaDigest, parseProject } from '../../project-fs/src/project.js';
import { parseYaml } from '../../project-fs/src/yaml.js';
import { isCanonicalPath } from '../../project-fs/src/files.js';
import type { SourceFile } from '../../domain/src/model.js';
import type { MigrationPlan, MigrationSnapshot, MigrationStep, ProjectCodec, VersionSet } from './types.js';
import { validateMigrationArtifacts } from './audit.js';

export function inspectVersions(files: ReadonlyMap<string, SourceFile>): VersionSet {
  const manifest = files.get('project.yaml');
  if (manifest?.text === undefined) throw fileFailure('PROJECT_IMPORT_REQUIRED', 'project.yaml is required', 'project.yaml');
  const value = parseYaml(manifest.text, manifest.path).value;
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Number.isSafeInteger(value['schema_version']) || Number(value['schema_version']) < 1) throw fileFailure('SCHEMA_INVALID', 'schema_version must be a positive integer', 'project.yaml');
  const versions: Record<string, number> & { core: number } = { core: Number(value['schema_version']) };
  const extensions = value['extensions'];
  if (!extensions || typeof extensions !== 'object' || Array.isArray(extensions)) throw fileFailure('SCHEMA_INVALID', 'extensions must be an object', 'project.yaml');
  for (const [name, declaration] of Object.entries(extensions)) {
    if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration) || !Number.isSafeInteger(declaration['schema_version']) || Number(declaration['schema_version']) < 1) throw fileFailure('SCHEMA_INVALID', 'Extension versions must be positive integers', 'project.yaml');
    versions[name] = Number(declaration['schema_version']);
  }
  return deepFreeze(versions);
}

export const canonicalFiles = (files: ReadonlyMap<string, SourceFile>): ReadonlyMap<string, SourceFile> => new Map([...files].filter(([path]) => isCanonicalPath(path)));
export const productionV1Codec: ProjectCodec = {
  core: 1,
  id: 'urn:craft:schema:core:1',
  digest: builtinSchemaDigest,
  read(files, registryId) {
    const normalized = parseProject(canonicalFiles(files));
    if (!normalized.writable || [...normalized.entities.values()].some(entity => [...entity.revisions.values()].some(revision => !revision.writable))) throw fileFailure('MIGRATION_EXTENSION_UNSUPPORTED', 'Migration requires complete extension semantics', 'project.yaml');
    return { registryId, files, normalized, versions: inspectVersions(files), semanticModelVersion: 1 };
  },
};

const matches = (current: VersionSet, required: VersionSet): boolean => Object.entries(required).every(([key, value]) => current[key] === value);

export class MigrationRegistry {
  private readonly codecs = new Map<number, ProjectCodec>();
  private readonly steps = new Map<string, MigrationStep>();
  constructor(readonly id: string) {}

  registerCodec(codec: ProjectCodec): this {
    if (this.codecs.has(codec.core)) throw new Error('Duplicate codec version');
    this.codecs.set(codec.core, codec);
    return this;
  }
  registerStep(step: MigrationStep): this {
    if (this.steps.has(step.id) || !/^[a-f0-9]{64}$/.test(step.implementationDigest)) throw new Error('Invalid or duplicate migration step');
    this.steps.set(step.id, step);
    return this;
  }
  supportTable(): readonly { registryId: string; core: number; read: true; candidateWrite: true; migrateFrom: readonly number[] }[] {
    return [...this.codecs.values()].map(codec => ({ registryId: this.id, core: codec.core, read: true, candidateWrite: true, migrateFrom: [...this.steps.values()].filter(step => step.destination(step.from).core === codec.core).map(step => step.from.core) }));
  }
  read(files: ReadonlyMap<string, SourceFile>): MigrationSnapshot {
    const version = inspectVersions(files).core;
    const codec = this.codecs.get(version);
    if (!codec) throw fileFailure('SCHEMA_UNSUPPORTED', `Registry ${this.id} does not support core ${version}`, 'project.yaml');
    const result = codec.read(files, this.id);
    validateMigrationArtifacts(files);
    return result;
  }
  path(from: VersionSet, target: VersionSet): readonly MigrationStep[] {
    if (!this.codecs.has(from.core) || !this.codecs.has(target.core)) throw fileFailure('SCHEMA_UNSUPPORTED', 'Source or target codec is unavailable', 'project.yaml');
    for (const [key, value] of Object.entries(target)) if (!Number.isSafeInteger(value) || value < (from[key] ?? 1)) throw fileFailure('MIGRATION_PATH_UNSUPPORTED', 'Downgrades and invalid target versions are not supported', 'project.yaml');
    const queue: { current: VersionSet; steps: readonly MigrationStep[] }[] = [{ current: from, steps: [] }];
    const visited = new Set<string>();
    for (let index = 0; index < queue.length; index++) {
      const item = queue[index]!;
      if (matches(item.current, target)) return item.steps;
      const key = canonicalJson(item.current);
      if (visited.has(key)) continue;
      visited.add(key);
      for (const step of this.steps.values()) {
        if (!matches(item.current, step.from)) continue;
        const next = step.destination(item.current);
        const changed = Object.keys(next).filter(name => next[name] !== item.current[name]);
        if (!changed.length || changed.some(name => next[name] !== (item.current[name] ?? 0) + 1) || Object.keys(item.current).some(name => !(name in next))) throw new Error(`Step ${step.id} must advance explicit versions one at a time`);
        if (this.codecs.has(next.core) && queue.length < 256) queue.push({ current: next, steps: [...item.steps, step] });
      }
    }
    throw fileFailure('MIGRATION_PATH_UNSUPPORTED', 'No registered stepwise conversion path', 'project.yaml');
  }
  async preflight(input: MigrationSnapshot, target: VersionSet): Promise<MigrationPlan> {
    if (input.registryId !== this.id) throw new Error('Registry scope mismatch');
    const steps = this.path(input.versions, target);
    const files = new Set<string>();
    const decisions = [];
    const warnings = [];
    // Later-step preflight needs its transformed schema. The engine repeats it on each actual input.
    let versions = input.versions;
    for (const [index, step] of steps.entries()) {
      if (index === 0) {
        const plan = await step.preflight(input);
        plan.expectedFiles.forEach(path => files.add(path));
        decisions.push(...plan.decisions);
        warnings.push(...plan.warnings);
      }
      versions = step.destination(versions);
    }
    if (steps.length) warnings.push('New history, decision and attestation files will be appended under migrations/. The source branch will not be integrated or pushed.');
    const fromCodec = this.codecs.get(input.versions.core)!;
    const toCodec = this.codecs.get(versions.core)!;
    return deepFreeze({ registryId: this.id, from: input.versions, to: versions, sourceFingerprint: fingerprint(input.files), steps: steps.map(step => ({ id: step.id, implementationDigest: step.implementationDigest })), expectedFiles: [...files].sort(), decisions, warnings, codecs: { fromId: fromCodec.id, fromDigest: fromCodec.digest, toId: toCodec.id, toDigest: toCodec.digest } });
  }
}

export const createProductionRegistry = (): MigrationRegistry => new MigrationRegistry('craft-production').registerCodec(productionV1Codec);
