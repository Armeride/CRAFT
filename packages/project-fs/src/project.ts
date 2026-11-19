import { canonicalJson, deepFreeze } from '../../domain/src/canonical.js';
import { isProjectPath, resolveBodyPath } from '../../domain/src/path.js';
import { imageReferences, managedAssetPattern, validateManagedImage } from './images.js';
import { validateGraph } from '../../domain/src/validate.js';
import { ValidationFailure } from '../../domain/src/model.js';
import type { Diagnostic, EntityRecord, LocatedReference, ProjectSnapshot, RevisionRecord, SourceFile } from '../../domain/src/model.js';
import { commonKinds, coreSchemaId, extractReferences, kindSchemas, referencePaths, schemaBundle, SchemaValidator } from '../../schema/src/index.js';
import type { Baseline, Checkpoint, Entity, GameDesign, GameObservation, Project, Quantity, SchemaLock, Sequence, Task } from '../../schema/src/generated.js';
import { captureFiles, fileFailure, fingerprint, hash } from './files.js';
import { locateDiagnostics, parseYaml, pointerEscape } from './yaml.js';
import type { ParsedSource } from './yaml.js';
import { stateKinds, stateReferencePaths, stateSchema, stateSchemaId } from '../../state-model/src/contracts.js';
import { validateStateModel } from '../../state-model/src/model.js';
import { statePlugin } from './state-support.js';

export const builtinSchemaDigest = hash(canonicalJson({ schema: schemaBundle, reference_paths: referencePaths, kind_schemas: kindSchemas }));
export const builtinExtensionId = (namespace: string): string => `urn:craft:schema:extension:${namespace}:1`;
export function builtinLock(namespaces: string[]): SchemaLock {
  return {
    core: { schema_id: coreSchemaId, version: 1, digest: builtinSchemaDigest },
    extensions: Object.fromEntries(namespaces.map(namespace => {
      if (!['narrative', 'game_design'].includes(namespace)) throw new Error('Not a bundled extension');
      return [namespace, { schema_id: builtinExtensionId(namespace), version: 1, digest: builtinSchemaDigest }];
    })),
  };
}

interface ExtensionSupport {
  supported: boolean;
  custom?: { schemaId: string; references: readonly string[]; kinds: readonly string[] };
}

