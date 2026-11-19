import Database from 'better-sqlite3';
import { parentPort, threadId, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { canonicalJson } from '../../domain/src/canonical.js';
import { analyzeProject, applies, graphEdges, records, resolveScope, reverseReferences, issue } from '../../domain/src/analysis.js';
import type { BaselineAnalysis } from '../../domain/src/analysis.js';
import { revisionDiff } from '../../domain/src/diff.js';
import { exactRevision, revisionKey, ValidationFailure } from '../../domain/src/model.js';
import type { ProjectSnapshot, SourceFile } from '../../domain/src/model.js';
import { isProjectPath } from '../../domain/src/path.js';
import { checkImmutability, dependencyManifestDigest, semanticDigest } from '../../project-fs/src/changes.js';
import { FILE_LIMITS, fingerprint, hash, isCanonicalPath, newId } from '../../project-fs/src/files.js';
import { parseProject } from '../../project-fs/src/project.js';
import { stateOptions, stateEvaluation, stateComparison } from '../../project-fs/src/state-query.js';
import { readPerspective, readStoryQuery, storyContext, storySequences } from '../../domain/src/story.js';
import { gameContext } from '../../domain/src/game.js';
import { perspectiveQuery, restrictedOperations } from './perspective.js';
import { stateInputManifest } from '../../project-fs/src/state-input.js';
import type { JsonValue } from '../../schema/src/generated.js';
import { stateRecords } from '../../state-model/src/model.js';
import { INDEX_FORMAT } from './types.js';
import { sourceFingerprint } from './fingerprint.js';
import type { CapturedSource, IndexFailure, IndexManifest, WorkerReply, WorkerRequest } from './types.js';

const configuration = workerData as { path: string; scopeKey: string; projectId: string };
let db: Database.Database | undefined;
let current: { manifest: IndexManifest; snapshot: ProjectSnapshot; analyses: Map<string, BaselineAnalysis> } | undefined;
let pending: { token: string; parent: string | null; manifest: IndexManifest; snapshot: ProjectSnapshot; analyses: Map<string, BaselineAnalysis> } | undefined;
const normalize = (value: string) => value.normalize('NFC').toLowerCase();
const searchableFile = (path: string) => path === 'README.md' || /^tasks\/[^/]+\/(?:brief\.md|working\/.+\.(?:md|txt))$/.test(path);
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
function snippet(text: string, search: string): string {
  const match = normalize(text).indexOf(search); let normalizedOffset = 0, rawOffset = 0;
  if (match >= 0) for (const segment of segmenter.segment(text)) { if (normalizedOffset + normalize(segment.segment).length > match) { rawOffset = segment.index; break; } normalizedOffset += normalize(segment.segment).length; }
  let start = Math.max(0, rawOffset - 100);
  if (start > 0 && text.charCodeAt(start) >= 0xdc00 && text.charCodeAt(start) <= 0xdfff) start--;
  return Array.from(text.slice(start, rawOffset + 400)).slice(0, 200).join('');
}
function corrupt(): never { throw new Error('INDEX_CORRUPT'); }
function connect(): Database.Database {
  if (db) return db;
  const value = new Database(configuration.path, { timeout: 5000 });
  try {
    value.pragma('journal_mode = WAL'); value.pragma('synchronous = FULL'); value.pragma('foreign_keys = ON');
    const version = value.pragma('user_version', { simple: true });
    if (version !== 0 && version !== INDEX_FORMAT) corrupt();
    value.exec(`
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS source_files(path TEXT PRIMARY KEY, digest TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS revisions(key TEXT PRIMARY KEY, entity_id TEXT NOT NULL, revision_id TEXT NOT NULL, kind TEXT NOT NULL, digest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS names(key TEXT NOT NULL, normalized TEXT NOT NULL, role TEXT NOT NULL, PRIMARY KEY(key, normalized, role));
      CREATE INDEX IF NOT EXISTS names_normalized ON names(normalized);
      CREATE TABLE IF NOT EXISTS edges(source TEXT NOT NULL, reference_id TEXT NOT NULL, target TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(source, reference_id));
      CREATE INDEX IF NOT EXISTS edges_target ON edges(target);
      CREATE TABLE IF NOT EXISTS selections(baseline TEXT NOT NULL, entity_id TEXT NOT NULL, revision_id TEXT NOT NULL, PRIMARY KEY(baseline, entity_id));
      CREATE TABLE IF NOT EXISTS diagnostics(baseline TEXT NOT NULL, ordinal INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(baseline, ordinal));
      CREATE TABLE IF NOT EXISTS state_records(key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS document_records(path TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(revision_key UNINDEXED, text, tokenize='trigram');
    `);
    const scope = value.prepare("SELECT value FROM metadata WHERE key='scope'").get() as { value: string } | undefined;
    if (scope && scope.value !== configuration.scopeKey) corrupt();
    value.prepare('INSERT OR IGNORE INTO metadata VALUES (?, ?)').run('scope', configuration.scopeKey);
    value.pragma(`user_version = ${INDEX_FORMAT}`);
    db = value; return value;
  } catch (error) { value.close(); throw error; }
}
function getMeta<T>(key: string): T | null {
  const row = connect().prepare('SELECT value FROM metadata WHERE key=?').get(key) as { value: string } | undefined;
  try { return row ? JSON.parse(row.value) as T : null; } catch { return corrupt(); }
}
function setMeta(key: string, value: unknown): void { connect().prepare('INSERT INTO metadata VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
function restoreFiles(input: readonly SourceFile[]): Map<string, SourceFile> {
  const files = new Map<string, SourceFile>(), paths = new Set<string>(); let total = 0;
  if (input.length > FILE_LIMITS.files) corrupt();
  for (const file of input) {
    const bytes = Buffer.from(file.contentBase64, 'base64'), key = file.path.normalize('NFC').toLowerCase(); total += bytes.length;
    if (!isProjectPath(file.path) || !isCanonicalPath(file.path) || paths.has(key) || bytes.length > FILE_LIMITS.fileBytes || total > FILE_LIMITS.totalBytes || hash(bytes) !== file.digest) corrupt();
    paths.add(key);
    const text = !file.path.startsWith('assets/') && /\.(yaml|yml|json|md|txt)$/.test(file.path) ? new TextDecoder('utf8', { fatal: true }).decode(bytes) : undefined;
    files.set(file.path, { path: file.path, contentBase64: file.contentBase64, digest: file.digest, ...(text === undefined ? {} : { text }) });
  }
  return files;
}
function analyses(snapshot: ProjectSnapshot): Map<string, BaselineAnalysis> {
  const semantic = new Map<string, string>(), dependency = new Map<string, string>();
  const cached = (map: Map<string, string>, calculate: typeof semanticDigest, entity: string, revision: string) => { const key = revisionKey(entity, revision); let value = map.get(key); if (!value) { value = calculate(snapshot, entity, revision); map.set(key, value); } return value; };
  return new Map([...snapshot.baselines.keys()].map(id => [id, analyzeProject(snapshot, id, { semantic: (e, r) => cached(semantic, semanticDigest, e, r), dependency: (e, r) => cached(dependency, dependencyManifestDigest, e, r) })]));
}
function loadCurrent(): { manifest: IndexManifest; snapshot: ProjectSnapshot; analyses: Map<string, BaselineAnalysis> } | undefined {
  return connect().transaction(() => loadCurrentInsideTransaction()).deferred();
}
function loadCurrentInsideTransaction() {
  try {
  const manifest = getMeta<IndexManifest>('manifest');
  if (!manifest) { current = undefined; return undefined; }
  if (manifest.format !== INDEX_FORMAT || manifest.scopeKey !== configuration.scopeKey || manifest.projectId !== configuration.projectId || typeof manifest.generationId !== 'string' || !/^index_[a-f0-9-]+$/.test(manifest.generationId) || !Number.isSafeInteger(manifest.generation) || manifest.generation < 1 || !manifest.source || typeof manifest.sourceFingerprint !== 'string' || !manifest.counts || !manifest.timings) corrupt();
  if (current?.manifest.generationId === manifest.generationId) return current;
  const rows = connect().prepare('SELECT path, digest, data FROM source_files ORDER BY path').all() as { path: string; digest: string; data: string }[];
  const input = rows.map(row => { const file = JSON.parse(row.data) as SourceFile; if (file.path !== row.path || file.digest !== row.digest) corrupt(); return file; });
  const files = restoreFiles(input);
  if (manifest.format !== INDEX_FORMAT || manifest.scopeKey !== configuration.scopeKey || fingerprint(files) !== manifest.source.fileFingerprint || sourceFingerprint(configuration.scopeKey, manifest.source) !== manifest.sourceFingerprint) corrupt();
  const snapshot = parseProject(files);
  if (snapshot.project.project_id !== configuration.projectId) corrupt();
  current = { manifest, snapshot, analyses: analyses(snapshot) };
  return current;
  } catch (error) { if ((error as { code?: string }).code?.startsWith('SQLITE_')) throw error; corrupt(); }
}
function prepare(payload: CapturedSource & { full?: boolean }) {
  const started = performance.now(), previous = loadCurrent();
  const files = restoreFiles(payload.files);
  if (fingerprint(files) !== payload.source.fileFingerprint || sourceFingerprint(configuration.scopeKey, payload.source) !== payload.sourceFingerprint) throw new Error('SOURCE_CHANGED');
  if (payload.immutableFiles.length) {
    const before = parseProject(restoreFiles(payload.immutableFiles));
    const invalid = checkImmutability(before, { ...before, files });
    if (invalid.length) throw new ValidationFailure(invalid);
  }
  const snapshot = parseProject(files);
  if (snapshot.project.project_id !== configuration.projectId) throw new Error('PROJECT_SCOPE_MISMATCH');
  if (previous?.manifest.sourceFingerprint === payload.sourceFingerprint && !payload.full) return { noop: true, manifest: previous.manifest };
  const oldFiles = previous?.snapshot.files ?? new Map<string, SourceFile>();
  const changedFiles = [...new Set([...oldFiles.keys(), ...files.keys()])].filter(path => oldFiles.get(path)?.digest !== files.get(path)?.digest).sort();
  const oldRecords = previous ? records(previous.snapshot) : new Map(), nextRecords = records(snapshot);
  const recordDigest = (record: ReturnType<typeof exactRevision>) => hash(canonicalJson([files.get(record.path)?.digest, files.get(record.bodyPath)?.digest, snapshot.entities.get(record.meta.entity_id)?.value.kind]));
  const oldDigest = (key: string) => { const record = oldRecords.get(key); return record && hash(canonicalJson([oldFiles.get(record.path)?.digest, oldFiles.get(record.bodyPath)?.digest, previous!.snapshot.entities.get(record.meta.entity_id)?.value.kind])); };
  const updatedRevisions = [...nextRecords].filter(([key, record]) => payload.full || oldDigest(key) !== recordDigest(record)).map(([key]) => key).sort();
  const removedRevisions = [...oldRecords.keys()].filter(key => !nextRecords.has(key)).sort();
  const calculated = analyses(snapshot);
  const manifest: IndexManifest = { format: 1, scopeKey: configuration.scopeKey, generationId: newId('index'), generation: (previous?.manifest.generation ?? 0) + 1, source: payload.source, sourceFingerprint: payload.sourceFingerprint, projectId: configuration.projectId, builtAt: new Date().toISOString(), mode: previous && !payload.full ? 'incremental' : 'full', changedFiles, updatedRevisions, removedRevisions, counts: { files: files.size, revisions: nextRecords.size, references: graphEdges(snapshot).length }, timings: { prepareMs: performance.now() - started, sqliteMs: 0, workerThreadId: threadId } };
  pending = { token: newId('candidate'), parent: previous?.manifest.generationId ?? null, manifest, snapshot, analyses: calculated };
  return { noop: false, token: pending.token, manifest };
}
function publish(payload: { token: string; failBeforeCommit?: boolean }) {
  const candidate = pending;
  if (!candidate || candidate.token !== payload.token) throw new Error('INDEX_CANDIDATE_MISSING');
  const value = connect(), started = performance.now(), { snapshot, manifest } = candidate;
  value.transaction(() => {
    if ((getMeta<IndexManifest>('manifest')?.generationId ?? null) !== candidate.parent) throw new Error('BASE_CHANGED');
    if (manifest.mode === 'full') value.exec('DELETE FROM source_files; DELETE FROM revisions; DELETE FROM names; DELETE FROM document_fts;');
    const upsertFile = value.prepare('INSERT INTO source_files VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET digest=excluded.digest, data=excluded.data');
    for (const path of manifest.changedFiles) { const file = snapshot.files.get(path); if (file) upsertFile.run(path, file.digest, JSON.stringify(file)); else value.prepare('DELETE FROM source_files WHERE path=?').run(path); }
    if (manifest.mode === 'full') for (const [path, file] of snapshot.files) upsertFile.run(path, file.digest, JSON.stringify(file));
    const next = records(snapshot);
    for (const key of [...manifest.updatedRevisions, ...manifest.removedRevisions]) { value.prepare('DELETE FROM revisions WHERE key=?').run(key); value.prepare('DELETE FROM names WHERE key=?').run(key); value.prepare('DELETE FROM document_fts WHERE revision_key=?').run(key); }
    const revisionInsert = value.prepare('INSERT INTO revisions VALUES (?, ?, ?, ?, ?)'), nameInsert = value.prepare('INSERT OR IGNORE INTO names VALUES (?, ?, ?)'), textInsert = value.prepare('INSERT INTO document_fts VALUES (?, ?)');
    for (const key of manifest.updatedRevisions) {
      const record = next.get(key)!;
      revisionInsert.run(key, record.meta.entity_id, record.meta.revision_id, snapshot.entities.get(record.meta.entity_id)!.value.kind, hash(canonicalJson([snapshot.files.get(record.path)?.digest, snapshot.files.get(record.bodyPath)?.digest, snapshot.entities.get(record.meta.entity_id)!.value.kind])));
      for (const name of [record.meta.entity_id, record.meta.revision_id, record.meta.title, ...(record.meta.aliases ?? [])]) nameInsert.run(key, normalize(name), name === record.meta.entity_id || name === record.meta.revision_id ? 'id' : 'name');
      textInsert.run(key, normalize([record.meta.title, ...(record.meta.aliases ?? []), record.body].join('\n')));
    }
    for (const path of manifest.mode === 'full' ? snapshot.files.keys() : manifest.changedFiles) if (searchableFile(path)) {
      const key = 'file:' + path, file = snapshot.files.get(path);
      value.prepare('DELETE FROM names WHERE key=?').run(key); value.prepare('DELETE FROM document_fts WHERE revision_key=?').run(key);
      if (file?.text !== undefined) { nameInsert.run(key, normalize(path), 'path'); textInsert.run(key, normalize(path + '\n' + file.text)); }
    }
    value.exec('DELETE FROM edges; DELETE FROM selections; DELETE FROM diagnostics; DELETE FROM state_records; DELETE FROM document_records;');
    const edgeInsert = value.prepare('INSERT INTO edges VALUES (?, ?, ?, ?)');
    for (const edge of graphEdges(snapshot)) edgeInsert.run(edge.source, edge.reference.reference_id, edge.target, JSON.stringify(edge));
    const selectionInsert = value.prepare('INSERT INTO selections VALUES (?, ?, ?)'), diagnosticInsert = value.prepare('INSERT INTO diagnostics VALUES (?, ?, ?)');
    for (const [id, { value: baseline }] of snapshot.baselines) { for (const [entity, revision] of Object.entries(baseline.selected)) selectionInsert.run(id, entity, revision); for (const [index, diagnostic] of candidate.analyses.get(id)!.diagnostics.entries()) diagnosticInsert.run(id, index, JSON.stringify(diagnostic)); }
    const stateInsert = value.prepare('INSERT INTO state_records VALUES (?, ?)'); for (const state of stateRecords(snapshot)) stateInsert.run(revisionKey(state.target.entity_id, state.target.revision_id), JSON.stringify(state));
    const documentInsert = value.prepare('INSERT INTO document_records VALUES (?, ?)'); for (const [path, document] of snapshot.documents) documentInsert.run(path, JSON.stringify(document));
    manifest.timings.sqliteMs = performance.now() - started;
    if (payload.failBeforeCommit) throw new Error('SIMULATED_SQLITE_FAILURE');
    setMeta('manifest', manifest); setMeta('failure', null);
  }).immediate();
  current = { manifest, snapshot, analyses: candidate.analyses }; pending = undefined;
  return manifest;
}

function query(payload: { operation: string; args: Record<string, unknown>; baselineId?: string; scope?: Parameters<typeof resolveScope>[2]; perspective?: unknown }): unknown {
  return connect().transaction(() => queryInsideTransaction(payload)).deferred();
}
function queryInsideTransaction(payload: { operation: string; args: Record<string, unknown>; baselineId?: string; scope?: Parameters<typeof resolveScope>[2]; perspective?: unknown }) {
  const active = loadCurrent(); if (!active) throw new Error('INDEX_STALE');
  const perspective = readPerspective(payload.perspective);
  const { snapshot } = active, allRecords = records(snapshot), baselineId = payload.baselineId ?? snapshot.project.default_baseline_id, baseline = snapshot.baselines.get(baselineId);
  if (!baseline) throw new ValidationFailure([issue('BASELINE_MISSING', 'project.yaml')]);
  const args = payload.args;
  const analysis = active.analyses.get(baselineId)!;
  if (perspective) {
    if (!restrictedOperations.some(operation => operation === payload.operation)) throw new Error('CONTEXT_FORBIDDEN');
    const data = perspectiveQuery(snapshot, baselineId, resolveScope(snapshot, baselineId, perspective.scope), analysis, perspective, payload.operation, args);
    return { data, baselineId, baselineFingerprint: snapshot.files.get(baseline.path)!.digest, manifest: active.manifest };
  }
  if (payload.scope && !['selected', 'search', 'reverse', 'state', 'state-input', 'state-options', 'state-evaluate', 'state-compare', 'story-options', 'story', 'game'].includes(payload.operation)) throw new Error('QUERY_ARGUMENT_INVALID');
  const string = (name: string) => { const value = args[name]; if (typeof value !== 'string' || !value || value.length > 256) throw new Error('QUERY_ARGUMENT_INVALID'); return value; };
  const item = (entity: string, revision: string) => {
    const record = exactRevision(snapshot, entity, revision);
    return { entityId: entity, revisionId: revision, kind: snapshot.entities.get(entity)!.value.kind, meta: record.meta, references: record.references.map(ref => ref.value), body: record.body, sourcePath: record.path, sourceDigest: snapshot.files.get(record.path)!.digest, bodyDigest: snapshot.files.get(record.bodyPath)!.digest, selected: baseline.value.selected[entity] === revision, writable: record.writable };
  };
  let data: unknown;
  switch (payload.operation) {
    case 'catalog': data = { project: snapshot.project, edges: graphEdges(snapshot), baselines: [...snapshot.baselines.values()].map(value => value.value), entities: [...snapshot.entities.values()].map(entity => ({ entityId: entity.value.id, kind: entity.value.kind, selectedRevision: baseline.value.selected[entity.value.id] ?? null, revisions: [...entity.revisions.values()].map(record => ({ revisionId: record.meta.revision_id, title: record.meta.title, status: record.meta.status, tags: record.meta.tags ?? [], scope: record.meta.scope, parents: record.meta.parents, references: record.references.length, createdAt: record.meta.created_at })) })) }; break;
    case 'exact': data = item(string('entityId'), string('revisionId')); break;
    case 'selected': { const entity = string('entityId'), revision = baseline.value.selected[entity]; if (!revision) throw new Error('ENTITY_NOT_SELECTED'); const scope = resolveScope(snapshot, baselineId, payload.scope); const record = exactRevision(snapshot, entity, revision); if (!applies(record.meta.scope, scope)) throw new ValidationFailure([issue('SCOPE_MISMATCH', record.path)]); data = item(entity, revision); break; }
    case 'search': {
      const text = normalize(string('text')), mode = args['mode'] ?? 'auto', limit = args['limit'] ?? 50, scope = resolveScope(snapshot, baselineId, payload.scope);
      if (!['auto', 'exact', 'text'].includes(mode as string) || typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('QUERY_ARGUMENT_INVALID');
      for (const key of ['includeHistory', 'includeFiles']) if (args[key] !== undefined && typeof args[key] !== 'boolean') throw new Error('QUERY_ARGUMENT_INVALID');
      const exactRows = mode === 'text' ? [] : connect().prepare('SELECT key FROM names WHERE normalized=? ORDER BY key').all(text) as { key: string }[];
      let textRows: { key: string }[] = [];
      if (mode !== 'exact' && (mode === 'text' || Array.from(text).length >= 3)) {
        textRows = Array.from(text).length >= 3 ? connect().prepare('SELECT revision_key AS key FROM document_fts WHERE document_fts MATCH ? ORDER BY rank, revision_key').all('"' + text.replaceAll('"', '""') + '"') as { key: string }[] : connect().prepare('SELECT revision_key AS key FROM document_fts WHERE instr(text, ?) > 0 ORDER BY revision_key').all(text) as { key: string }[];
      }
      const seen = new Set<string>(), hits: unknown[] = [];
      for (const [rows, match] of [[exactRows, 'exact'], [textRows, 'text']] as const) for (const row of rows) {
        if (seen.has(row.key)) continue; seen.add(row.key);
        if (row.key.startsWith('file:')) {
          if (!args['includeFiles'] || args['kind'] !== undefined || args['tag'] !== undefined) continue;
          const path = row.key.slice(5), file = snapshot.files.get(path);
          if (file?.text === undefined || !searchableFile(path) || !(match === 'exact' ? normalize(path) === text : normalize(path + '\n' + file.text).includes(text))) corrupt();
          hits.push({ type: 'file', path, sourceDigest: file.digest, match, snippet: snippet(file.text, text) });
          if (hits.length >= limit) break; continue;
        }
        const record = allRecords.get(row.key); if (!record) corrupt();
        if ((!args['includeHistory'] && baseline.value.selected[record.meta.entity_id] !== record.meta.revision_id) || !applies(record.meta.scope, scope)) continue;
        if (args['kind'] !== undefined && args['kind'] !== snapshot.entities.get(record.meta.entity_id)!.value.kind) continue;
        if (args['tag'] !== undefined && !record.meta.tags?.includes(args['tag'] as string)) continue;
        // SQL never supplies authoritative content. Return only validated captured source bytes.
        if (match === 'exact' && ![record.meta.entity_id, record.meta.revision_id, record.meta.title, ...(record.meta.aliases ?? [])].some(name => normalize(name) === text)) corrupt();
        if (match === 'text' && !normalize([record.meta.title, ...(record.meta.aliases ?? []), record.body].join('\n')).includes(text)) corrupt();
        hits.push({ type: 'revision', entityId: record.meta.entity_id, revisionId: record.meta.revision_id, kind: snapshot.entities.get(record.meta.entity_id)!.value.kind, title: record.meta.title, status: record.meta.status, scope: record.meta.scope, tags: record.meta.tags ?? [], selected: baseline.value.selected[record.meta.entity_id] === record.meta.revision_id, writable: record.writable, sourcePath: record.path, sourceDigest: snapshot.files.get(record.path)!.digest, bodyDigest: snapshot.files.get(record.bodyPath)!.digest, match, snippet: snippet(record.body, text) });
        if (hits.length >= limit) break;
      }
      data = { hits: hits.slice(0, limit), strategy: mode === 'exact' || Array.from(text).length < 3 && mode === 'auto' ? 'nfc_exact' : Array.from(text).length < 3 ? 'bounded_substring' : 'fts5_trigram', scope }; break;
    }
    case 'analyze': data = active.analyses.get(baselineId)!; break;
    case 'reverse': data = reverseReferences(snapshot, baselineId, { entity_id: string('entityId'), revision_id: string('revisionId') }, { ...args as { maxDepth?: number; maxResults?: number; includeHistory?: boolean }, ...(payload.scope ? { scope: payload.scope } : {}) }); break;
    case 'diff': { const entity = string('entityId'), before = string('before'), after = string('after'); data = { ...revisionDiff(exactRevision(snapshot, entity, before), exactRevision(snapshot, entity, after)), semanticBefore: semanticDigest(snapshot, entity, before), semanticAfter: semanticDigest(snapshot, entity, after) }; break; }
    case 'tasks': data = { records: [...snapshot.documents].filter(([path]) => path.startsWith('tasks/')).map(([path, value]) => ({ path, value })), workingFiles: [...snapshot.files.values()].filter(file => /^tasks\/[^/]+\/working\//.test(file.path)).map(file => ({ path: file.path, text: file.text, digest: file.digest })) }; break;
    case 'state': {
      const scope = payload.scope ? resolveScope(snapshot, baselineId, payload.scope) : undefined;
      data = { records: stateRecords(snapshot).map(record => ({ ...record, selected: baseline.value.selected[record.target.entity_id] === record.target.revision_id })).filter(record => (args['includeHistory'] === true || record.selected) && (!scope || applies(exactRevision(snapshot, record.target.entity_id, record.target.revision_id).meta.scope, scope))), evaluatorAvailable: true }; break;
    }
    case 'state-options': data = stateOptions(snapshot, baselineId, resolveScope(snapshot, baselineId, payload.scope)); break;
    case 'state-evaluate':
    case 'state-compare': {
      const evaluate = payload.operation === 'state-evaluate' ? stateEvaluation : stateComparison;
      data = evaluate(snapshot, { baselineId, scope: resolveScope(snapshot, baselineId, payload.scope), analysis, headCommit: active.manifest.source.headCommit, scopeFingerprint: active.manifest.scopeKey }, args); break;
    }
    case 'story-options': data = storySequences(snapshot, baselineId, resolveScope(snapshot, baselineId, payload.scope)); break;
    case 'story': data = storyContext(snapshot, baselineId, resolveScope(snapshot, baselineId, payload.scope), analysis, readStoryQuery(args)); break;
    case 'game': data = gameContext(snapshot, baselineId, resolveScope(snapshot, baselineId, payload.scope), analysis, args['entityId'] === undefined ? undefined : string('entityId')); break;
    case 'state-input': {
      const scope = resolveScope(snapshot, baselineId, payload.scope), record = exactRevision(snapshot, string('entityId'), string('revisionId'));
      if (!applies(record.meta.scope, scope)) throw new ValidationFailure([issue('SCOPE_MISMATCH', record.path)]);
      const overrides = args['overrides'] ?? {};
      if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides) || Object.keys(overrides).length > 256) throw new Error('QUERY_ARGUMENT_INVALID');
      data = stateInputManifest(snapshot, { scopeFingerprint: active.manifest.scopeKey, headCommit: active.manifest.source.headCommit }, baselineId, { entity_id: record.meta.entity_id, revision_id: record.meta.revision_id }, args['actor'] === undefined ? undefined : string('actor'), overrides as Record<string, JsonValue>); break;
    }
    default: throw new Error('QUERY_OPERATION_INVALID');
  }
  return { data, baselineId, baselineFingerprint: snapshot.files.get(baseline.path)!.digest, manifest: active.manifest };
}

parentPort!.on('message', (message: WorkerRequest) => {
  const reply: WorkerReply = { id: message.id };
  try {
    switch (message.operation) {
      case 'manifest': { const active = loadCurrent(); reply.result = { manifest: active?.manifest ?? null, failure: getMeta<IndexFailure>('failure') }; break; }
      case 'prepare': reply.result = prepare(message.payload as CapturedSource); break;
      case 'publish': reply.result = publish(message.payload as Parameters<typeof publish>[0]); break;
      case 'discard': pending = undefined; reply.result = true; break;
      case 'failure': setMeta('failure', message.payload); reply.result = true; break;
      case 'query': reply.result = query(message.payload as Parameters<typeof query>[0]); break;
      case 'close': db?.close(); db = undefined; current = undefined; pending = undefined; reply.result = true; break;
      default: throw new Error('INDEX_OPERATION_INVALID');
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    const normalized = code?.startsWith('SQLITE_CORRUPT') || code === 'SQLITE_NOTADB' ? 'INDEX_CORRUPT' : code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED' ? 'WORKTREE_BUSY' : code === 'SQLITE_FULL' ? 'INDEX_STORAGE_FULL' : code?.startsWith('SQLITE_IOERR') ? 'INDEX_IO_ERROR' : code;
    reply.error = { code: error instanceof ValidationFailure ? 'SOURCE_INVALID' : normalized ?? (error instanceof Error ? error.message : 'INDEX_ERROR'), message: String(error), ...(error instanceof ValidationFailure ? { diagnostics: error.diagnostics } : {}) };
  }
  parentPort!.postMessage(reply);
});
