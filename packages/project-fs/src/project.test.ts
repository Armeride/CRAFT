import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exactRevision, selectedRevision, ValidationFailure } from '../../domain/src/model.js';
import { isProjectPath } from '../../domain/src/path.js';
import { SchemaValidator, coreSchemaId } from '../../schema/src/index.js';
import { dependencyManifestDigest, prepareChanges, semanticDigest } from './changes.js';
import * as sourceFiles from './files.js';
import { hash, newId } from './files.js';
import { loadCommittedProject, validateAgainstGit } from './git-baseline.js';
import { loadProject, parseProject } from './project.js';
import { editYaml, fixtureCopy, removeFixture } from './test-helpers.js';
import { parseYaml, serializeYaml } from './yaml.js';

const exec = promisify(execFile);
const minimalMeta = 'entities/ent_overview/revisions/rev_overview_a/meta.yaml';
const gameMeta = 'entities/ent_dodge/revisions/rev_dodge_b/meta.yaml';
const knowledgeMeta = 'entities/ent_knowledge/revisions/rev_knowledge_a/meta.yaml';
const used: string[] = [];
const copy = async (name = 'valid-minimal'): Promise<string> => {
  const root = await fixtureCopy(name); used.push(root); return root;
};
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of used.splice(0)) await removeFixture(root);
});

async function expectCode(action: Promise<unknown>, code: string): Promise<ValidationFailure> {
  try { await action; expect.fail(`Expected ${code}`); }
  catch (error) {
    expect(error).toBeInstanceOf(ValidationFailure);
    expect((error as ValidationFailure).diagnostics.some(d => d.code === code)).toBe(true);
    return error as ValidationFailure;
  }
  throw new Error('unreachable');
}

