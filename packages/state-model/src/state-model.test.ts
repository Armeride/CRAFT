import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../domain/src/canonical.js';
import { ValidationFailure } from '../../domain/src/model.js';
import { captureFiles, hash } from '../../project-fs/src/files.js';
import { objectFile, rawObject } from '../../project-fs/src/content.js';
import { parseProject, builtinSchemaDigest } from '../../project-fs/src/project.js';
import { semanticDigest } from '../../project-fs/src/changes.js';
import { statePayload, stateRecords } from './model.js';
import { stateKinds, stateReferencePaths, stateSchema } from './contracts.js';
import type { Revision, SchemaLock } from '../../schema/src/generated.js';
import { schemaBundle } from '../../schema/src/index.js';
import { statePlugin } from '../../project-fs/src/state-support.js';

const transitionPath = 'entities/ent_gate_rule/revisions/rev_gate_rule/meta.yaml';
async function mutated(change: (value: any) => void, path = transitionPath) { const files = new Map(await captureFiles('fixtures/state-model')), value = rawObject<any>(files, path); change(value); files.set(path, objectFile(path, value)); return files; }
function error(action: () => unknown, code: string) { try { action(); expect.fail(`Expected ${code}`); } catch (error) { expect(error).toBeInstanceOf(ValidationFailure); expect((error as ValidationFailure).diagnostics.map(d => d.code)).toContain(code); } }

