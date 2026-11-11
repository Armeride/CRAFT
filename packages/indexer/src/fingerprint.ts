import { canonicalJson } from '../../domain/src/canonical.js';
import { hash } from '../../project-fs/src/files.js';
import type { SourceIdentity } from './types.js';
export const sourceFingerprint = (scopeKey: string, source: SourceIdentity): string => hash(canonicalJson({ scopeKey, ...source }));