describe('v1 file contracts and exact reads', () => {
  it.each(['valid-minimal', 'game-design', 'narrative'])('loads %s without a DB or any writes', async name => {
    const root = await copy(name);
    const before = sourceFiles.fingerprint(await sourceFiles.captureFiles(root));
    const snapshot = await loadProject(root);
    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.fingerprint).toBe(before);
    expect(sourceFiles.fingerprint(await sourceFiles.captureFiles(root))).toBe(before);
    expect([...snapshot.files.keys()].some(path => /\.db$/.test(path))).toBe(false);
    for (const file of snapshot.files.values()) {
      if (file.path.endsWith('.yaml')) {
        const parsed = parseYaml(file.text!, file.path);
        expect(serializeYaml(parsed.value, parsed)).toBe(file.text);
      }
    }
  });

  it('uses a baseline pin, preserving nonselected exact revisions and missing-target errors', async () => {
    const snapshot = await loadProject(await copy('game-design'));
    expect(selectedRevision(snapshot, 'baseline_main', 'ent_stamina').meta.revision_id).toBe('rev_stamina_a');
    expect(exactRevision(snapshot, 'ent_stamina', 'rev_stamina_b').meta.parents).toEqual(['rev_stamina_a']);
    expect(() => exactRevision(snapshot, 'ent_stamina', 'latest')).toThrow(/REVISION_NOT_FOUND/);
    expect(() => selectedRevision(snapshot, 'missing', 'ent_stamina')).toThrow(/BASELINE_NOT_FOUND/);
    expect(() => { exactRevision(snapshot, 'ent_dodge', 'rev_dodge_b').meta.title = 'mutation'; }).toThrow();
  });

  it('keeps core and extension reference paths separate from SnapshotTargets (AT-31)', async () => {
    const snapshot = await loadProject(await copy('narrative'));
    const record = exactRevision(snapshot, 'ent_knowledge', 'rev_knowledge_a');
    expect(record.meta.references).toEqual([]);
    expect(record.references.map(r => r.value.reference_id).sort()).toEqual(['ref_evidence', 'ref_proposition', 'ref_scene', 'ref_subject']);
    expect([...snapshot.entities.values()].flatMap(entity => [...entity.revisions.values()]).flatMap(record => record.references).some(ref => ref.pointer.includes('/subject'))).toBe(true);
    const minimal = await loadProject(await copy());
    expect(exactRevision(minimal, 'ent_overview', 'rev_overview_a').references).toEqual([]);
    expect(minimal.documents.has('reviews/review_overview.yaml')).toBe(true);
  });

  it.each(['extension', 'sequence', 'core'])('rejects a target-only %s relation (AT-31)', async place => {
    const root = await copy(place === 'core' ? 'game-design' : 'narrative');
    const file = place === 'extension' ? knowledgeMeta : place === 'sequence' ? 'narrative/sequences/seq_main.yaml' : gameMeta;
    await editYaml(join(root, file), value => {
      if (place === 'extension') value.extensions.narrative.subject = value.extensions.narrative.subject.target;
      else if (place === 'sequence') value.chapters[0].scenes[0] = value.chapters[0].scenes[0].target;
      else value.references[0] = value.references[0].target;
    });
    const error = await expectCode(loadProject(root), 'SCHEMA_INVALID');
    expect(error.diagnostics.some(d => d.path === file && (d.line ?? 0) > 1)).toBe(true);
  });

  it('validates dates, known fields, scope sets and complete observation fields', () => {
    const validator = new SchemaValidator();
    expect(validator.validate('Scope', { platform: [] }, 'scope.yaml')[0]?.code).toBe('SCHEMA_INVALID');
    expect(validator.validate('Scope', { difficulty: ['hard'] }, 'scope.yaml')[0]?.code).toBe('SCHEMA_INVALID');
    expect(validator.validate('GameObservation', { build_id: 'only-one-field' }, 'observation.yaml').length).toBeGreaterThan(0);
    expect(validator.validate('Entity', { id: 'ent_valid', kind: 'document', hidden: true }, 'entity.yaml').length).toBeGreaterThan(0);
    expect(validator.validate('Entity', { id: 'ENT_CASE', kind: 'document' }, 'entity.yaml').length).toBeGreaterThan(0);
  });

  it('does not insert defaults while reading and preserves historical task schema versions', async () => {
    const root = await copy();
    await editYaml(join(root, 'tasks/task_outline/task.yaml'), value => { value.base.schema_versions.core = 72; });
    const snapshot = await loadProject(root);
    const meta = exactRevision(snapshot, 'ent_overview', 'rev_overview_a').meta;
    expect(Object.hasOwn(meta, 'aliases')).toBe(false);
    expect(Object.hasOwn(meta.scope, 'continuity')).toBe(false);
    expect((snapshot.documents.get('tasks/task_outline/task.yaml') as any).base.schema_versions.core).toBe(72);
  });

  it('does not depend on an inputs filename suffix', async () => {
    const root = await copy();
    await rename(join(root, 'tasks/task_outline/checkpoints/cp_initial-inputs.yaml'), join(root, 'tasks/task_outline/checkpoints/context_arbitrary.yaml'));
    await editYaml(join(root, 'tasks/task_outline/checkpoints/cp_initial.yaml'), value => { value.input_manifest_path = 'tasks/task_outline/checkpoints/context_arbitrary.yaml'; });
    expect((await loadProject(root)).documents.has('tasks/task_outline/checkpoints/context_arbitrary.yaml')).toBe(true);
  });
});