describe('state_model@1 contract and v1 compatibility (AT-60 foundation)', () => {
  it('pins an independent schema while keeping core v1/reference semantics unchanged', async () => {
    expect(stateSchema.$defs.Reference).toEqual(schemaBundle.$defs.Reference); expect(stateSchema.$defs.SnapshotTarget).toEqual(schemaBundle.$defs.SnapshotTarget);
    const snapshot = parseProject(await captureFiles('fixtures/state-model'));
    const lock = rawObject<SchemaLock>(snapshot.files, 'schemas/lock.json'); expect(lock.core.digest).toBe(builtinSchemaDigest); expect(lock.extensions.state_model!.kinds).toEqual(stateKinds); expect(lock.extensions.state_model!.reference_paths).toEqual(stateReferencePaths); expect(lock.extensions.state_model!.plugin).toEqual(statePlugin);
    const rule = snapshot.entities.get('ent_gate_rule')!.revisions.get('rev_gate_rule')!;
    expect(rule.references.map(ref => ref.pointer)).toEqual(['/extensions/state_model/links/actor', '/extensions/state_model/links/gate']);
    const before = semanticDigest(snapshot, 'ent_gate_rule', 'rev_gate_rule'), files = await mutated(meta => { meta.extensions.state_model.nodes[0].right.value = 11; });
    expect(semanticDigest(parseProject(files), 'ent_gate_rule', 'rev_gate_rule')).not.toBe(before);
    expect(stateRecords(snapshot)).toHaveLength(7); expect(snapshot.writable).toBe(true);
  });

  it('reads legacy initial state/events without writing or creating a second source', async () => {
    const files = await captureFiles('fixtures/narrative'), before = [...files.values()].map(file => file.digest), snapshot = parseProject(files), records = stateRecords(snapshot);
    expect(records.find(record => record.recordType === 'definition')!.source).toBe('narrative@1'); expect(records.some(record => record.recordType === 'legacy_occurrence')).toBe(true);
    expect([...files.values()].map(file => file.digest)).toEqual(before);
    const next = new Map(files), source = parseProject(await captureFiles('fixtures/state-model')), lock = rawObject<SchemaLock>(next, 'schemas/lock.json'), sourceLock = rawObject<SchemaLock>(source.files, 'schemas/lock.json'), project = rawObject<any>(next, 'project.yaml');
    lock.extensions.state_model = sourceLock.extensions.state_model!; project.extensions.state_model = { schema_version: 1, required: true };
    next.set('project.yaml', objectFile('project.yaml', project)); next.set('schemas/lock.json', objectFile('schemas/lock.json', lock)); const schema = source.files.get(sourceLock.extensions.state_model!.path!)!; next.set(schema.path, schema);
    const path = 'entities/ent_abcde/revisions/rev_abcde_a/meta.yaml', meta = rawObject<any>(next, path);
    meta.extensions.state_model = { record_type: 'definition', links: {}, fields: { clothing: { type: 'string' }, location: { type: 'string' } }, initial: { source: 'narrative_v1' } }; next.set(path, objectFile(path, meta));
    expect(stateRecords(parseProject(next)).filter(record => record.target.entity_id === 'ent_abcde')).toHaveLength(1);
    meta.extensions.state_model.initial = { source: 'declared', world_tick: 0, values: {} }; next.set(path, objectFile(path, meta)); error(() => parseProject(next), 'STATE_INITIAL_SOURCE_CONFLICT');
  });

  it.each([
    ['STATE_NODE_MISSING', (state: any) => { state.condition = 'absent'; }],
    ['STATE_CONDITION_CYCLE', (state: any) => { state.nodes.push({ id: 'loop', op: 'not', child: 'loop' }); }],
    ['STATE_LINK_MISSING', (state: any) => { state.nodes[0].left.link = 'absent'; }],
    ['STATE_FIELD_MISSING', (state: any) => { state.effects[0].field = 'absent'; }],
    ['STATE_UNIT_MISMATCH', (state: any) => { state.nodes[0].right.unit = 'seconds'; }],
    ['STATE_REPEAT_POLICY', (state: any) => { state.repeat.mode = 'on_entry'; }],
    ['STATE_REPEAT_POLICY', (state: any) => { state.repeat.max_per_occurrence = 2; }],
    ['STATE_APPLIED_LINK_REQUIRED', (state: any) => { state.links.actor.relation = 'related_to'; state.links.actor.propagation = 'none'; }],
  ] as const)('rejects %s rather than guessing missing meanings', async (code, edit) => {
    const files = await mutated(meta => edit(meta.extensions.state_model)); error(() => parseProject(files), code);
  });

  it('keeps missing initial values absent and refuses an unknown actor or missing effect value', async () => {
    const path = 'entities/ent_actor/revisions/rev_actor/meta.yaml';
    const files = await mutated(meta => { meta.extensions.state_model.initial.values = {}; }, path);
    const record = parseProject(files).entities.get('ent_actor')!.revisions.get('rev_actor')!;
    expect((statePayload(record) as any).initial.values).toEqual({});
    const missingEffect = await mutated(meta => { delete meta.extensions.state_model.effects[0].value; }); error(() => parseProject(missingEffect), 'STATE_EFFECT_VALUE');
    const scenario = await mutated(meta => { meta.extensions.state_model.occurrences[0].bindings.actor = 'absent'; }, 'entities/ent_gate_scenario/revisions/rev_gate_scenario/meta.yaml'); error(() => parseProject(scenario), 'STATE_ACTOR_MISSING');
  });

  it('preserves a future extension as unsupported and refuses forged v1 semantics/reference paths', async () => {
    const files = new Map(await captureFiles('fixtures/state-model')), project = rawObject<any>(files, 'project.yaml'), lock = rawObject<SchemaLock>(files, 'schemas/lock.json');
    project.extensions.state_model.schema_version = 2; lock.extensions.state_model!.version = 2;
    files.set('project.yaml', objectFile('project.yaml', project)); files.set('schemas/lock.json', objectFile('schemas/lock.json', lock));
    const future = parseProject(files); expect(future.writable).toBe(false); expect(stateRecords(future)).toEqual([]); expect(future.diagnostics.map(d => d.code)).toContain('UNSUPPORTED_REQUIRED_EXTENSION');
    project.extensions.state_model.schema_version = 1; lock.extensions.state_model!.version = 1; lock.extensions.state_model!.reference_paths = [];
    files.set('project.yaml', objectFile('project.yaml', project)); files.set('schemas/lock.json', objectFile('schemas/lock.json', lock)); error(() => parseProject(files), 'CUSTOM_SCHEMA_INVALID');
    lock.extensions.state_model!.reference_paths = [...stateReferencePaths];
    const path = lock.extensions.state_model!.path!, schema = { ...stateSchema, title: 'Forged semantics' }, file = objectFile(path, schema); lock.extensions.state_model!.digest = file.digest;
    files.set(path, file); files.set('schemas/lock.json', objectFile('schemas/lock.json', lock)); error(() => parseProject(files), 'CUSTOM_SCHEMA_INVALID');
  });

  it('supports typed collection membership and refuses implicit string ordering', async () => {
    const files = await mutated(meta => { meta.extensions.state_model.nodes[0] = { id: 'level', op: 'compare', operator: 'in', left: { type: 'literal', value: 'citizen' }, right: { type: 'state', link: 'actor', field: 'flags', binding: 'actor' } }; });
    const path = 'entities/ent_actor/revisions/rev_actor/meta.yaml', actor = rawObject<any>(files, path); actor.extensions.state_model.fields.flags = { type: 'array' }; actor.extensions.state_model.initial.values.flags = ['citizen']; files.set(path, objectFile(path, actor));
    expect(parseProject(files).writable).toBe(true);
    const invalid = await mutated(meta => { meta.extensions.state_model.nodes[0] = { id: 'level', op: 'compare', operator: 'lt', left: { type: 'literal', value: '10' }, right: { type: 'literal', value: '2' } }; });
    error(() => parseProject(invalid), 'STATE_COMPARISON_TYPE');
  });

  it('blocks semantic writes when the required built-in interpreter pin is missing or unknown', async () => {
    const files = new Map(await captureFiles('fixtures/state-model')), lock = rawObject<SchemaLock>(files, 'schemas/lock.json');
    delete lock.extensions.state_model!.plugin; files.set('schemas/lock.json', objectFile('schemas/lock.json', lock)); expect(parseProject(files).writable).toBe(false);
    lock.extensions.state_model!.plugin = { ...statePlugin, digest: '0'.repeat(64) }; files.set('schemas/lock.json', objectFile('schemas/lock.json', lock)); expect(parseProject(files).writable).toBe(false);
  });
});
