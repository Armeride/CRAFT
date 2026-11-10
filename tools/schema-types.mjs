import { readFile, writeFile } from 'node:fs/promises';
import { compileFromFile } from 'json-schema-to-typescript';

const contracts = [
  ['packages/schema/core/v1/schema.json', 'packages/schema/src/generated.ts', 'core/v1/schema.json'],
  ['packages/migrations/schemas/audit-v1.schema.json', 'packages/migrations/src/generated-audit.ts', 'migrations/schemas/audit-v1.schema.json'],
  ['packages/workspace-runtime/schemas/runtime-v1.schema.json', 'packages/workspace-runtime/src/generated.ts', 'workspace-runtime/schemas/runtime-v1.schema.json'],
];
for (const [source, target, label] of contracts) {
 const output = await compileFromFile(source, {
  bannerComment: `// Generated from ${label}. Run npm run schema:types; do not edit.`,
  unknownAny: true,
  strictIndexSignatures: false,
  ignoreMinAndMaxItems: true,
  style: { singleQuote: true, printWidth: 110 },
 });
 if (process.argv.includes('--check')) {
  if (await readFile(target, 'utf8') !== output) throw new Error(`Schema types are stale: ${target}; run npm run schema:types`);
 } else {
  await writeFile(target, output);
 }
}