/** All validation works on captured bytes. This function never reads/writes project files. */
export function parseProject(files: ReadonlyMap<string, SourceFile>): ProjectSnapshot {
  const validator = new SchemaValidator();
  const sources = new Map<string, ParsedSource>();
  const documents = new Map<string, unknown>();
  const diagnostics: Diagnostic[] = [];
  const ids = new Map<string, string>();
  const report = (code: string, message: string, path: string, pointer = '', severity: 'error' | 'warning' = 'error'): void => { diagnostics.push({ code, message, path, pointer, severity }); };
  const register = (id: string, path: string, pointer: string): void => {
    if (ids.has(id)) report('DUPLICATE_ID', `ID ${id} is already defined in ${ids.get(id)}`, path, pointer);
    else ids.set(id, path);
  };
  const get = <T>(path: string, definition: string): T => {
    const file = files.get(path);
    if (!file || file.text === undefined) throw fileFailure('FILE_MISSING', 'Required UTF-8 record is missing', path);
    const source = parseYaml(file.text, path);
    sources.set(path, source);
    if (path.endsWith('.json')) {
      try { JSON.parse(file.text); } catch { throw fileFailure('JSON_PARSE', 'JSON files must use JSON syntax', path); }
    }
    const invalid = validator.validate(definition, source.value, path);
    if (invalid.length) throw new ValidationFailure(locateDiagnostics(invalid, sources));
    documents.set(path, source.value);
    return source.value as T;
  };
  const manifestFile = files.get('project.yaml');
  if (manifestFile?.text !== undefined) {
    const manifest = parseYaml(manifestFile.text, 'project.yaml');
    const value = manifest.value;
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof value['schema_version'] === 'number' && value['schema_version'] !== 1) throw new ValidationFailure([{ code: 'SCHEMA_UNSUPPORTED', message: `Core schema ${value['schema_version']} is not supported for reading/writing`, path: 'project.yaml', pointer: '/schema_version', severity: 'error', ...manifest.position('/schema_version') }]);
  }
  const project = get<Project>('project.yaml', 'Project');
  register(project.project_id, 'project.yaml', '/project_id');
  const lock = get<SchemaLock>('schemas/lock.json', 'SchemaLock');
  if (lock.core.schema_id !== coreSchemaId || lock.core.version !== 1 || lock.core.digest !== builtinSchemaDigest || lock.core.path || lock.core.plugin || lock.core.reference_paths || lock.core.kinds) report('SCHEMA_LOCK_MISMATCH', 'Core schema ID/version/bundle digest does not match the installed v1 reader', 'schemas/lock.json', '/core');
  for (const name of Object.keys(lock.extensions)) if (!project.extensions[name]) report('UNDECLARED_EXTENSION', `Lock contains undeclared extension ${name}`, 'schemas/lock.json', `/extensions/${pointerEscape(name)}`);
  const supports = new Map<string, ExtensionSupport>();
  let writable = true;
  for (const [name, declaration] of Object.entries(project.extensions)) {
    const entry = lock.extensions[name];
    if (!entry || entry.version !== declaration.schema_version) {
      report('SCHEMA_LOCK_MISMATCH', `Missing or inconsistent lock for ${name}`, 'schemas/lock.json', `/extensions/${pointerEscape(name)}`);
      supports.set(name, { supported: false });
      continue;
    }
    let support: ExtensionSupport = { supported: false };
    const stateInterpreter = name === 'state_model' && declaration.schema_version === 1 && canonicalJson(entry.plugin ?? null) === canonicalJson(statePlugin);
    if (name === 'state_model' && !stateInterpreter) {
      support = { supported: false }; // Future/missing semantic readers cannot be treated as generic custom JSON.
    } else if (['narrative', 'game_design'].includes(name) && declaration.schema_version === 1 && !entry.plugin) {
      if (entry.schema_id !== builtinExtensionId(name) || entry.digest !== builtinSchemaDigest || entry.path) report('SCHEMA_LOCK_MISMATCH', `Bundled extension ${name} must pin the installed bundle`, 'schemas/lock.json', `/extensions/${pointerEscape(name)}`);
      else support = { supported: true };
    } else if (entry.path && (!entry.plugin || stateInterpreter)) {
      if (!isProjectPath(entry.path) || !entry.path.startsWith('schemas/extensions/') || !entry.path.endsWith('.json')) report('PATH_ESCAPE', 'Custom schemas must be JSON files under schemas/extensions', 'schemas/lock.json', `/extensions/${pointerEscape(name)}/path`);
      else {
        const file = files.get(entry.path);
        if (!file || file.text === undefined || file.digest !== entry.digest) report('SCHEMA_LOCK_MISMATCH', `Custom schema bytes do not match lock for ${name}`, 'schemas/lock.json', `/extensions/${pointerEscape(name)}/digest`);
        else {
          const parsed = parseYaml(file.text, entry.path);
          sources.set(entry.path, parsed);
          try {
            const custom = JSON.parse(file.text) as Record<string, unknown>;
            if (name === 'state_model') {
              if (entry.schema_id !== stateSchemaId || canonicalJson(custom) !== canonicalJson(stateSchema) || canonicalJson(entry.reference_paths) !== canonicalJson(stateReferencePaths) || canonicalJson(entry.kinds) !== canonicalJson(stateKinds)) throw new Error('state_model@1 must pin the app contract, reference paths and kinds');
            }
            if (custom['$id'] !== entry.schema_id || custom['$schema'] !== 'https://json-schema.org/draft/2020-12/schema') throw new Error('Custom schema ID/draft mismatch');
            const inspect = (value: unknown): void => {
              if (!value || typeof value !== 'object') return;
              for (const [key, nested] of Object.entries(value)) {
                if ((key === '$ref' || key === '$dynamicRef') && (typeof nested !== 'string' || !(nested.startsWith('#') || nested.startsWith(coreSchemaId + '#/')))) throw new Error('Only local and bundled core references are allowed');
                inspect(nested);
              }
            };
            inspect(custom);
            validator.addCustom(custom);
            // Validate declarations even when no revision currently uses this extension.
            extractReferences({}, entry.reference_paths ?? [], entry.path);
            support = { supported: true, custom: { schemaId: entry.schema_id, references: entry.reference_paths ?? [], kinds: entry.kinds ?? [] } };
          } catch (error) { report('CUSTOM_SCHEMA_INVALID', String(error), entry.path); }
        }
      }
    }
    supports.set(name, support);
    if (!support.supported) {
      const required = declaration.required ?? true;
      if (required) writable = false;
      report(required ? 'UNSUPPORTED_REQUIRED_EXTENSION' : 'UNSUPPORTED_OPTIONAL_EXTENSION', `Extension ${name}@${declaration.schema_version} is preserved with incomplete semantics; ${required ? 'project writes are blocked' : 'affected entity writes are blocked'}`, 'project.yaml', `/extensions/${pointerEscape(name)}`, 'warning');
    }
  }

  const entities = new Map<string, EntityRecord>();
  const revisionIds = new Map<string, string>();
  const baselines = new Map<string, { value: Baseline; path: string }>();
  const contextPaths = new Set<string>();
  for (const [path, file] of files) {
    if (/^tasks\/[^/]+\/checkpoints\/[^/]+\.yaml$/.test(path) && file.text !== undefined) {
      const value = parseYaml(file.text, path).value;
      if (value && typeof value === 'object' && !Array.isArray(value) && typeof value['input_manifest_path'] === 'string') contextPaths.add(value['input_manifest_path']);
    }
  }
  for (const [path] of files) {
    const entityMatch = /^entities\/([^/]+)\/entity\.yaml$/.exec(path);
    if (entityMatch) {
      const entity = get<Entity>(path, 'Entity');
      register(entity.id, path, '/id');
      if (entity.id !== entityMatch[1]) report('PATH_ID_MISMATCH', 'Entity ID differs from its directory', path, '/id');
      const kindSchema = kindSchemas[entity.kind];
      if (kindSchema && !project.extensions[kindSchema.namespace]) report('EXTENSION_REQUIRED', `Kind ${entity.kind} requires ${kindSchema.namespace}`, path, '/kind');
      if (!kindSchema && !commonKinds.has(entity.kind)) {
        const declared = [...supports].some(([name, support]) => entity.kind.startsWith(name + '.') && (!support.supported || (support.custom && (support.custom.kinds.length === 0 || support.custom.kinds.includes(entity.kind)))));
        if (!declared) report('KIND_UNSUPPORTED', `Kind ${entity.kind} is not declared by a supported extension`, path, '/kind');
      }
      entities.set(entity.id, { value: entity, path, revisions: new Map() });
    }
  }
  for (const [path, file] of files) {
    const revisionMatch = /^entities\/([^/]+)\/revisions\/([^/]+)\/meta\.yaml$/.exec(path);
    if (revisionMatch) {
      const meta = get<RevisionRecord['meta']>(path, 'Revision');
      register(meta.revision_id, path, '/revision_id');
      if (meta.entity_id !== revisionMatch[1] || meta.revision_id !== revisionMatch[2]) report('PATH_ID_MISMATCH', 'Revision IDs differ from their directories', path, '/revision_id');
      const owner = entities.get(meta.entity_id);
      if (!owner) { report('ENTITY_MISSING', 'Revision has no entity manifest', path, '/entity_id'); continue; }
      if (revisionIds.has(meta.revision_id)) report('DUPLICATE_REVISION_ID', 'Revision ID is not unique in the project', path, '/revision_id');
      revisionIds.set(meta.revision_id, path);
      const bodyPath = resolveBodyPath(path, meta.body_path);
      if (!bodyPath) { report('PATH_ESCAPE', 'body_path must stay inside its revision directory', path, '/body_path'); continue; }
      const body = files.get(bodyPath)?.text;
      if (body === undefined) { report('BODY_MISSING', 'Revision Markdown body is missing', path, '/body_path'); continue; }
      for (const asset of imageReferences(body)) {
        const image = files.get(asset.path);
        if (!image || managedAssetPattern.exec(asset.path)?.[1] !== image.digest) {
          report('ASSET_INVALID', 'Pinned image is missing or its bytes do not match the reference', bodyPath);
        } else {
          try { validateManagedImage(Buffer.from(image.contentBase64, 'base64')); }
          catch { report('ASSET_INVALID', 'Pinned image is not a supported PNG', bodyPath); }
        }
      }
      if (!bodyPath.endsWith('.md')) report('BODY_FORMAT', 'Revision bodies must be plain Markdown files', path, '/body_path');
      if (/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.test(body)) report('BODY_FRONTMATTER', 'Body frontmatter cannot be a second metadata source', bodyPath);
      const bodyIssue = (code: string, message: string, offset: number): void => {
        const lines = body.slice(0, offset).split('\n');
        diagnostics.push({ code, message, severity: 'error', path: bodyPath, pointer: '', line: lines.length, column: lines.at(-1)!.length + 1 });
      };
      let recordWritable = writable;
      const references: LocatedReference[] = extractReferences(meta, referencePaths['Revision']!, path);
      const kindSchema = kindSchemas[owner.value.kind];
      for (const [name, extension] of Object.entries(meta.extensions)) {
        const pointer = `/extensions/${pointerEscape(name)}`;
        if (!project.extensions[name]) { report('UNDECLARED_EXTENSION', `Extension ${name} is not in project.yaml`, path, pointer); continue; }
        const support = supports.get(name)!;
        if (!support.supported) { recordWritable = false; continue; }
        if (support.custom) {
          diagnostics.push(...validator.validateCustom(support.custom.schemaId, extension, path, pointer));
          references.push(...extractReferences(extension, support.custom.references, path, pointer));
        } else {
          const definition = kindSchema?.namespace === name ? kindSchema.definition : owner.value.kind === 'world.fact' && name === 'narrative' ? 'NarrativeFact' : undefined;
          if (!definition) { report('EXTENSION_KIND_MISMATCH', `No ${name} data contract for ${owner.value.kind}`, path, pointer); continue; }
          const invalidData = validator.validate(definition, extension, path, pointer);
          diagnostics.push(...invalidData);
          references.push(...extractReferences(extension, referencePaths[definition] ?? [], path, pointer));
          if (!invalidData.length && (definition === 'GameDesign' || definition === 'GameObservation')) {
            const checkQuantity = (quantity: Quantity, pointer: string): void => {
              if (!quantity || typeof quantity.value !== 'number') return;
              if ((quantity.value_type === 'integer' && !Number.isInteger(quantity.value)) || (quantity.minimum !== undefined && quantity.value < quantity.minimum) || (quantity.maximum !== undefined && quantity.value > quantity.maximum) || (quantity.minimum !== undefined && quantity.maximum !== undefined && quantity.minimum > quantity.maximum)) report('QUANTITY_INVALID', 'Quantity must respect its value type and explicit bounds', path, pointer);
            };
            if (definition === 'GameDesign') for (const [key, quantity] of Object.entries((extension as unknown as GameDesign).parameters ?? {})) checkQuantity(quantity, `${pointer}/parameters/${pointerEscape(key)}`);
            else for (const [index, measurement] of ((extension as unknown as GameObservation).measurements ?? []).entries()) checkQuantity(measurement.quantity, `${pointer}/measurements/${index}/quantity`);
          }
          if (definition === 'NarrativeScene' && typeof extension['start_tick'] === 'number' && typeof extension['end_tick'] === 'number' && extension['start_tick'] > extension['end_tick']) report('TIMELINE_RANGE_INVALID', 'Scene end precedes its start', path, pointer + '/end_tick');
        }
      }
      if (kindSchema && supports.get(kindSchema.namespace)?.supported && !meta.extensions[kindSchema.namespace]) report('EXTENSION_DATA_REQUIRED', 'Domain extension payload is missing', path, `/extensions/${kindSchema.namespace}`);
      const validReferences: LocatedReference[] = [];
      for (const reference of references) {
        const invalid = validator.validate('Reference', reference.value, path, reference.pointer);
        diagnostics.push(...invalid);
        if (!invalid.length) validReferences.push(reference);
      }
      const anchors = new Set<string>();
      for (const match of body.matchAll(/<a\s+id="([a-z][a-z0-9_-]*)"\s*>\s*<\/a>/g)) {
        if (anchors.has(match[1]!)) bodyIssue('DUPLICATE_ANCHOR', `Repeated anchor ${match[1]}`, match.index!);
        anchors.add(match[1]!);
      }
      const ids = new Set(validReferences.map(reference => reference.value.reference_id));
      for (const match of body.matchAll(/\[\[ref:([^\]]+)\]\]/g)) if (!ids.has(match[1]!) && recordWritable) bodyIssue('UNREGISTERED_REFERENCE_MARKER', `No structured reference for ${match[1]}`, match.index!);
      if (!recordWritable) report('REFERENCE_CHECK_INCOMPLETE', 'Unsupported extension reference graph is incomplete', path, '/extensions', 'warning');
      const record: RevisionRecord = { meta, path, bodyPath, body, references: validReferences, anchors, writable: recordWritable };
      (owner.revisions as Map<string, RevisionRecord>).set(meta.revision_id, record);
      continue;
    }
    const baselineMatch = /^baselines\/([^/]+)\.yaml$/.exec(path);
    if (baselineMatch) {
      const value = get<Baseline>(path, 'Baseline');
      register(value.id, path, '/id');
      if (value.id !== baselineMatch[1]) report('PATH_ID_MISMATCH', 'Baseline ID differs from filename', path, '/id');
      baselines.set(value.id, { value, path });
      continue;
    }
    const rule = [
      [/^reviews\/([^/]+)\.yaml$/, 'Review'],
      [/^narrative\/sequences\/([^/]+)\.yaml$/, 'Sequence'],
      [/^tasks\/([^/]+)\/task\.yaml$/, 'Task'],
      [/^tasks\/[^/]+\/checkpoints\/([^/]+)\.yaml$/, contextPaths.has(path) ? 'ContextManifest' : 'Checkpoint'],
      [/^tasks\/[^/]+\/proposals\/([^/]+)\.yaml$/, 'Proposal'],
      [/^skills\/([^/]+)\/skill\.yaml$/, 'SkillManifest'],
      [/^migrations\/history\/([^/]+)\.yaml$/, 'MigrationHistory'],
      [/^integrations\/mcp\.yaml$/, 'McpConfiguration'],
    ].find(([pattern]) => (pattern as RegExp).test(path)) as [RegExp, string] | undefined;
    if (rule) {
      const value = get<Record<string, unknown>>(path, rule[1]);
      if (typeof value['id'] === 'string') {
        register(value['id'], path, '/id');
        if (value['id'] !== rule[0].exec(path)?.[1]) report('PATH_ID_MISMATCH', 'Record ID differs from filename/directory', path, '/id');
      }
      continue;
    }
    if (file.text !== undefined && /\.ya?ml$/.test(path) && !sources.has(path) && !path.includes('/working/') && !path.startsWith('assets/')) report('UNRECOGNIZED_RECORD', 'YAML is outside the v1 canonical record layout', path);
  }

  const snapshot: ProjectSnapshot = { project, files, entities, baselines, documents, diagnostics, fingerprint: fingerprint(files), writable };
  for (const [path, value] of documents) {
    const document = value as Record<string, unknown>;
    if (path.startsWith('narrative/sequences/')) {
      const chapters = (value as Sequence).chapters;
      const seen = new Set<string>();
      for (const [index, chapter] of chapters.entries()) {
        if (seen.has(chapter.id)) report('DUPLICATE_ID', 'Chapter IDs must be unique within the sequence', path, `/chapters/${index}/id`);
        seen.add(chapter.id);
        for (const [sceneIndex, scene] of chapter.scenes.entries()) {
          const target = entities.get(scene.target.entity_id)?.revisions.get(scene.target.revision_id);
          if (!target) report('MISSING_TARGET', 'Sequence scene target does not exist', path, `/chapters/${index}/scenes/${sceneIndex}/target`);
          else if (entities.get(scene.target.entity_id)?.value.kind !== 'narrative.scene') report('SCENE_KIND_MISMATCH', 'Sequence target must be a scene', path, `/chapters/${index}/scenes/${sceneIndex}/target`);
        }
      }
    }
    if (path.startsWith('tasks/')) {
      const taskId = path.split('/')[1]!;
      if ('task_id' in document && document['task_id'] !== taskId) report('TASK_ID_MISMATCH', 'Record belongs to a different task', path, '/task_id');
      const taskPath = `tasks/${taskId}/task.yaml`;
      if (path !== taskPath && !documents.has(taskPath)) report('TASK_MISSING', 'Task record is missing', path);
      if (path === taskPath) {
        const task = value as Task;
        const checkpointPath = `tasks/${task.id}/checkpoints/${task.latest_checkpoint}.yaml`;
        const checkpoint = documents.get(checkpointPath) as Partial<Checkpoint> | undefined;
        if (checkpoint?.id !== task.latest_checkpoint || checkpoint?.task_id !== task.id) report('CHECKPOINT_MISSING', 'latest_checkpoint must name an existing checkpoint in this task', path, '/latest_checkpoint');
        if (!baselines.has(task.base.baseline_id)) report('BASELINE_MISSING', 'Task baseline does not exist', path, '/base/baseline_id');
      }
      if ('input_manifest_path' in document) {
        const checkpoint = value as Checkpoint;
        if (!documents.has(checkpoint.input_manifest_path)) {
          try { get(checkpoint.input_manifest_path, 'ContextManifest'); }
          catch (error) { if (error instanceof ValidationFailure) diagnostics.push(...error.diagnostics); else throw error; }
        }
        if (!checkpoint.input_manifest_path.startsWith(`tasks/${taskId}/checkpoints/`)) report('PATH_ESCAPE', 'Input manifest must belong to this task', path, '/input_manifest_path');
      }
    }
    const visitPaths = (current: unknown, pointer: string): void => {
      if (Array.isArray(current)) { current.forEach((nested, index) => visitPaths(nested, `${pointer}/${index}`)); return; }
      if (!current || typeof current !== 'object') return;
      for (const [key, nested] of Object.entries(current)) {
        const childPointer = `${pointer}/${pointerEscape(key)}`;
        if (['working_files', 'outputs'].includes(key) && Array.isArray(nested)) {
          for (const [index, file] of nested.entries()) if (typeof file !== 'string' || !isProjectPath(file) || !files.has(file)) report('FILE_MISSING', 'Referenced working/output file is missing or invalid', path, `${childPointer}/${index}`);
        } else if (key === 'entrypoint' && path.startsWith('skills/') && typeof nested === 'string') {
          const resolved = isProjectPath(nested) ? path.slice(0, path.lastIndexOf('/') + 1) + nested : '';
          if (!files.has(resolved)) report('FILE_MISSING', 'Skill entrypoint is missing or invalid', path, childPointer);
        }
      }
    };
    visitPaths(value, '');
  }
  diagnostics.push(...validateGraph(snapshot));
  diagnostics.push(...validateStateModel(snapshot));
  const located = locateDiagnostics(diagnostics, sources);
  if (located.some(diagnostic => diagnostic.severity === 'error')) throw new ValidationFailure(located);
  for (const entity of entities.values()) {
    deepFreeze(entity.value);
    for (const revision of entity.revisions.values()) deepFreeze(revision.meta);
  }
  for (const document of documents.values()) deepFreeze(document);
  return { ...snapshot, diagnostics: deepFreeze(located) };
}

export async function loadProject(root: string): Promise<ProjectSnapshot> {
  const first = await captureFiles(root);
  if (!first.has('project.yaml')) throw fileFailure('PROJECT_IMPORT_REQUIRED', 'No project.yaml; explicit create/import is required', 'project.yaml');
  const snapshot = parseProject(first);
  // The request always uses first's captured bytes. A concurrent edit invalidates it.
  const second = await captureFiles(root);
  if (fingerprint(first) !== fingerprint(second)) throw fileFailure('SOURCE_CHANGED', 'Project changed while building the snapshot; retry', 'project.yaml');
  return snapshot;
}