describe('graph integrity and locations', () => {
  it('reports the source field for missing exact targets', async () => {
    const error = await expectCode(loadProject('fixtures/invalid-references'), 'MISSING_TARGET');
    const diagnostic = error.diagnostics.find(d => d.code === 'MISSING_TARGET')!;
    expect(diagnostic.path).toBe(minimalMeta);
    expect(diagnostic.pointer).toBe('/references/0/target');
    expect(diagnostic.line).toBeGreaterThan(1);
  });

  it.each(['missing-anchor', 'duplicate-anchor', 'unknown-marker', 'duplicate-ref'])('rejects %s', async scenario => {
    const root = await copy('narrative');
    if (scenario === 'missing-anchor') await editYaml(join(root, knowledgeMeta), value => { value.extensions.narrative.evidence.target.anchor_id = 'passage_missing'; });
    if (scenario === 'duplicate-ref') await editYaml(join(root, knowledgeMeta), value => { value.references.push(value.extensions.narrative.subject); });
    if (scenario === 'duplicate-anchor') await writeFile(join(root, 'entities/ent_scene/revisions/rev_scene_a/content.md'), '<a id="passage_discovery"></a>\n<a id="passage_discovery"></a>\n');
    if (scenario === 'unknown-marker') await writeFile(join(root, 'entities/ent_scene/revisions/rev_scene_a/content.md'), '<a id="passage_discovery"></a>\n[[ref:ref_unregistered]]\n');
    const code = { 'missing-anchor': 'MISSING_ANCHOR', 'duplicate-anchor': 'DUPLICATE_ANCHOR', 'unknown-marker': 'UNREGISTERED_REFERENCE_MARKER', 'duplicate-ref': 'DUPLICATE_REFERENCE_ID' }[scenario]!;
    const error = await expectCode(loadProject(root), code);
    if (['duplicate-anchor', 'unknown-marker'].includes(scenario)) expect(error.diagnostics.find(d => d.code === code)?.line).toBe(2);
  });

  it.each(['cycle', 'missing-parent', 'duplicate-id'])('rejects %s in revision lineage', async scenario => {
    const root = await copy('game-design');
    if (scenario === 'cycle') await editYaml(join(root, 'entities/ent_dodge/revisions/rev_dodge_a/meta.yaml'), value => { value.parents = ['rev_dodge_b']; });
    if (scenario === 'missing-parent') await editYaml(join(root, gameMeta), value => { value.parents = ['rev_stamina_a']; });
    if (scenario === 'duplicate-id') await editYaml(join(root, gameMeta), value => { value.revision_id = 'rev_stamina_a'; });
    await expectCode(loadProject(root), { cycle: 'PARENT_CYCLE', 'missing-parent': 'MISSING_PARENT', 'duplicate-id': 'DUPLICATE_ID' }[scenario]!);
  });

  it('allows old comparisons but diagnoses an applied dependency baseline mismatch', async () => {
    const root = await copy('game-design');
    expect((await loadProject(root)).diagnostics).toEqual([]);
    await editYaml(join(root, 'baselines/baseline_main.yaml'), value => { value.selected.ent_stamina = 'rev_stamina_b'; });
    const result = await loadProject(root);
    expect(result.diagnostics.filter(d => d.code === 'BASELINE_DEPENDENCY_MISMATCH')).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe('warning');
  });

  it('rejects quantities outside explicit bounds or integer value types', async () => {
    const root = await copy('game-design');
    await editYaml(join(root, gameMeta), value => { value.extensions.game_design.parameters.cost.value = -0.5; });
    await expectCode(loadProject(root), 'QUANTITY_INVALID');
  });

  it('rejects malformed observation arrays through schema diagnostics', async () => {
    const root = await copy('game-design');
    await editYaml(join(root, 'entities/ent_observation/revisions/rev_observation_a/meta.yaml'), value => { value.extensions.game_design.measurements = 'invalid'; });
    await expectCode(loadProject(root), 'SCHEMA_INVALID');
  });

  it('validates sequence anchors with the same exact-reference rules', async () => {
    const root = await copy('narrative');
    await editYaml(join(root, 'narrative/sequences/seq_main.yaml'), value => { value.chapters[0].scenes[0].target.anchor_id = 'passage_missing'; });
    await expectCode(loadProject(root), 'MISSING_ANCHOR');
  });

  it('rejects a non-character event subject', async () => {
    const root = await copy('narrative');
    await editYaml(join(root, knowledgeMeta), value => { value.extensions.narrative.subject.target = { entity_id: 'ent_scene', revision_id: 'rev_scene_a' }; });
    await expectCode(loadProject(root), 'REFERENCE_KIND_MISMATCH');
  });

  it('rejects a manifest used as latest_checkpoint instead of a checkpoint', async () => {
    const root = await copy();
    await editYaml(join(root, 'tasks/task_outline/task.yaml'), value => { value.latest_checkpoint = 'cp_initial-inputs'; });
    await expectCode(loadProject(root), 'CHECKPOINT_MISSING');
  });

  it('rejects invalid ISO creation times at the source field', async () => {
    const root = await copy();
    await editYaml(join(root, minimalMeta), value => { value.created_at = 'tomorrow'; });
    const error = await expectCode(loadProject(root), 'SCHEMA_INVALID');
    expect(error.diagnostics[0]?.pointer).toBe('/created_at');
  });
});

