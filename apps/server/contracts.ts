import type { Project, Baseline, Revision, Scope, Reference } from '../../packages/schema/src/generated.js';
import type { BaselineAnalysis, Edge } from '../../packages/domain/src/analysis.js';
export type { BaselineAnalysis, Edge };
export interface RevisionSummary { revisionId: string; title: string; status: Revision['status']; tags: string[]; scope: Scope; parents: string[]; references: number; createdAt: string }
export interface Catalog { project: Project; baselines: Baseline[]; entities: { entityId: string; kind: string; selectedRevision: string | null; revisions: RevisionSummary[] }[] }
export interface EntityDetail { entityId: string; revisionId: string; kind: string; meta: Revision; references: Reference[]; body: string; sourcePath: string; sourceDigest: string; bodyDigest: string; selected: boolean; writable: boolean }
export interface ProjectChoice { id: string; name: string; example: boolean }
export interface Session { csrf: string; projects: ProjectChoice[]; demo: boolean }
export interface SearchResults { hits: { type: string; entityId?: string; revisionId?: string; title?: string; snippet: string }[] }
export interface ReverseResults { results: { source: string; path: Edge[] }[]; truncated: boolean }
export interface Draft { runId: string; registrationId: string; goal: string; text: string; digest: string | null; state: string }
