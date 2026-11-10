// Explicitly opt-in fixture codecs. This module does not add product core v2 support.
import v2Schema from '../fixture-registry/core-v2.schema.json' with { type: 'json' };
import personV1 from '../fixture-registry/person-v1.schema.json' with { type: 'json' };
import personV2 from '../fixture-registry/person-v2.schema.json' with { type: 'json' };
import { canonicalJson } from '../../domain/src/canonical.js';
import { ValidationFailure } from '../../domain/src/model.js';
import type { Diagnostic, SourceFile } from '../../domain/src/model.js';
import { builtinLock, parseProject } from '../../project-fs/src/project.js';
import { fileFailure, hash } from '../../project-fs/src/files.js';
import { locateDiagnostics, parseYaml } from '../../project-fs/src/yaml.js';
import { SchemaValidator } from '../../schema/src/index.js';
import { canonicalFiles, inspectVersions } from './registry.js';
import type { ProjectCodec } from './types.js';
import { objectFile } from './source.js';

export { v2Schema, personV1, personV2 };
export const fixtureV2Digest = hash(canonicalJson(v2Schema));
export const personV1Text = JSON.stringify(personV1, null, 2) + '\n';
export const personV2Text = JSON.stringify(personV2, null, 2) + '\n';
export const personPath = (version: number): string => `schemas/extensions/fixture.person/v${version}/schema.json`;
export const personLock = (version: 1 | 2) => ({ schema_id: version === 1 ? personV1.$id : personV2.$id, version, digest: hash(version === 1 ? personV1Text : personV2Text), path: personPath(version), reference_paths: [] });
export const lifecycleToV1: Readonly<Record<string, string>> = { discussion: 'discussing', proposed: 'draft', reviewing: 'in_review', accepted: 'approved', retired: 'deprecated' };
export const lifecycleToV2 = Object.fromEntries(Object.entries(lifecycleToV1).map(([a, b]) => [b, a]));

export function renderPerson(value: { given_name: string; family_name: string; display_order: string }): string {
  return value.display_order === 'given_family' ? `${value.given_name} ${value.family_name}` : `${value.family_name} ${value.given_name}`;
}

export const fixtureV2Codec: ProjectCodec = {
  core: 2,
  id: v2Schema.$id,
  digest: fixtureV2Digest,
  read(files, registryId) {
    const versions = inspectVersions(files);
    const validator = new SchemaValidator(v2Schema, v2Schema.$id);
    const canonical = canonicalFiles(files);
    const normalizedFiles = new Map(canonical);
    const diagnostics: Diagnostic[] = [];
    const sources = new Map<string, ReturnType<typeof parseYaml>>();
    const validate = (path: string, definition: string): Record<string, any> => {
      const source = files.get(path);
      if (source?.text === undefined) throw fileFailure('FILE_MISSING', 'Required fixture record is missing', path);
      const parsed = parseYaml(source.text, path);
      if (path.endsWith('.json')) {
        try { JSON.parse(source.text); } catch { throw fileFailure('JSON_PARSE', 'JSON records require JSON syntax', path); }
      }
      sources.set(path, parsed);
      const invalid = validator.validate(definition, parsed.value, path);
      if (invalid.length) throw new ValidationFailure(locateDiagnostics(invalid, sources));
      return parsed.value as Record<string, any>;
    };
    const project = validate('project.yaml', 'Project');
    const lock = validate('schemas/lock.json', 'SchemaLock');
    if (lock.core?.schema_id !== v2Schema.$id || lock.core?.version !== 2 || lock.core?.digest !== fixtureV2Digest) throw fileFailure('SCHEMA_LOCK_MISMATCH', 'Fixture v2 schema lock does not match its codec', 'schemas/lock.json');
    const usesPerson = versions['fixture.person'] !== undefined;
    if (usesPerson && versions['fixture.person'] !== 2) throw fileFailure('SCHEMA_UNSUPPORTED', 'Fixture core v2 requires person extension v2', 'project.yaml');
    if (usesPerson) {
      if (canonicalJson(lock.extensions?.['fixture.person']) !== canonicalJson(personLock(2)) || files.get(personPath(2))?.digest !== hash(personV2Text) || files.get(personPath(1))?.digest !== hash(personV1Text)) throw fileFailure('SCHEMA_LOCK_MISMATCH', 'Fixture person schema lock/source mismatch', 'schemas/lock.json');
      validator.addCustom(personV2);
      project.extensions['fixture.person'].schema_version = 1;
      lock.extensions['fixture.person'] = personLock(1);
    }
    project.schema_version = 1;
    lock.core = builtinLock([]).core;
    normalizedFiles.set('project.yaml', objectFile('project.yaml', project));
    normalizedFiles.set('schemas/lock.json', objectFile('schemas/lock.json', lock));
    for (const [path] of canonical) {
      if (!/^entities\/[^/]+\/revisions\/[^/]+\/meta\.yaml$/.test(path)) continue;
      const meta = validate(path, 'Revision');
      const person = meta.extensions?.['fixture.person'];
      if (person !== undefined && usesPerson) {
        const invalid = validator.validateCustom(personV2.$id, person, path, '/extensions/fixture.person');
        diagnostics.push(...invalid);
        if (!invalid.length) meta.extensions['fixture.person'] = { author_line: renderPerson(person) };
      }
      meta.title = meta.heading;
      meta.status = lifecycleToV1[meta.lifecycle];
      delete meta.heading;
      delete meta.lifecycle;
      normalizedFiles.set(path, objectFile(path, meta));
    }
    if (diagnostics.length) throw new ValidationFailure(locateDiagnostics(diagnostics, sources));
    const normalized = parseProject(normalizedFiles);
    if (!normalized.writable || [...normalized.entities.values()].some(entity => [...entity.revisions.values()].some(revision => !revision.writable))) throw fileFailure('MIGRATION_EXTENSION_UNSUPPORTED', 'Fixture migration requires complete semantics', 'project.yaml');
    return { registryId, files, versions, normalized, semanticModelVersion: 1 };
  },
};
