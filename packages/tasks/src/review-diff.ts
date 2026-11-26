import { runGit } from '../../git-workspace/src/git.js';
import type { IntegrationRecord } from './manual-contracts.js';

/**
 * Machine-generated task records that grow with the project size. A checkpoint input manifest
 * lists a digest for every selected element, so a few of them exceed the review display limit
 * on a 1,000-element project. The review diff lists them by Git object instead of full text.
 */
const SUMMARIZED_REVIEW_PATHS = ['tasks/*/checkpoints/*-inputs.yaml'] as const;
export const SUMMARY_HEADER = '# CRAFT summary: machine-generated task records (full bytes are in the candidate commit)';

const DIFF = ['diff', '--no-ext-diff', '--no-textconv'] as const;
const ZERO = /^0+$/;

interface RawChange { status: string; mode: string; object: string; path: string }

/** Parses `git diff --raw -z --no-renames` records: `:old new oldObject newObject status\0path\0`. */
function rawChanges(output: string): RawChange[] {
  const fields = output.split('\0');
  const changes: RawChange[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const match = /^:(\d{6}) (\d{6}) ([a-f0-9]+) ([a-f0-9]+) ([ADMT])$/.exec(fields[index] ?? '');
    const path = fields[index + 1];
    if (!match || !path) throw new Error('GIT_INVALID_DIFF');
    const [, oldMode, newMode, oldObject, newObject, status] = match;
    const deleted = status === 'D' || ZERO.test(newObject ?? '');
    changes.push({ status: status ?? 'M', mode: (deleted ? oldMode : newMode) ?? '', object: (deleted ? oldObject : newObject) ?? '', path });
  }
  return changes;
}

async function summary(root: string, target: string, candidate: string): Promise<string> {
  const raw = await runGit(root, [...DIFF, '--raw', '-z', '--no-renames', '--no-abbrev', target, candidate, '--', ...SUMMARIZED_REVIEW_PATHS.map(path => `:(glob)${path}`)]);
  const changes = rawChanges(raw.stdout.toString('utf8'));
  if (!changes.length) return '';
  const sizes = (await runGit(root, ['cat-file', '--batch-check=%(objectname) %(objectsize)'], Buffer.from(changes.map(change => change.object).join('\n') + '\n'))).stdout.toString('utf8').trim().split('\n');
  const lines = changes.map((change, index) => {
    const [object, size] = (sizes[index] ?? '').split(' ');
    if (object !== change.object || !size || !/^\d+$/.test(size)) throw new Error('GIT_INVALID_OBJECT');
    return `${change.status} ${change.mode} ${change.object} ${size} ${change.path}`;
  });
  return [SUMMARY_HEADER, ...lines].join('\n') + '\n';
}

/**
 * The text a user approves. Its digest is bound into the approval token and recomputed on apply,
 * so each stored `diffFormat` must keep producing byte-identical output:
 * - undefined: full binary diff (records prepared before formats existed)
 * - `binary-summary`: full text diff, binary files as object IDs
 * - `task-record-summary`: as above, with SUMMARIZED_REVIEW_PATHS listed one line each
 */
export async function reviewDiff(root: string, target: string, candidate: string, format: IntegrationRecord['diffFormat']): Promise<string> {
  const binary = format === undefined ? '--binary' : '--full-index';
  if (format !== 'task-record-summary') return (await runGit(root, [...DIFF, binary, target, candidate, '--'])).stdout.toString('utf8');
  const excluded = SUMMARIZED_REVIEW_PATHS.map(path => `:(exclude,glob)${path}`);
  const [full, summarized] = await Promise.all([
    runGit(root, [...DIFF, binary, target, candidate, '--', '.', ...excluded]),
    summary(root, target, candidate),
  ]);
  return full.stdout.toString('utf8') + summarized;
}
