import { expect, it } from "vitest";
import { loadProject, parseProject } from "../../project-fs/src/project.js";
import { objectFile, textFile } from "../../project-fs/src/content.js";
import {
  semanticDigest,
  dependencyManifestDigest,
} from "../../project-fs/src/changes.js";
import type { ProjectSnapshot, SourceFile } from "./model.js";
import type {
  Baseline,
  KnowledgeEvent,
  Reference,
  Revision,
  Sequence,
} from "../../schema/src/generated.js";
import { analyzeProject, resolveScope } from "./analysis.js";
import { gameContext } from "./game.js";
import { readStoryQuery, storyContext } from "./story.js";
import { perspectiveQuery } from "../../indexer/src/perspective.js";

const baseline = "baseline_main";
const ref = (
  entity_id: string,
  revision_id: string,
  reference_id: string,
): Reference => ({
  target: { entity_id, revision_id },
  reference_id,
  relation: "related_to",
  update_policy: "pinned",
  propagation: "none",
});

function analysis(snapshot: ProjectSnapshot) {
  return analyzeProject(snapshot, baseline, {
    semantic: (entity, revision) => semanticDigest(snapshot, entity, revision),
    dependency: (entity, revision) =>
      dependencyManifestDigest(snapshot, entity, revision),
  });
}

function add(
  files: Map<string, SourceFile>,
  selected: Baseline["selected"],
  kind: string,
  name: string,
  title: string,
  extension: unknown,
  text: string,
  references: Reference[] = [],
) {
  const id = "ent_" + name,
    revision_id = "rev_" + name;
  const entity = `entities/${id}/entity.yaml`,
    path = `entities/${id}/revisions/${revision_id}/meta.yaml`,
    body = `entities/${id}/revisions/${revision_id}/content.md`;
  files.set(entity, objectFile(entity, { id, kind }));
  const meta: Revision = {
    entity_id: id,
    revision_id,
    parents: [],
    status: "draft",
    title,
    body_path: "content.md",
    scope: {},
    references,
    extensions: { narrative: extension as Revision["extensions"][string] },
    created_at: "2026-11-19T00:00:00Z",
    created_by: { type: "user", id: "fixture" },
  };
  files.set(path, objectFile(path, meta));
  files.set(body, textFile(body, text));
  selected[id] = revision_id;
  return ref(id, revision_id, "ref_" + name);
}

it("keeps story time and publication order independent and filters search, proof and linked reads", async () => {
  const source = await loadProject("fixtures/narrative"),
    sourceSequence = "narrative/sequences/seq_main.yaml";
  const files = new Map(source.files),
    target = source.baselines.get(baseline)!;
  const selected = { ...target.value.selected };
  const flashback = add(
    files,
    selected,
    "narrative.scene",
    "flashback",
    "회상 장면",
    { start_tick: 3, end_tick: 5 },
    "Long ago.",
  );
  const futureFact = add(
    files,
    selected,
    "world.fact",
    "never_show_fact",
    "FUTURE_TITLE",
    { record_role: "canon", world_tick: 300 },
    "FUTURE_BODY",
  );
  const future = add(
    files,
    selected,
    "narrative.scene",
    "future",
    "FUTURE_SCENE",
    { start_tick: 290, end_tick: 300 },
    "Secret future body.",
  );
  add(
    files,
    selected,
    "narrative.reveal_event",
    "future_reveal",
    "FUTURE_EVIDENCE",
    {
      record_role: "canon",
      sequence_id: "seq_main",
      scene: future,
      boundary: "after",
      target: futureFact,
      revealed_content: "FUTURE_DISCLOSURE",
    },
    "FUTURE_EVIDENCE",
  );
  const story = source.documents.get(sourceSequence) as Sequence;
  files.set(
    sourceSequence,
    objectFile(sourceSequence, {
      ...story,
      chapters: [
        ...story.chapters,
        { id: "chapter_two", label: "회상", scenes: [flashback, future] },
      ],
    }),
  );
  files.set(
    target.path,
    objectFile(target.path, { ...target.value, selected }),
  );
  const snapshot = parseProject(files),
    checked = analysis(snapshot);
  const char = {
    characterId: "ent_abcde",
    mode: "working" as const,
    boundary: "after" as const,
    sequenceId: "seq_main",
  };
  const early = storyContext(source, baseline, {}, analysis(source), {
    ...char,
    sceneId: "ent_scene",
    boundary: "before",
  });
  expect(
    "state" in early &&
      early.state?.cells.find((value) => value.field === "location")?.value,
  ).not.toBe("비밀 통로");
  const after = storyContext(snapshot, baseline, {}, checked, {
    ...char,
    sceneId: "ent_scene",
  });
  expect(
    "state" in after &&
      after.state?.cells.find((value) => value.field === "location"),
  ).toMatchObject({ value: "비밀 통로", certainty: "provisional" });
  expect(
    "facts" in after &&
      after.facts.find((value) => value.target.entity_id === "ent_passage")
        ?.attitude,
  ).toBe("knows");
  const flashbackQuery = { ...char, sceneId: "ent_flashback" };
  const author = storyContext(snapshot, baseline, {}, checked, flashbackQuery);
  expect(author.worldTick).toBe(5);
  expect(author.readerPosition).toBe(1);
  expect(
    "state" in author &&
      author.state?.cells.find((value) => value.field === "location")?.value,
  ).not.toBe("비밀 통로");
  const perspective = { kind: "reader" as const, story: flashbackQuery };
  const scoped = (operation: string, args: Record<string, unknown> = {}) =>
    perspectiveQuery(
      snapshot,
      baseline,
      {},
      checked,
      perspective,
      operation,
      args,
    );
  const allowed = scoped("story") as {
    disclosures: Array<{
      text: string;
      target: { entity_id: string; revision_id: string };
    }>;
  };
  expect(allowed.disclosures[0]?.text).toBe("왕궁에 비밀 통로가 있다.");
  expect(JSON.stringify(allowed)).not.toMatch(
    /FUTURE|ent_passage|ent_flashback/,
  );
  const pin = allowed.disclosures[0]!.target;
  expect(
    scoped("exact", { entityId: pin.entity_id, revisionId: pin.revision_id }),
  ).toMatchObject({ body: allowed.disclosures[0]!.text, references: [] });
  expect(
    scoped("search", {
      text: "FUTURE",
      includeFiles: true,
      includeHistory: true,
    }),
  ).toEqual({ hits: [] });
  expect(() =>
    scoped("reverse", {
      entityId: "ent_never_show_fact",
      revisionId: "rev_never_show_fact",
    }),
  ).toThrow("CONTEXT_FORBIDDEN");
  expect(() => scoped("tasks")).toThrow("CONTEXT_FORBIDDEN");
  expect(() =>
    readStoryQuery({ ...char, boundary: ["before"], sceneId: "ent_scene" }),
  ).toThrow("QUERY_ARGUMENT_INVALID");
});

