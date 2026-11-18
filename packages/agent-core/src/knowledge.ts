import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { ProjectIndex } from "../../indexer/src/service.js";
import { ManualService } from "../../tasks/src/manual.js";
import { TaskService } from "../../tasks/src/service.js";
import { rawObject } from "../../project-fs/src/content.js";
import { semanticDigest } from "../../project-fs/src/changes.js";
import { fileFailure } from "../../project-fs/src/files.js";
import { captureFiles } from "../../project-fs/src/files.js";
import { hash } from "../../project-fs/src/files.js";
import { loadCommittedProject } from "../../project-fs/src/git-baseline.js";
import { canonicalJson } from "../../domain/src/canonical.js";
import type { SourceFile } from "../../domain/src/model.js";
import type { Revision, Task } from "../../schema/src/generated.js";
import type { QueryEnvelope } from "../../indexer/src/types.js";
import type { AgentExecution } from "./contracts.js";

const identifier = { type: "string", pattern: "^[a-z][a-z0-9_-]{0,255}$" };
const view = { enum: ["basis", "working"] };
const boundedText = (length: number) => ({
  type: "string",
  minLength: 1,
  maxLength: length,
});
const schema = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({ type: "object", additionalProperties: false, properties, required });

export const knowledgeTools = [
  {
    name: "knowledge.search",
    description:
      "Search the bound task knowledge. Results include exact revision and snapshot provenance.",
    inputSchema: schema(
      {
        text: boundedText(256),
        limit: { type: "integer", minimum: 1, maximum: 50 },
        view,
      },
      ["text"],
    ),
  },
  {
    name: "entity.get",
    description: "Read an exact entity revision within this task.",
    inputSchema: schema(
      { entityId: identifier, revisionId: identifier, view },
      ["entityId", "revisionId"],
    ),
  },
  {
    name: "references.reverse",
    description: "Find direct and indirect reverse references in this task.",
    inputSchema: schema(
      { entityId: identifier, revisionId: identifier, view },
      ["entityId", "revisionId"],
    ),
  },
  {
    name: "context.build",
    description:
      "Read task context and the current workingFingerprint required for changes.propose. The optional view is basis or working.",
    inputSchema: schema({ view }),
  },
  {
    name: "project.validate",
    description:
      "Validate references, dependency propagation and review requirements in the bound baseline.",
    inputSchema: schema({ view }),
  },
  {
    name: "task.checkpoint",
    description:
      "Preserve task working files, knowledge receipts and a checkpoint in Git.",
    inputSchema: schema({ summary: boundedText(4000) }, ["summary"]),
  },
  {
    name: "changes.propose",
    description:
      "Create an immutable unselected draft revision and proposal. This updates the task working document for live preview. User review and integration happen separately. Reuse requestId for an identical retry.",
    inputSchema: schema(
      {
        requestId: { type: "string", format: "uuid" },
        expectedSnapshot: { type: "string", pattern: "^[a-f0-9]{64}$" },
        title: boundedText(1000),
        body: { type: "string", maxLength: 300000 },
        references: {
          type: "array",
          maxItems: 1000,
          items: { type: "object" },
        },
        extensions: { type: "object" },
        scope: { type: "object" },
        tags: {
          type: "array",
          maxItems: 1000,
          items: { type: "string", maxLength: 256 },
        },
      },
      ["requestId", "expectedSnapshot", "title", "body"],
    ),
  },
];

const validator = new Ajv2020({ strict: false, validateFormats: false });
const validators = new Map(
  knowledgeTools.map((tool) => [
    tool.name,
    validator.compile(tool.inputSchema),
  ]),
);

export interface KnowledgeReceipt {
  tool: string;
  view: "basis" | "working";
  snapshotToken: string;
  sourceFingerprint: string;
  baselineFingerprint: string;
  query: Record<string, unknown>;
  resultDigest: string;
  basisCommit: string;
  sourceCommit: string;
  targets: {
    entityId: string;
    revisionId: string;
    sourcePath: string;
    sourceDigest: string;
    semanticDigest: string;
  }[];
}

export class RunKnowledge {
  readonly tasks: TaskService;
  readonly receipts: KnowledgeReceipt[] = [];
  readonly managedFiles = new Map<string, string>();
  private indexes = new Map<string, ProjectIndex>();
  private tail: Promise<unknown> = Promise.resolve();
  private initialFiles: ReadonlyMap<string, SourceFile> | undefined;
  private initialTask: Task | undefined;

  constructor(
    readonly appData: string,
    readonly execution: AgentExecution,
  ) {
    this.tasks = new TaskService(appData);
  }

  async initialize(): Promise<void> {
    const { run } = await this.tasks.run(this.execution.runId);
    this.initialFiles = await captureFiles(run.path, false);
    this.initialTask = rawObject<Task>(
      this.initialFiles,
      `tasks/${run.taskId}/task.yaml`,
    );
  }

