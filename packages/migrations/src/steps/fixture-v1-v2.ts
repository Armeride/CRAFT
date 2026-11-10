import { readFile } from 'node:fs/promises';
import { canonicalJson } from '../../../domain/src/canonical.js';
import { fileFailure, fingerprint, hash } from '../../../project-fs/src/files.js';
import { fixtureV2Digest, lifecycleToV2, personLock, personPath, personV1Text, personV2, personV2Text, renderPerson } from '../fixture-codecs.js';
import { objectFile, rawObject } from '../source.js';
import type { Project, Revision, SchemaLock } from '../../../schema/src/generated.js';
import type { DecisionRequest, MigrationSnapshot, MigrationStep } from '../types.js';
import type { FileChange } from '../../../project-fs/src/changes.js';
import { verifyMigration } from '../verify.js';

const requestFor = (input: MigrationSnapshot, path: string): DecisionRequest => ({
  key: `person-split:${path}`,
  prompt: '원문의 이름 순서를 확인하고 given_name/family_name/display_order를 명시한다. 자동 분리하지 않는다.',
  requestDigest: hash(canonicalJson({ source: fingerprint(input.files), path, sourceDigest: input.files.get(path)!.digest, contract: personV2 })),
  valueSchema: personV2,
});
export async function createFixtureStep(): Promise<MigrationStep> {
  const implementationDigest = hash(await readFile(new URL(import.meta.url)));
  return {
    id: 'fixture-core-1-to-2',
    from: { core: 1 },
    implementationDigest,
    destination(current) {
      return { ...current, core: 2, ...(current['fixture.person'] === 1 ? { 'fixture.person': 2 } : {}) };
    },
    async preflight(input) {
      if (input.versions['fixture.person'] !== undefined && input.versions['fixture.person'] !== 1) throw fileFailure('SCHEMA_UNSUPPORTED', 'Fixture split requires person v1', 'project.yaml');
      if (input.versions['fixture.person'] === 1) {
        const lock = rawObject<SchemaLock>(input.files, 'schemas/lock.json');
        if (canonicalJson(lock.extensions['fixture.person']) !== canonicalJson(personLock(1)) || input.files.get(personPath(1))?.digest !== hash(personV1Text)) throw fileFailure('SCHEMA_LOCK_MISMATCH', 'The split step only supports its exact registered person v1 schema', 'schemas/lock.json');
      }
      const files = ['project.yaml', 'schemas/lock.json'];
      const decisions: DecisionRequest[] = [];
      for (const [path] of input.files) {
        if (!/^entities\/[^/]+\/revisions\/[^/]+\/meta\.yaml$/.test(path)) continue;
        files.push(path);
        if (rawObject<Revision>(input.files, path).extensions['fixture.person']) decisions.push(requestFor(input, path));
      }
      if (input.versions['fixture.person'] === 1) files.push(personPath(2));
      return { expectedFiles: files.sort(), decisions, warnings: ['Fixture-only registry: this does not publish product core v2.'] };
    },
    async transform(input, decisions) {
      const changes: FileChange[] = [];
      const add = (path: string, value: unknown): void => { changes.push({ path, expectedDigest: input.files.get(path)?.digest ?? null, content: objectFile(path, value).text! }); };
      const project = rawObject<Omit<Project, 'schema_version'> & { schema_version: number }>(input.files, 'project.yaml');
      project.schema_version = 2;
      const lock = rawObject<SchemaLock>(input.files, 'schemas/lock.json');
      lock.core = { schema_id: 'urn:craft:fixture:schema:core:2', version: 2, digest: fixtureV2Digest };
      if (input.versions['fixture.person'] === 1) {
        project.extensions['fixture.person']!.schema_version = 2;
        lock.extensions['fixture.person'] = personLock(2);
        changes.push({ path: personPath(2), expectedDigest: input.files.get(personPath(2))?.digest ?? null, content: personV2Text });
      }
      add('project.yaml', project);
      add('schemas/lock.json', lock);
      for (const [path] of input.files) {
        if (!/^entities\/[^/]+\/revisions\/[^/]+\/meta\.yaml$/.test(path)) continue;
        const meta = rawObject<Revision & { heading?: string; lifecycle?: string }>(input.files, path);
        const person = meta.extensions?.['fixture.person'];
        if (person !== undefined) {
          const request = requestFor(input, path);
          const answer = decisions[request.key];
          if (!answer || answer.requestDigest !== request.requestDigest) throw fileFailure('MIGRATION_DECISION_REQUIRED', request.key, path);
          const selected = answer.value as { given_name: string; family_name: string; display_order: string };
          if (renderPerson(selected) !== person.author_line) throw fileFailure('MIGRATION_DECISION_CHANGES_MEANING', 'Selected split must render exactly the existing author line; content changes need a new revision', path);
          meta.extensions['fixture.person'] = selected;
        }
        meta.heading = meta.title;
        const lifecycle = lifecycleToV2[meta.status];
        if (!lifecycle) throw new Error('Unsupported source lifecycle');
        meta.lifecycle = lifecycle;
        const { title: _title, status: _status, ...converted } = meta;
        add(path, converted);
      }
      return { expectedSnapshot: fingerprint(input.files), changes };
    },
    async verify(before, after) { return verifyMigration(before, after); },
  };
}
