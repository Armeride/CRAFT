import type { ProjectSnapshot, SourceFile } from '../../domain/src/model.js';
import type { FileChangeSet } from '../../project-fs/src/changes.js';
import type { Answer, ContextMapping, Diagnostic, Plan, Report, Request, ReviewMapping as AuditReviewMapping, SemanticMapping as AuditSemanticMapping, SourceMapping as AuditSourceMapping, Versions } from './generated-audit.js';

export type VersionSet = Readonly<Versions>;
export interface MigrationSnapshot {
  readonly registryId: string;
  readonly versions: VersionSet;
  readonly semanticModelVersion: number;
  readonly files: ReadonlyMap<string, SourceFile>;
  /** Interpreted semantic data; its file digests are not raw-source digests. */
  readonly normalized: ProjectSnapshot;
}
export interface ProjectCodec {
  readonly core: number;
  readonly id: string;
  readonly digest: string;
  read(files: ReadonlyMap<string, SourceFile>, registryId: string): MigrationSnapshot;
}
export type DecisionRequest = Readonly<Request>;
export type DecisionAnswer = Readonly<Answer>;
export type DecisionMap = Readonly<Record<string, DecisionAnswer>>;
export interface StepPreflight {
  readonly expectedFiles: readonly string[];
  readonly decisions: readonly DecisionRequest[];
  readonly warnings: readonly string[];
}
export interface MigrationStep {
  readonly id: string;
  readonly from: VersionSet;
  readonly implementationDigest: string;
  destination(current: VersionSet): VersionSet;
  preflight(input: MigrationSnapshot): Promise<StepPreflight>;
  transform(input: MigrationSnapshot, decisions: DecisionMap): Promise<FileChangeSet>;
  verify(before: MigrationSnapshot, after: MigrationSnapshot): Promise<MigrationReport>;
}
export interface MigrationPlan extends Readonly<Omit<Plan, 'steps' | 'expectedFiles' | 'decisions' | 'warnings'>> {
  readonly steps: readonly Readonly<Plan['steps'][number]>[];
  readonly expectedFiles: readonly string[];
  readonly decisions: readonly DecisionRequest[];
  readonly warnings: readonly string[];
}
export type SourceMapping = AuditSourceMapping;
export type SemanticMapping = AuditSemanticMapping;
export type ReviewMapping = AuditReviewMapping;
export interface MigrationReport extends Readonly<Omit<Report, 'sourceMappings' | 'semanticMappings' | 'reviewMappings' | 'contextMappings' | 'diagnostics'>> {
  readonly sourceMappings: readonly SourceMapping[];
  readonly semanticMappings: readonly SemanticMapping[];
  readonly reviewMappings: readonly ReviewMapping[];
  readonly contextMappings: readonly ContextMapping[];
  readonly diagnostics: readonly Diagnostic[];
}