describe('source boundaries and extension compatibility', () => {
  it.each(['../escape.md', '/absolute', 'C:/absolute', 'a\\b', 'a/../b', 'a/./b', 'a//b', 'CON.txt', 'file:stream', 'a.'])('rejects portable path %s', path => {
    expect(isProjectPath(path)).toBe(false);
  });

  it('generates portable collision-resistant IDs without using timestamps as ordering', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newId('ent')));
    expect(ids.size).toBe(100);
    expect([...ids].every(id => /^ent_[a-f0-9-]+$/.test(id))).toBe(true);
    expect(() => newId('UPPER')).toThrow(/INVALID_ID_PREFIX/);
  });

  it('rejects body traversal before reading outside the revision', async () => {
    const root = await copy();
    await editYaml(join(root, minimalMeta), value => { value.body_path = '../../other.md'; });
    await expectCode(loadProject(root), 'SCHEMA_INVALID');
  });

  it('rejects a junction to a directory outside the project', async () => {
    const root = await copy();
    const outside = join(dirname(root), '외부 폴더');
    const link = join(root, 'assets', 'linked');
    await mkdir(outside);
    await mkdir(dirname(link));
    await writeFile(join(outside, 'secret.md'), 'outside');
    await symlink(outside, link, 'junction');
    try { await expectCode(loadProject(root), 'PATH_SYMLINK'); }
    finally { await unlink(link); }
    expect(await readFile(join(outside, 'secret.md'), 'utf8')).toBe('outside');
  });

  it('rejects Unicode-normalized filename collisions', async () => {
    const root = await copy();
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'assets', 'e\u0301.txt'), 'one');
    await writeFile(join(root, 'assets', '\u00e9.txt'), 'two');
    await expectCode(loadProject(root), 'PATH_COLLISION');
  });

  it('rejects corrupt UTF-8 text', async () => {
    const root = await copy();
    await writeFile(join(root, 'entities/ent_overview/revisions/rev_overview_a/content.md'), Buffer.from([0xff, 0xfe]));
    await expectCode(loadProject(root), 'INVALID_UTF8');
  });

  it.each(['required', 'optional'])('preserves unsupported %s extension bytes and blocks the right write scope', async mode => {
    const snapshot = await loadProject(await copy(`unsupported-${mode}`));
    expect(snapshot.writable).toBe(mode === 'optional');
    const record = exactRevision(snapshot, 'ent_overview', 'rev_overview_a');
    expect(record.writable).toBe(false);
    expect(record.meta.extensions['studio.example']).toEqual({ unknown_data: { original: '손실 없이 보존' } });
    expect(() => prepareChanges(snapshot, { expectedSnapshot: snapshot.fingerprint, changes: [{ path: minimalMeta, expectedDigest: snapshot.files.get(minimalMeta)!.digest, content: snapshot.files.get(minimalMeta)!.text! }] })).toThrow(mode === 'required' ? /PROJECT_READ_ONLY/ : /ENTITY_READ_ONLY/);
    if (mode === 'optional') expect(prepareChanges(snapshot, { expectedSnapshot: snapshot.fingerprint, changes: [{ path: 'README.md', expectedDigest: snapshot.files.get('README.md')!.digest, content: '# Updated\n' }] }).files.get(minimalMeta)?.digest).toBe(snapshot.files.get(minimalMeta)?.digest);
  });

  it('blocks unsupported future core and tampered schema locks', async () => {
    const root = await copy();
    await editYaml(join(root, 'project.yaml'), value => { value.schema_version = 99; });
    await expectCode(loadProject(root), 'SCHEMA_UNSUPPORTED');
    await editYaml(join(root, 'project.yaml'), value => { value.schema_version = 1; });
    const lock = JSON.parse(await readFile(join(root, 'schemas/lock.json'), 'utf8'));
    lock.core.digest = '0'.repeat(64);
    await writeFile(join(root, 'schemas/lock.json'), JSON.stringify(lock));
    await expectCode(loadProject(root), 'SCHEMA_LOCK_MISMATCH');
  });

  it('does not reinterpret unsupported narrative versions with v1 field rules', async () => {
    const root = await copy('narrative');
    await editYaml(join(root, 'project.yaml'), value => { value.extensions.narrative.schema_version = 2; });
    const lock = JSON.parse(await readFile(join(root, 'schemas/lock.json'), 'utf8'));
    lock.extensions.narrative = { schema_id: 'urn:craft:schema:extension:narrative:2', version: 2, digest: '0'.repeat(64) };
    await writeFile(join(root, 'schemas/lock.json'), JSON.stringify(lock));
    await editYaml(join(root, knowledgeMeta), value => { value.extensions.narrative = { arbitrary_new_format: '보존' }; });
    const snapshot = await loadProject(root);
    expect(snapshot.writable).toBe(false);
    expect(snapshot.diagnostics.some(d => d.code === 'UNSUPPORTED_REQUIRED_EXTENSION')).toBe(true);
    expect(() => semanticDigest(snapshot, 'ent_knowledge', 'rev_knowledge_a')).toThrow(/SEMANTIC_MODEL_UNSUPPORTED/);
  });

  it('rejects executable/remote custom schema references', async () => {
    const validator = new SchemaValidator();
    // No schema loader/network resolver is installed: remote references cannot be fetched.
    expect(() => validator.addCustom({ $id: 'urn:test:remote', $ref: 'https://example.invalid/schema.json' })).toThrow();
  });

  it('loads a locked declarative custom schema and extracts only its declared reference paths', async () => {
    const root = await copy();
    const namespace = 'studio.example';
    const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:studio:example:1', type: 'object', additionalProperties: false, required: ['related'], properties: { related: { $ref: `${coreSchemaId}#/$defs/Reference` } } };
    const schemaText = JSON.stringify(schema);
    await mkdir(join(root, 'schemas/extensions/studio.example'), { recursive: true });
    await writeFile(join(root, 'schemas/extensions/studio.example/schema.json'), schemaText);
    await editYaml(join(root, 'project.yaml'), value => { value.extensions[namespace] = { schema_version: 1 }; });
    const lock = JSON.parse(await readFile(join(root, 'schemas/lock.json'), 'utf8'));
    lock.extensions[namespace] = { schema_id: schema.$id, version: 1, digest: hash(schemaText), path: 'schemas/extensions/studio.example/schema.json', reference_paths: ['/related'] };
    await writeFile(join(root, 'schemas/lock.json'), JSON.stringify(lock));
    await editYaml(join(root, minimalMeta), value => { value.extensions[namespace] = { related: { reference_id: 'ref_custom', target: { entity_id: 'ent_overview', revision_id: 'rev_overview_a' }, relation: 'related_to', propagation: 'none', update_policy: 'pinned' } }; });
    const snapshot = await loadProject(root);
    expect(snapshot.writable).toBe(true);
    expect(exactRevision(snapshot, 'ent_overview', 'rev_overview_a').references[0]?.value.reference_id).toBe('ref_custom');
  });

  it('rejects an external change during snapshot assembly', async () => {
    const root = await copy();
    const capture = sourceFiles.captureFiles;
    vi.spyOn(sourceFiles, 'captureFiles').mockImplementationOnce(async root => {
      const files = await capture(root);
      await writeFile(join(root, 'README.md'), '# External edit\n');
      return files;
    });
    await expectCode(loadProject(root), 'SOURCE_CHANGED');
  });
});