  async assertManaged(): Promise<void> {
    if (!this.initialFiles || !this.initialTask)
      throw fileFailure(
        "AGENT_NOT_READY",
        "Execution has not initialized",
        "project.yaml",
      );
    const { run } = await this.tasks.run(this.execution.runId);
    const current = await captureFiles(run.path, false);
    const taskPath = `tasks/${run.taskId}/task.yaml`;
    const task = rawObject<Task>(current, taskPath);
    const stable = ({ status, outputs, latest_checkpoint, ...rest }: Task) =>
      rest;
    if (canonicalJson(stable(task)) !== canonicalJson(stable(this.initialTask)))
      throw fileFailure(
        "AGENT_RESULT_INVALID",
        "Task identity or inputs changed",
        taskPath,
      );
    if (
      task.latest_checkpoint !== this.initialTask.latest_checkpoint &&
      !this.managedFiles.has(
        `tasks/${run.taskId}/checkpoints/${task.latest_checkpoint}.yaml`,
      )
    )
      throw fileFailure(
        "AGENT_RESULT_INVALID",
        "Unmanaged checkpoint selection",
        taskPath,
      );
    if (
      task.outputs.some(
        (path) =>
          !this.initialTask!.outputs.includes(path) &&
          !path.startsWith(`tasks/${run.taskId}/working/`) &&
          !this.managedFiles.has(path),
      )
    )
      throw fileFailure(
        "AGENT_RESULT_INVALID",
        "Unmanaged task output",
        taskPath,
      );
    for (const path of new Set([
      ...this.initialFiles.keys(),
      ...current.keys(),
    ])) {
      if (
        this.initialFiles.get(path)?.digest === current.get(path)?.digest ||
        path === taskPath ||
        path.startsWith(`tasks/${run.taskId}/working/`)
      )
        continue;
      if (
        !current.has(path) ||
        this.managedFiles.get(path) !== current.get(path)?.digest
      )
        throw fileFailure(
          "AGENT_RESULT_INVALID",
          "Change is outside managed draft commands",
          path,
        );
    }
  }

  call(name: string, input: Record<string, unknown>): Promise<unknown> {
    const next = this.tail.catch(() => {}).then(() => this.invoke(name, input));
    this.tail = next;
    return next;
  }

