import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  Baseline,
  Project,
  Reference,
  Review,
  Revision,
  SchemaLock,
  Sequence,
} from "../packages/schema/src/generated.js";
import { objectFile } from "../packages/project-fs/src/content.js";
import { loadProject } from "../packages/project-fs/src/project.js";
import { parseYaml } from "../packages/project-fs/src/yaml.js";
import {
  dependencyManifestDigest,
  semanticDigest,
} from "../packages/project-fs/src/changes.js";

const clock = "2026-11-19T00:00:00Z",
  reviewer = { type: "user" as const, id: "example-reviewer" };
const labels = {
  "border-story": "1장과 5장의 국경 · 예시",
  narrative: "발견과 회상 · 예시",
  "game-design": "회피 규칙과 빌드 관찰 · 예시",
};

async function save(root: string, path: string, value: unknown) {
  const location = join(root, path);
  await mkdir(dirname(location), { recursive: true });
  await writeFile(location, objectFile(path, value).text!, "utf8");
}

async function addScene(
  root: string,
  id: string,
  title: string,
  start: number,
  end: number,
  baseline: Baseline,
): Promise<Reference> {
  const entity_id = "ent_" + id,
    revision_id = "rev_" + id,
    path = "entities/" + entity_id + "/revisions/" + revision_id;
  const meta: Revision = {
    entity_id,
    revision_id,
    title,
    scope: {},
    references: [],
    parents: [],
    body_path: "content.md",
    created_at: clock,
    created_by: reviewer,
    status: "approved",
    extensions: { narrative: { start_tick: start, end_tick: end } },
  };
  await save(root, "entities/" + entity_id + "/entity.yaml", {
    id: entity_id,
    kind: "narrative.scene",
  });
  await save(root, path + "/meta.yaml", meta);
  await writeFile(join(root, path, "content.md"), "# " + title + "\n");
  baseline.selected[entity_id] = revision_id;
  return {
    reference_id: "ref_" + id,
    relation: "depends_on",
    propagation: "blocking",
    update_policy: "pinned",
    target: { entity_id, revision_id },
  };
}

export async function seedDomainExample(
  root: string,
  example: keyof typeof labels,
) {
  const original = await loadProject(root),
    project: Project = { ...original.project, name: labels[example] };
  const value = original.baselines.get(original.project.default_baseline_id)!;
  const baseline: Baseline = {
    ...value.value,
    selected: { ...value.value.selected },
  };
  if (example === "border-story") {
    const path = "fixtures/narrative/schemas/lock.json";
    const narrative = (JSON.parse(await readFile(path, "utf8")) as SchemaLock)
      .extensions["narrative"]!;
    const lock = JSON.parse(
      original.files.get("schemas/lock.json")!.text!,
    ) as SchemaLock;
    project.extensions = {
      ...project.extensions,
      narrative: { schema_version: 1, required: true },
    };
    await save(root, "schemas/lock.json", {
      ...lock,
      extensions: { ...lock.extensions, narrative },
    });
    const first = await addScene(
      root,
      "border_chapter_one",
      "북쪽 경계",
      0,
      10,
      baseline,
    );
    const fifth = await addScene(
      root,
      "border_chapter_five",
      "조약 이후의 경계",
      40,
      50,
      baseline,
    );
    await save(root, "narrative/sequences/seq_border.yaml", {
      id: "seq_border",
      chapters: [
        { id: "chapter_one", label: "1장", scenes: [first] },
        { id: "chapter_five", label: "5장", scenes: [fifth] },
      ],
    });
  }
  if (example === "narrative") {
    const path = "narrative/sequences/seq_main.yaml";
    const sequence = parseYaml(original.files.get(path)!.text!, path)
      .value as unknown as Sequence;
    const flashback = await addScene(
      root,
      "early_flashback",
      "발견 전의 회상",
      3,
      5,
      baseline,
    );
    await save(root, path, {
      ...sequence,
      chapters: [
        ...sequence.chapters,
        { id: "chapter_two", label: "2화", scenes: [flashback] },
      ],
    });
  }
  await save(root, "project.yaml", project);
  await save(root, value.path, baseline);
  for (const [entityId, revisionId] of Object.entries(baseline.selected)) {
    const row = original.entities.get(entityId)?.revisions.get(revisionId);
    if (
      row &&
      row.meta.status !== "approved" &&
      row.meta.extensions["state_model"]?.["record_type"] !== "scenario"
    ) {
      await save(root, row.path, { ...row.meta, status: "approved" });
    }
  }
  const updated = await loadProject(root);
  for (const [entity_id, revision_id] of Object.entries(baseline.selected)) {
    const row = updated.entities.get(entity_id)!.revisions.get(revision_id)!;
    if (row.meta.status !== "approved") continue;
    const review: Review = {
      id: "review_example_" + entity_id,
      subject: { entity_id, revision_id },
      semantic_model_version: 1,
      subject_semantic_digest: semanticDigest(updated, entity_id, revision_id),
      dependency_manifest_digest: dependencyManifestDigest(
        updated,
        entity_id,
        revision_id,
      ),
      scope: row.meta.scope,
      outcome: "accepted",
      reviewer,
      created_at: clock,
    };
    await save(root, "reviews/" + review.id + ".yaml", review);
  }
  await loadProject(root);
}