describe('candidate changes, digest and Git immutability', () => {
  it('checks expected fingerprints and file hashes, without applying any disk changes', async () => {
    const root = await copy();
    const snapshot = await loadProject(root);
    const original = snapshot.files.get('README.md')!;
    expect(() => prepareChanges(snapshot, { expectedSnapshot: '0'.repeat(64), changes: [] })).toThrow(/BASE_CHANGED/);
    expect(() => prepareChanges(snapshot, { expectedSnapshot: snapshot.fingerprint, changes: [{ path: 'README.md', expectedDigest: null, content: 'bad' }] })).toThrow(/FILE_CHANGED_EXTERNALLY/);
    const candidate = prepareChanges(snapshot, { expectedSnapshot: snapshot.fingerprint, changes: [{ path: 'README.md', expectedDigest: original.digest, content: '# New title\n' }] });
    expect(candidate.fingerprint).not.toBe(snapshot.fingerprint);
    expect(await readFile(join(root, 'README.md'), 'utf8')).toBe(original.text);
    expect(() => prepareChanges(snapshot, { expectedSnapshot: snapshot.fingerprint, changes: [{ path: '../escape', expectedDigest: null, content: 'bad' }] })).toThrow(/PATH_ESCAPE/);
  });

  it('allows a new revision without changing the selected or old revision', async () => {
    const snapshot = await loadProject(await copy());
    const original = snapshot.files.get(minimalMeta)!;
    const meta = JSON.parse(JSON.stringify(exactRevision(snapshot, 'ent_overview', 'rev_overview_a').meta));
    meta.revision_id = 'rev_overview_b'; meta.parents = ['rev_overview_a']; meta.status = 'draft';
    const candidate = prepareChanges(snapshot, { expectedSnapshot: snapshot.fingerprint, changes: [
      { path: 'entities/ent_overview/revisions/rev_overview_b/meta.yaml', expectedDigest: null, content: serializeYaml(meta) },
      { path: 'entities/ent_overview/revisions/rev_overview_b/content.md', expectedDigest: null, content: '# 새 초안\n' },
    ] });
    expect(candidate.files.get(minimalMeta)?.digest).toBe(original.digest);
    expect(selectedRevision(candidate, 'baseline_main', 'ent_overview').meta.revision_id).toBe('rev_overview_a');
    expect(exactRevision(candidate, 'ent_overview', 'rev_overview_b').meta.status).toBe('draft');
    expect(() => prepareChanges(snapshot, { expectedSnapshot: snapshot.fingerprint, changes: [{ path: minimalMeta, expectedDigest: original.digest, content: 'broken: edit\n' }] })).toThrow(/IMMUTABLE_RECORD_CHANGED/);
  });

  it('distinguishes byte digests from semantic defaults, clocks, body paths and LF normalization', async () => {
    const root = await copy();
    const before = await loadProject(root);
    const expected = semanticDigest(before, 'ent_overview', 'rev_overview_a');
    await editYaml(join(root, minimalMeta), value => { value.created_at = '2026-11-11T01:00:00Z'; value.aliases = []; value.tags = []; value.scope.continuity = 'main'; });
    const body = join(root, 'entities/ent_overview/revisions/rev_overview_a/content.md');
    await writeFile(body, (await readFile(body, 'utf8')).replace(/\n/g, '\r\n'));
    const after = await loadProject(root);
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(semanticDigest(after, 'ent_overview', 'rev_overview_a')).toBe(expected);
    expect(dependencyManifestDigest(after, 'ent_overview', 'rev_overview_a')).toBe(dependencyManifestDigest(before, 'ent_overview', 'rev_overview_a'));
    await editYaml(join(root, minimalMeta), value => { value.status = 'draft'; });
    expect(semanticDigest(await loadProject(root), 'ent_overview', 'rev_overview_a')).not.toBe(expected);
  });

  it('uses a fixed captured file set, even if disk changes afterward', async () => {
    const root = await copy();
    const files = await sourceFiles.captureFiles(root);
    await writeFile(join(root, 'README.md'), '# Changed after capture\n');
    const captured = parseProject(files);
    expect(captured.files.get('README.md')?.text).not.toContain('Changed after capture');
  });

  it('detects manual mutation against a real Git commit without altering its index/worktree', async () => {
    const root = await copy();
    const git = (...args: string[]) => exec('git', ['-C', root, '-c', `safe.directory=${root}`, ...args], { windowsHide: true, encoding: 'utf8' });
    await git('init');
    await git('-c', 'core.autocrlf=false', 'add', '.');
    await git('-c', 'user.name=CRAFT fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=NUL', 'commit', '-m', 'fixture baseline');
    const before = await loadCommittedProject(root, 'HEAD');
    expect(before.entities.size).toBe(1);
    const body = join(root, 'entities/ent_overview/revisions/rev_overview_a/content.md');
    await writeFile(body, '# 수동 덮어쓰기\n');
    const status = (await git('status', '--porcelain=v1')).stdout;
    await expectCode(validateAgainstGit(root, 'HEAD'), 'IMMUTABLE_RECORD_CHANGED');
    expect((await git('status', '--porcelain=v1')).stdout).toBe(status);
    expect(await readFile(body, 'utf8')).toBe('# 수동 덮어쓰기\n');
    expect(exactRevision(await loadCommittedProject(root, 'HEAD'), 'ent_overview', 'rev_overview_a').body).toContain('기획 개요');
  });
});