  private async query(
    operation: Parameters<ProjectIndex["query"]>[0],
    args: Record<string, unknown>,
    selectedView: "basis" | "working",
  ): Promise<QueryEnvelope<unknown> & { workingFingerprint?: string }> {
    let index = this.indexes.get(selectedView);
    if (!index) {
      index = await ProjectIndex.run(
        this.appData,
        this.execution.runId,
        selectedView,
      );
      this.indexes.set(selectedView, index);
    }
    const result = await index.query(operation, args, {
      scopeToken: index.scopeToken,
      baselineId: this.execution.baselineId,
    });
    if (this.receipts.length >= 500)
      throw fileFailure(
        "CONTEXT_LIMIT",
        "Knowledge receipt limit reached",
        "project.yaml",
      );
    const targets: KnowledgeReceipt["targets"] = [];
    const { run, registration } = await this.tasks.run(this.execution.runId);
    const files =
      selectedView === "working"
        ? await this.tasks.project(run.runId)
        : await loadCommittedProject(registration.root, run.basisCommit);
    const status = await index.status(index.scopeToken);
    if (status.manifest?.source.fileFingerprint !== files.fingerprint)
      throw fileFailure(
        "SOURCE_CHANGED",
        "Context inputs changed",
        "project.yaml",
      );
    if (
      files &&
      typeof args["entityId"] === "string" &&
      typeof args["revisionId"] === "string"
    ) {
      const revision = files.entities
        .get(args["entityId"])
        ?.revisions.get(args["revisionId"]);
      if (revision)
        targets.push({
          entityId: revision.meta.entity_id,
          revisionId: revision.meta.revision_id,
          sourcePath: revision.bodyPath,
          sourceDigest: files.files.get(revision.bodyPath)!.digest,
          semanticDigest: semanticDigest(
            files,
            revision.meta.entity_id,
            revision.meta.revision_id,
          ),
        });
    }
    const receipt: KnowledgeReceipt = {
      tool: operation,
      view: selectedView,
      snapshotToken: result.snapshotToken,
      sourceFingerprint: result.sourceFingerprint,
      baselineFingerprint: result.baselineFingerprint,
      query: args,
      resultDigest: hash(canonicalJson(result.data)),
      basisCommit: run.basisCommit,
      sourceCommit: status.manifest.source.headCommit,
      targets,
    };
    const path = join(
      this.appData,
      "agents",
      this.execution.id,
      "knowledge.jsonl",
    );
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, JSON.stringify(receipt) + "\n", "utf8");
    this.receipts.push(receipt);
    return {
      ...result,
      ...(selectedView === "working"
        ? { workingFingerprint: files.fingerprint }
        : {}),
    };
  }

  async preserveReceipts(): Promise<void> {
    const { run } = await this.tasks.run(this.execution.runId);
    const snapshot = await this.tasks.project(run.runId);
    const name = `agent-context-${this.execution.id}.json`;
    await this.tasks.saveDraft(
      run.runId,
      name,
      JSON.stringify(
        {
          version: 1,
          baselineId: this.execution.baselineId,
          receipts: this.receipts,
        },
        null,
        2,
      ),
      snapshot.files.get(`tasks/${run.taskId}/working/${name}`)?.digest ?? null,
    );
  }

  private async track(paths: string[]): Promise<void> {
    const { run } = await this.tasks.run(this.execution.runId);
    const snapshot = await this.tasks.project(run.runId);
    const taskPath = `tasks/${run.taskId}/task.yaml`;
    const task = rawObject<Task>(snapshot.files, taskPath);
    paths.push(
      taskPath,
      `tasks/${run.taskId}/checkpoints/${task.latest_checkpoint}.yaml`,
      `tasks/${run.taskId}/checkpoints/${task.latest_checkpoint}-inputs.yaml`,
    );
    for (const path of paths) {
      const digest = snapshot.files.get(path)?.digest;
      if (digest) this.managedFiles.set(path, digest);
    }
  }

  private async invoke(
    name: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    await this.assertManaged();
    const valid = validators.get(name);
    if (!valid || !valid(input))
      throw fileFailure(
        "REQUEST_INVALID",
        "Unsupported knowledge tool arguments",
        "project.yaml",
      );
    const selectedView = input["view"] === "basis" ? "basis" : "working";
    switch (name) {
      case "knowledge.search":
        return this.query(
          "search",
          { text: input["text"], limit: input["limit"] ?? 20 },
          selectedView,
        );
      case "entity.get":
        return this.query(
          "exact",
          { entityId: input["entityId"], revisionId: input["revisionId"] },
          selectedView,
        );
      case "references.reverse":
        return this.query(
          "reverse",
          {
            entityId: input["entityId"],
            revisionId: input["revisionId"],
            maxDepth: 8,
            maxResults: 100,
          },
          selectedView,
        );
      case "project.validate":
        return this.query("analyze", {}, selectedView);
      case "context.build": {
        const source = this.execution.source;
        const context = await this.query(
          source ? "exact" : "catalog",
          source
            ? { entityId: source.entityId, revisionId: source.revisionId }
            : {},
          selectedView,
        );
        const snapshot = await this.tasks.project(this.execution.runId);
        if (
          selectedView === "working" &&
          snapshot.fingerprint !== context.workingFingerprint
        )
          throw fileFailure(
            "SOURCE_CHANGED",
            "Context changed before publication",
            "project.yaml",
          );
        const { run } = await this.tasks.run(this.execution.runId);
        return {
          context,
          workingFingerprint: snapshot.fingerprint,
          baselineId: this.execution.baselineId,
          source,
          draft:
            snapshot.files.get(`tasks/${run.taskId}/working/ui-draft.md`)
              ?.text ?? "",
        };
      }
      case "task.checkpoint": {
        await this.preserveReceipts();
        const run = await this.tasks.checkpoint(
          this.execution.runId,
          "active",
          input["summary"] as string,
          "running",
          this.execution.provider,
        );
        await this.track([]);
        return { checkpointId: run.checkpointId, commit: run.headCommit };
      }
      case "changes.propose": {
        const snapshot = await this.tasks.project(this.execution.runId);
        const source = this.execution.source;
        const parent = source
          ? snapshot.entities
              .get(source.entityId)
              ?.revisions.get(source.revisionId)?.meta
          : undefined;
        const command = {
          type: "revision" as const,
          value: {
            ...(source
              ? { entityId: source.entityId, parentRevision: source.revisionId }
              : { kind: "document" }),
            title: input["title"] as string,
            body: input["body"] as string,
            status: "draft" as const,
            select: false,
            baselineId: this.execution.baselineId,
            references: (input["references"] ??
              parent?.references ??
              []) as Revision["references"],
            extensions: (input["extensions"] ??
              parent?.extensions ??
              {}) as Revision["extensions"],
            scope: (input["scope"] ?? parent?.scope ?? {}) as Revision["scope"],
            tags: (input["tags"] ?? parent?.tags ?? []) as string[],
          },
        };
        const result = await new ManualService(this.appData).executeAgent(
          this.execution.runId,
          input["expectedSnapshot"] as string,
          input["requestId"] as string,
          command,
          this.execution.provider,
        );
        const { run } = await this.tasks.run(this.execution.runId);
        await this.track([
          `entities/${result.entityId}/entity.yaml`,
          `entities/${result.entityId}/revisions/${result.revisionId}/meta.yaml`,
          `entities/${result.entityId}/revisions/${result.revisionId}/content.md`,
          `tasks/${run.taskId}/proposals/${result.proposalId}.yaml`,
          `tasks/${run.taskId}/working/ui-operation-${input["requestId"]}.json`,
        ]);
        return result;
      }
      default:
        throw fileFailure(
          "REQUEST_INVALID",
          "Unknown knowledge tool",
          "project.yaml",
        );
    }
  }

  async close(): Promise<void> {
    await this.tail.catch(() => {});
    await Promise.all([...this.indexes.values()].map((index) => index.close()));
  }
}
