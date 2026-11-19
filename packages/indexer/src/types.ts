import type { SourceFile, Diagnostic } from '../../domain/src/model.js';
import type { Perspective } from '../../domain/src/story-contracts.js';
import type { QueryScope } from '../../domain/src/analysis.js';

export const INDEX_FORMAT = 1;
export interface ScopeIdentity { registrationId: string; projectId: string; root: string; commonDir: string; gitDir: string; worktreeId: string; taskId?: string; runId?: string; view: 'basis' | 'working'; basisCommit?: string }
export interface SourceIdentity { fileFingerprint: string; headCommit: string; reference: string; epoch: string | null }
export interface CapturedSource { source: SourceIdentity; sourceFingerprint: string; files: SourceFile[]; immutableFiles: SourceFile[] }
export interface IndexManifest { format: 1; scopeKey: string; generationId: string; generation: number; source: SourceIdentity; sourceFingerprint: string; projectId: string; builtAt: string; mode: 'full' | 'incremental'; changedFiles: string[]; updatedRevisions: string[]; removedRevisions: string[]; counts: { files: number; revisions: number; references: number }; timings: { prepareMs: number; sqliteMs: number; workerThreadId: number } }
export interface IndexFailure { sourceFingerprint: string | null; code: string; diagnostics: readonly Diagnostic[] }
export interface IndexStatus { freshness: 'fresh' | 'rebuilding' | 'stale' | 'invalid_source'; manifest: IndexManifest | null; failure: IndexFailure | null; currentSourceFingerprint: string | null }
export const queryOperations = ['catalog', 'exact', 'selected', 'search', 'analyze', 'reverse', 'diff', 'tasks', 'state', 'state-input', 'state-options', 'state-evaluate', 'state-compare', 'story-options', 'story', 'game'] as const;
export type QueryOperation = typeof queryOperations[number];
export interface QueryOptions { scopeToken: string; baselineId?: string; expectedSnapshot?: string; scope?: QueryScope; perspective?: 'author' | Perspective; allowStale?: boolean; autoRebuild?: boolean; onPhase?: (phase: 'queried') => Promise<void> }
export interface QueryEnvelope<T> { data: T; scope: ScopeIdentity; snapshotToken: string; sourceFingerprint: string; currentSourceFingerprint: string | null; baselineFingerprint: string; generationId: string; freshness: IndexStatus['freshness'] }
export interface WorkerRequest { id: number; operation: string; payload: unknown }
export interface WorkerReply { id: number; result?: unknown; error?: { code: string; message: string; diagnostics?: readonly Diagnostic[] } }
