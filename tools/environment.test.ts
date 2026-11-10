import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { Ajv2020 } from 'ajv/dist/2020.js';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseDocument, stringify } from 'yaml';

// These probes validate development dependencies and Windows behavior only.
// Product validators, safe YAML policies and transactional writers come in stage 1.
const execFileAsync = promisify(execFile);
const tempRoot = resolve('.tmp');
let directory: string;

beforeEach(async () => {
  await mkdir(tempRoot, { recursive: true });
  directory = await mkdtemp(join(tempRoot, '환경 점검 '));
});

afterEach(async () => {
  const actualRoot = await realpath(tempRoot);
  const actualDirectory = await realpath(directory);
  if (!actualDirectory.startsWith(actualRoot + sep) || !basename(actualDirectory).startsWith('환경 점검 ')) {
    throw new Error('Refusing to clean an unexpected probe directory');
  }
  await rm(actualDirectory, { recursive: true });
});

describe('stage 0 development environment', () => {
  it('runs the pinned Node runtime', () => {
    expect(process.version).toBe('v24.21.0');
  });

  it('writes UTF-8 and replaces a file by same-directory temporary rename', async () => {
    const target = join(directory, '한글 문서.md');
    const temporary = join(directory, '한글 문서.md.tmp');
    await writeFile(target, '이전 본문\n', 'utf8');
    const handle = await open(temporary, 'wx');
    try {
      await handle.writeFile('새 본문: 소설과 게임 🎮\n', 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, target);
    expect(await readFile(target, 'utf8')).toBe('새 본문: 소설과 게임 🎮\n');
  });

  it('validates Draft 2020-12 without inserting defaults or removing fields', () => {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    const validate = ajv.compile({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'array',
      prefixItems: [{ type: 'string' }, { type: 'integer' }],
      items: false,
      minItems: 2,
      maxItems: 2,
    });
    const input = ['소설', 1];
    expect(validate(input)).toBe(true);
    expect(input).toEqual(['소설', 1]);
    expect(validate(['소설', '1'])).toBe(false);
    expect(validate(['소설', 1, '추가'])).toBe(false);
  });

  it('preserves Korean YAML strings and exposes duplicate-key source locations', () => {
    const options = { version: '1.2' as const, uniqueKeys: true, merge: false, keepSourceTokens: true };
    const document = parseDocument('title: 소설 기획\ncreated_at: "2026-11-10"\n', options);
    expect(document.errors).toEqual([]);
    expect(document.toJS()).toEqual({ title: '소설 기획', created_at: '2026-11-10' });
    expect(parseDocument(stringify(document.toJS()), options).toJS()).toEqual(document.toJS());
    const duplicate = parseDocument('title: 하나\ntitle: 둘\n', options);
    expect(duplicate.errors[0]?.code).toBe('DUPLICATE_KEY');
    expect(duplicate.errors[0]?.linePos?.[0]?.line).toBe(2);
  });

  it('opens SQLite on a Korean path, supports FTS5 and rolls back failed transactions', () => {
    const db = new Database(join(directory, '검색 색인.db'));
    try {
      db.pragma('journal_mode = WAL');
      db.exec('CREATE VIRTUAL TABLE documents USING fts5(body, tokenize = "trigram")');
      db.prepare('INSERT INTO documents(body) VALUES (?)').run('스태미나 회피 규칙');
      expect(db.prepare('SELECT body FROM documents WHERE documents MATCH ?').all('스태미나')).toEqual([
        { body: '스태미나 회피 규칙' },
      ]);
      const fail = db.transaction(() => {
        db.prepare('INSERT INTO documents(body) VALUES (?)').run('보존하면 안 되는 행');
        throw new Error('probe rollback');
      });
      expect(fail).toThrow('probe rollback');
      expect(db.prepare('SELECT count(*) AS count FROM documents').get()).toEqual({ count: 1 });
      console.info('SQLite probe:', db.prepare('SELECT sqlite_version() AS version').get());
    } finally {
      db.close();
    }
  });

  it('passes native process arguments literally with a Korean cwd containing spaces', async () => {
    const literal = '한글 경로 & literal $(no-command) "인용"';
    const result = await execFileAsync(process.execPath, [
      '-e', 'process.stdout.write(JSON.stringify({cwd:process.cwd(),arg:process.argv[1]}))', literal,
    ], { cwd: directory, windowsHide: true, shell: false, encoding: 'utf8' });
    expect(JSON.parse(result.stdout)).toEqual({ cwd: directory, arg: literal });
  });
});
