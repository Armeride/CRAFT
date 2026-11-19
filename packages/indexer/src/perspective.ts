import { createHash } from "node:crypto";
import type {
  BaselineAnalysis,
  QueryScope,
} from "../../domain/src/analysis.js";
import type { ProjectSnapshot } from "../../domain/src/model.js";
import { storyContext } from "../../domain/src/story.js";
import type { Perspective } from "../../domain/src/story-contracts.js";

const normalize = (text: string) =>
  text.normalize("NFC").toLocaleLowerCase("en");
export const restrictedOperations = [
  "story",
  "catalog",
  "search",
  "exact",
  "selected",
  "reverse",
] as const;

export function perspectiveQuery(
  snapshot: ProjectSnapshot,
  baseline: string,
  scope: QueryScope,
  analysis: BaselineAnalysis,
  perspective: Perspective,
  operation: string,
  args: Record<string, unknown>,
) {
  const raw = storyContext(
    snapshot,
    baseline,
    scope,
    analysis,
    perspective.story,
    perspective.kind,
  );
  const disclosures = raw.disclosures.map((item) => {
    const hash = createHash("sha256")
      .update(
        snapshot.fingerprint +
          "\\0" +
          item.target.entity_id +
          "/" +
          item.target.revision_id,
      )
      .digest("hex")
      .slice(0, 32);
    return {
      ...item,
      target: {
        entity_id: "ent_view_" + hash,
        revision_id: "rev_view_" + hash,
      },
    };
  });
  const context = {
    perspective: perspective.kind,
    mode: perspective.story.mode ?? "confirmed",
    worldTick: raw.worldTick,
    readerPosition: raw.readerPosition,
    disclosures,
    issues: [],
  };
  // The restricted result is built from explicit disclosures, never from raw titles, index snippets, evidence or edges.
  const documents = new Map<
    string,
    {
      entityId: string;
      revisionId: string;
      body: string;
      title: string;
      references: never[];
    }
  >();
  for (const item of context.disclosures) {
    const { entity_id: entityId, revision_id: revisionId } = item.target;
    const key = entityId + "/" + revisionId;
    const existing = documents.get(key);
    if (existing) existing.body += "\n\n" + item.text;
    else
      documents.set(key, {
        entityId,
        revisionId,
        body: item.text,
        title: item.text.split(/\r?\n/)[0]!.slice(0, 120),
        references: [],
      });
  }
  const search = () => {
    const text = args["text"],
      limit = args["limit"] ?? 50;
    if (
      typeof text !== "string" ||
      !text.trim() ||
      text.length > 256 ||
      typeof limit !== "number" ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 200
    )
      throw new Error("QUERY_ARGUMENT_INVALID");
    return {
      hits: [...documents.values()]
        .filter((item) => normalize(item.body).includes(normalize(text)))
        .slice(0, limit)
        .map(({ body, ...item }) => ({ ...item, snippet: body.slice(0, 360) })),
    };
  };
  switch (operation) {
    case "story":
      return context;
    case "catalog":
      return {
        entities: [...documents.values()].map(
          ({ body: _body, ...item }) => item,
        ),
        edges: [],
      };
    case "search":
      return search();
    case "selected":
    case "exact":
    case "reverse": {
      const doc =
        operation === "selected"
          ? [...documents.values()].find(
              (item) => args["entityId"] === item.entityId,
            )
          : documents.get(
              String(args["entityId"]) + "/" + String(args["revisionId"]),
            );
      if (!doc) throw new Error("CONTEXT_FORBIDDEN");
      return operation === "reverse" ? { results: [], truncated: false } : doc;
    }
    default:
      throw new Error("CONTEXT_FORBIDDEN");
  }
}
