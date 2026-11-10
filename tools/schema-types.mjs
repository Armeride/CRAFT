import { readFile, writeFile } from 'node:fs/promises';
import { compileFromFile } from 'json-schema-to-typescript';

const source = 'packages/schema/core/v1/schema.json';
const target = 'packages/schema/src/generated.ts';
const output = await compileFromFile(source, {
  bannerComment: '// Generated from core/v1/schema.json. Run npm run schema:types; do not edit.',
  unknownAny: true,
  strictIndexSignatures: false,
  ignoreMinAndMaxItems: true,
  style: { singleQuote: true, printWidth: 110 },
});
if (process.argv.includes('--check')) {
  if (await readFile(target, 'utf8') !== output) throw new Error('Schema types are stale: run npm run schema:types');
} else {
  await writeFile(target, output);
}
