import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runGit } from '../packages/git-workspace/src/git.js';
import type { Baseline, Entity, Revision } from '../packages/schema/src/generated.js';

/** Synthetic planning project shared by the index and sourcebook measurements. */
export interface ScaleShape { entities: number; revisions: number }
export const entityId = (number: number): string => `ent_scale_${String(number)}`;
export const revisionId = (entity: number, revision: number): string => `rev_scale_${String(entity)}_${String(revision)}`;

async function writeEntity(root: string, number: number, shape: ScaleShape): Promise<void> {
  const id = entityId(number);
  const folder = join(root, 'entities', id);
  await mkdir(join(folder, 'revisions'), { recursive: true });
  await writeFile(join(folder, 'entity.yaml'), JSON.stringify({ id, kind: 'document' } satisfies Entity));
  await Promise.all(Array.from({ length: shape.revisions }, async (_, revision) => {
    const path = join(folder, 'revisions', revisionId(number, revision));
    await mkdir(path);
    const meta: Revision = {
      entity_id: id, revision_id: revisionId(number, revision), title: `기획 항목 ${String(number)} · ${String(revision)}`,
      status: 'draft', body_path: 'content.md', parents: revision ? [revisionId(number, revision - 1)] : [],
      scope: {}, extensions: {}, references: number % 5 ? [{ reference_id: 'ref_neighbor',
        relation: 'related_to', propagation: 'none', update_policy: 'pinned',
        target: { entity_id: entityId(number - 1), revision_id: revisionId(number - 1, revision) } }] : [],
      created_at: '2026-11-10T04:00:00Z', created_by: { id: 'scale-fixture', type: 'user' },
    };
    await Promise.all([
      writeFile(join(path, 'meta.yaml'), JSON.stringify(meta)),
      writeFile(join(path, 'content.md'), `# ${meta.title}\n\n국경과 교역로의 배경. 장면과 게임 기획에서 참고한다.\n`),
    ]);
  }));
}

/** Writes the project files under `root`. The caller adds extra files and commits. */
export async function writeScaleProject(root: string, shape: ScaleShape): Promise<void> {
  await cp(resolve('fixtures/valid-minimal'), root, { recursive: true });
  await Promise.all(['entities/ent_overview', 'reviews', 'tasks'].map(path => rm(join(root, path), { recursive: true })));
  const batch = 16;
  const offsets = Array.from({ length: Math.ceil(shape.entities / batch) }, (_, i) => i * batch);
  await offsets.reduce(async (previous, first) => {
    await previous;
    await Promise.all(Array.from({ length: Math.min(batch, shape.entities - first) }, (_, i) => writeEntity(root, first + i, shape)));
  }, Promise.resolve());
  const baseline: Baseline = { id: 'baseline_main', kind: 'working', name: 'Scale', scope: {},
    closure_policy: 'require_selected_dependencies',
    selected: Object.fromEntries(Array.from({ length: shape.entities }, (_, i) => [entityId(i), revisionId(i, shape.revisions - 1)])),
  };
  await writeFile(join(root, 'baselines/baseline_main.yaml'), JSON.stringify(baseline));
}

export async function commitAll(root: string, message: string): Promise<void> {
  await runGit(root, ['init']);
  await runGit(root, ['add', '.']);
  await runGit(root, ['-c', 'user.name=CRAFT Scale', '-c', 'user.email=scale@localhost', 'commit', '-m', message]);
}