it("distinguishes degrees of awareness and omits explicitly unknown facts from the character projection", async () => {
  const source = await loadProject("fixtures/narrative"),
    files = new Map(source.files),
    target = source.baselines.get(baseline)!;
  const selected = { ...target.value.selected },
    scene = source.entities.get("ent_scene")!.revisions.get("rev_scene_a")!;
  const fixture = source.entities
    .get("ent_knowledge")!
    .revisions.get("rev_knowledge_a")!.meta.extensions[
    "narrative"
  ] as unknown as KnowledgeEvent;
  const related: Reference[] = [];
  for (const [name, attitude] of [
    ["trap", "believes"],
    ["cover", "suspects"],
    ["owner", "explicitly_unaware"],
    ["witness", "unrecorded"],
  ] as const) {
    const proposition = add(
      files,
      selected,
      "world.fact",
      name,
      "INTERNAL_TITLE_" + name,
      { record_role: "canon", world_tick: 0 },
      "AUTHOR_ONLY_" + name,
    );
    related.push(proposition);
    if (attitude !== "unrecorded") {
      add(
        files,
        selected,
        "narrative.knowledge_event",
        "aware_" + name,
        "PRIVATE_EVENT_TITLE",
        { ...fixture, proposition, attitude },
        "SAFE_EXPRESSION_" + name,
      );
    }
  }
  files.set(
    scene.path,
    objectFile(scene.path, { ...scene.meta, references: related }),
  );
  files.set(
    target.path,
    objectFile(target.path, { ...target.value, selected }),
  );
  const snapshot = parseProject(files),
    checked = analysis(snapshot);
  const query = {
    sequenceId: "seq_main",
    sceneId: "ent_scene",
    boundary: "after",
    characterId: "ent_abcde",
    mode: "working",
  } as const;
  const author = storyContext(snapshot, baseline, {}, checked, query);
  expect(
    "facts" in author && author.facts.map((value) => value.attitude),
  ).toEqual(
    expect.arrayContaining([
      "knows",
      "believes",
      "suspects",
      "explicitly_unaware",
      "unrecorded",
    ]),
  );
  const character = perspectiveQuery(
    snapshot,
    baseline,
    {},
    checked,
    { kind: "character", story: query },
    "story",
    {},
  );
  expect(JSON.stringify(character)).toContain("SAFE_EXPRESSION_cover");
  expect(JSON.stringify(character)).not.toMatch(
    /PRIVATE_EVENT_TITLE|AUTHOR_ONLY_|INTERNAL_TITLE_|SAFE_EXPRESSION_owner/,
  );
});

it("reads gameplay scope and separates selected design, unselected proposals and measured build observations", async () => {
  const snapshot = await loadProject("fixtures/game-design");
  const available = gameContext(
    snapshot,
    baseline,
    resolveScope(snapshot, baseline),
    analysis(snapshot),
  );
  expect(available.scope).toMatchObject({ platform: "pc", mode: "pve" });
  expect(
    available.rules.find((rule) => rule.target.entity_id === "ent_dodge")
      ?.quantities["invulnerability"],
  ).toMatchObject({ value: 0.2, unit: "seconds" });
  expect(
    available.proposals.some(
      (value) => value.target.revision_id === "rev_stamina_b",
    ),
  ).toBe(true);
  expect(available.observations[0]).toMatchObject({
    build_id: "build-fixture-04",
    conditions: { mode: "pve" },
  });
  expect(available.differences[0]?.delta).toBeCloseTo(0.05);
  expect(() => resolveScope(snapshot, baseline, { mode: "pvp" })).toThrow(
    "SCOPE_MISMATCH",
  );
});
