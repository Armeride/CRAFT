import audit from '../schemas/audit-v1.schema.json' with { type: 'json' };
import { ValidationFailure } from '../../domain/src/model.js';
import { SchemaValidator } from '../../schema/src/index.js';
import type { SourceFile } from '../../domain/src/model.js';
import { fileFailure } from '../../project-fs/src/files.js';
import { parseYaml } from '../../project-fs/src/yaml.js';

const validator = new SchemaValidator(audit, audit.$id);
export function validateAudit(definition: string, value: unknown, path: string): void {
  const invalid = validator.validate(definition, value, path);
  if (invalid.length) throw new ValidationFailure(invalid);
}

export function validateMigrationArtifacts(files: ReadonlyMap<string, SourceFile>): void {
  for (const [path, file] of files) {
    const match = /^migrations\/(attestations|decisions)\/([^/]+)\.json$/.exec(path);
    if (!match) continue;
    if (file.text === undefined) throw fileFailure('MIGRATION_AUDIT_INVALID', 'Audit source is not UTF-8', path);
    parseYaml(file.text, path);
    let value: unknown;
    try { value = JSON.parse(file.text); } catch { throw fileFailure('MIGRATION_AUDIT_INVALID', 'Audit files require JSON syntax', path); }
    validateAudit(match[1] === 'attestations' ? 'Attestation' : 'DecisionRecord', value, path);
    if ((value as { id: string }).id !== match[2]) throw fileFailure('MIGRATION_AUDIT_INVALID', 'Audit ID differs from its filename', path);
  }
}
