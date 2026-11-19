import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { canonicalJson } from "../../domain/src/canonical.js";
import { gitText } from "../../git-workspace/src/git.js";
import { withKernelLock } from "../../git-workspace/src/locks.js";
import { assertOwnedPath } from "../../git-workspace/src/worktree.js";
import { hash } from "../../project-fs/src/files.js";
import { atomicText } from "../../workspace-runtime/src/state.js";
import { externalReceipts } from "../../tasks/src/external-records.js";
import type { ExternalReceipt } from "../../tasks/src/external-records.js";
import type { AgentAnswer, AgentRequest, ProviderId } from "./contracts.js";
import { AgentError } from "./contracts.js";
import type { ExternalProfile } from "./phase7-contracts.js";
import type { TaskService } from "../../tasks/src/service.js";

const profileId = /^[a-z][a-z0-9-]{0,47}$/;
const namePattern = /^[A-Za-z0-9_.-]{1,128}$/;
const secretPattern = /^env:(CRAFT_MCP_SECRET_[A-Z0-9_]{1,80})$/;
const maxResultBytes = 256 * 1024;
const operationPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const receiptName = (id: string) => `external-${id}.json`;

export function validateExternalProfile(
  profile: ExternalProfile,
): ExternalProfile {
  if (
    !profileId.test(profile.id) ||
    typeof profile.label !== "string" ||
    !profile.label.trim() ||
    profile.label.length > 120 ||
    !Array.isArray(profile.tools) ||
    !profile.tools.length ||
    profile.tools.length > 30 ||
    profile.tools.some(
      (tool) =>
        !namePattern.test(tool.name) ||
        !["read", "write"].includes(tool.effect),
    ) ||
    new Set(profile.tools.map((tool) => tool.name)).size !==
      profile.tools.length ||
    (profile.credentialRef && !secretPattern.test(profile.credentialRef)) ||
    (profile.jobStatusTool &&
      !profile.tools.some(
        (tool) => tool.name === profile.jobStatusTool && tool.effect === "read",
      ))
  )
    throw new AgentError("EXTERNAL_PROFILE_INVALID");
  let url: URL;
  try {
    url = new URL(profile.endpoint);
  } catch {
    throw new AgentError("EXTERNAL_PROFILE_INVALID");
  }
  const loopback =
    url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (!loopback && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new AgentError("EXTERNAL_PROFILE_INVALID");
  return {
    id: profile.id,
    label: profile.label.trim(),
    endpoint: url.href,
    tools: profile.tools,
    ...(profile.credentialRef ? { credentialRef: profile.credentialRef } : {}),
    ...(profile.jobStatusTool ? { jobStatusTool: profile.jobStatusTool } : {}),
  };
}

export class ExternalProfiles {
  constructor(private readonly appData: string) {}

  async get(id: string): Promise<ExternalProfile> {
    if (!profileId.test(id)) throw new AgentError("EXTERNAL_PROFILE_INVALID");
    const path = join(this.appData, "mcp-profiles", id + ".json");
    await assertOwnedPath(this.appData, path);
    const profile = validateExternalProfile(
      JSON.parse(await readFile(path, "utf8")) as ExternalProfile,
    );
    if (profile.id !== id) throw new AgentError("EXTERNAL_PROFILE_INVALID");
    return profile;
  }

  async save(profile: ExternalProfile): Promise<ExternalProfile> {
    const valid = validateExternalProfile(profile);
    await atomicText(
      this.appData,
      join(this.appData, "mcp-profiles", valid.id + ".json"),
      JSON.stringify(valid),
    );
    return valid;
  }

  async list(): Promise<ExternalProfile[]> {
    const path = join(this.appData, "mcp-profiles");
    await assertOwnedPath(this.appData, path);
    const entries = await readdir(path).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
        return [];
      },
    );
    return Promise.all(
      entries
        .filter(
          (name) => name.endsWith(".json") && profileId.test(name.slice(0, -5)),
        )
        .slice(0, 50)
        .sort()
        .map((name) => this.get(name.slice(0, -5))),
    );
  }
}

export const externalTools = [
  {
    name: "external.call",
    description:
      "Call an allowlisted external MCP tool. Writes require a fresh user approval. Consult external.status after an uncertain result.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["tool", "arguments"],
      properties: {
        tool: { type: "string", maxLength: 128 },
        arguments: { type: "object" },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "external.status",
    description:
      "List preserved operation IDs and job states, or refresh a known job by passing operationId when a job status tool is configured.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { operationId: { type: "string", maxLength: 36 } },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

function credential(profile: ExternalProfile): string {
  if (!profile.credentialRef) return "";
  const key = secretPattern.exec(profile.credentialRef)?.[1];
  const value = key ? process.env[key] : undefined;
  if (!value || /[\r\n]/.test(value))
    throw new AgentError("EXTERNAL_CREDENTIAL_MISSING");
  return value;
}

function maskResult(value: unknown, privateValue: string): unknown {
  if (typeof value === "string")
    return privateValue ? value.replaceAll(privateValue, "[redacted]") : value;
  if (Array.isArray(value))
    return value.map((item) => maskResult(item, privateValue));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        privateValue ? key.replaceAll(privateValue, "[redacted]") : key,
        maskResult(entry, privateValue),
      ]),
    );
  return value;
}

async function perform(
  profile: ExternalProfile,
  tool: string,
  args: Record<string, unknown>,
  token: string,
  signal: AbortSignal,
  operationId?: string,
) {
  const client = new Client({ name: "CRAFT managed tools", version: "1.0.0" });
  const headers = {
    ...(token ? { Authorization: "Bearer " + token } : {}),
    ...(operationId ? { "Idempotency-Key": operationId } : {}),
  };
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
  const transport = new StreamableHTTPClientTransport(
    new URL(profile.endpoint),
    {
      requestInit: { headers, redirect: "error" },
      fetch: async (url, init) => {
        const response = await fetch(url, {
          ...init,
          redirect: "error",
          signal: deadline,
        });
        if (!response.body) return response;
        let readBytes = 0;
        const bounded = response.body.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              readBytes += chunk.byteLength;
              if (readBytes > maxResultBytes)
                throw new AgentError("EXTERNAL_RESPONSE_LIMIT");
              controller.enqueue(chunk);
            },
          }),
        );
        return new Response(bounded, {
          status: response.status,
          headers: response.headers,
        });
      },
    },
  );
  try {
    await client.connect(transport);
    const reply = await client.callTool(
      {
        name: tool,
        arguments: args,
        ...(operationId
          ? { _meta: { "craft/idempotency_key": operationId } }
          : {}),
      },
      undefined,
      { signal: deadline, timeout: 20000 },
    );
    const body = maskResult(reply.structuredContent ?? reply.content, token);
    if (Buffer.byteLength(JSON.stringify(body)) > maxResultBytes)
      throw new AgentError("EXTERNAL_RESPONSE_LIMIT");
    const job =
      body && typeof body === "object"
        ? (body as Record<string, unknown>)["jobId"]
        : undefined;
    const jobId =
      typeof job === "string" && job.length <= 200 ? job : undefined;
    return {
      result: body,
      failed: reply.isError === true,
      ...(jobId ? { jobId } : {}),
    };
  } finally {
    await client.close();
  }
}

const visible = (record: ExternalReceipt): ExternalReceipt =>
  record.state === "pending" && !record.job_id
    ? { ...record, state: "external_state_unknown" }
    : record;

export class ManagedExternal {
  constructor(
    readonly profile: ExternalProfile,
    private readonly tasks: TaskService,
    private readonly runId: string,
    private readonly provider: ProviderId,
    private readonly ask: (
      request: Omit<AgentRequest, "id">,
    ) => Promise<AgentAnswer>,
    private readonly signal: AbortSignal,
  ) {}

  private async existing(
    operationId: string,
    file: string,
  ): Promise<ExternalReceipt | undefined> {
    const { run, registration } = await this.tasks.run(this.runId);
    const local = externalReceipts(
      await this.tasks.project(run.runId),
      run.taskId,
    ).find((item) => item.operation_id === operationId);
    const refs = (
      await gitText(registration.root, [
        "for-each-ref",
        "--format=%(objectname)",
        `refs/heads/workbench/task/${run.taskId}/`,
        `refs/remotes/*/workbench/task/${run.taskId}/run_*`,
      ])
    )
      .split(/\r?\n/)
      .filter((oid) => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid));
    let result = local;
    for (const oid of new Set(refs)) {
      const found = await gitText(registration.root, [
        "ls-tree",
        "-r",
        "--name-only",
        oid,
        "--",
        file,
      ]);
      if (found !== file) continue;
      const record = JSON.parse(
        await gitText(registration.root, ["show", oid + ":" + file]),
      ) as ExternalReceipt;
      if (
        record.operation_id !== operationId ||
        !["pending", "completed", "failed", "external_state_unknown"].includes(
          record.state,
        )
      )
        throw new AgentError("EXTERNAL_RECEIPT_INVALID");
      if (
        !result ||
        (["pending", "external_state_unknown"].includes(result.state) &&
          ["completed", "failed"].includes(record.state)) ||
        (result.state === "pending" &&
          !result.job_id &&
          record.state !== "pending")
      )
        result = record;
    }
    return result;
  }

  private connectionDigest(): string {
    return hash(
      canonicalJson({
        endpoint: this.profile.endpoint,
        credentialRef: this.profile.credentialRef ?? null,
      }),
    );
  }

  private async persist(record: ExternalReceipt, updated: () => Promise<void>) {
    const { run } = await this.tasks.run(this.runId);
    const file = receiptName(record.operation_id);
    const snapshot = await this.tasks.project(this.runId);
    const draft = snapshot.files.get(`tasks/${run.taskId}/working/${file}`);
    await this.tasks.saveDraft(
      this.runId,
      file,
      JSON.stringify(record),
      draft?.digest ?? null,
    );
    await this.tasks.checkpoint(
      this.runId,
      "active",
      "External operation receipt preserved.",
      "running",
      this.provider,
    );
    await updated();
  }

  private async operationLock<T>(
    operationId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const { run, registration } = await this.tasks.run(this.runId);
    const commonDir = await gitText(registration.root, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]);
    const lock = join(
      commonDir,
      "craft",
      "external",
      run.taskId,
      operationId + ".lock",
    );
    await assertOwnedPath(commonDir, lock);
    return withKernelLock(lock, "external:" + operationId, action);
  }

  private async refreshJob(
    record: ExternalReceipt,
    updated: () => Promise<void>,
  ) {
    if (
      !this.profile.jobStatusTool ||
      !record.job_id ||
      !["pending", "external_state_unknown"].includes(record.state)
    )
      return visible(record);
    return this.operationLock(record.operation_id, async () => {
      const { run } = await this.tasks.run(this.runId);
      const path = `tasks/${run.taskId}/working/${receiptName(record.operation_id)}`;
      const prior = (await this.existing(record.operation_id, path)) ?? record;
      if (!["pending", "external_state_unknown"].includes(prior.state))
        return prior;
      let response: Awaited<ReturnType<typeof perform>>;
      try {
        response = await perform(
          this.profile,
          this.profile.jobStatusTool!,
          { jobId: record.job_id },
          credential(this.profile),
          this.signal,
        );
      } catch (error) {
        if (error instanceof AgentError) throw error;
        throw new AgentError("EXTERNAL_CONNECTION_FAILED");
      }
      const result = response.result as Record<string, unknown> | undefined;
      const state = result?.["status"];
      if (
        response.failed ||
        (state !== "pending" && state !== "completed" && state !== "failed")
      )
        return visible(prior);
      const next: ExternalReceipt = {
        ...prior,
        state,
        result: response.result,
      };
      await this.persist(next, updated);
      return next;
    });
  }

  async call(
    name: string,
    input: Record<string, unknown>,
    updated: () => Promise<void>,
  ): Promise<unknown> {
    if (name === "external.status") {
      const id = input["operationId"];
      if (
        Object.keys(input).some((key) => key !== "operationId") ||
        (id !== undefined &&
          (typeof id !== "string" || !operationPattern.test(id)))
      )
        throw new AgentError("REQUEST_INVALID");
      const { run } = await this.tasks.run(this.runId);
      const records = externalReceipts(
        await this.tasks.project(run.runId),
        run.taskId,
      ).filter((record) => record.connectionDigest === this.connectionDigest());
      if (typeof id === "string") {
        const record = records.find((item) => item.operation_id === id);
        if (!record) throw new AgentError("EXTERNAL_RECEIPT_INVALID");
        return this.refreshJob(record, updated);
      }
      return records.map((record) => {
        const { result: _result, ...summary } = visible(record);
        return summary;
      });
    }
    if (
      Object.keys(input).some((key) => !["tool", "arguments"].includes(key)) ||
      typeof input["tool"] !== "string" ||
      !input["arguments"] ||
      typeof input["arguments"] !== "object" ||
      Array.isArray(input["arguments"])
    )
      throw new AgentError("REQUEST_INVALID");
    const tool = this.profile.tools.find(
      (candidate) => candidate.name === input["tool"],
    );
    if (!tool) throw new AgentError("EXTERNAL_TOOL_FORBIDDEN");
    const args = input["arguments"] as Record<string, unknown>;
    if (Buffer.byteLength(canonicalJson(args)) > 4000)
      throw new AgentError("REQUEST_INVALID");
    const token = credential(this.profile);
    if (tool.effect === "read") {
      try {
        return await perform(this.profile, tool.name, args, token, this.signal);
      } catch {
        throw new AgentError("EXTERNAL_CONNECTION_FAILED");
      }
    }
    const { run } = await this.tasks.run(this.runId);
    const connectionDigest = this.connectionDigest();
    const digest = hash(
      canonicalJson({
        taskId: run.taskId,
        connectionDigest,
        tool: tool.name,
        arguments: args,
      }),
    );
    const operationId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
    const file = receiptName(operationId);
    const relative = `tasks/${run.taskId}/working/${file}`;
    return this.operationLock(operationId, async () => {
      const previous = await this.existing(operationId, relative);
      if (previous) {
        if (previous.digest !== digest)
          throw new AgentError("EXTERNAL_RECEIPT_INVALID");
        return visible(previous);
      }
      const answer = await this.ask({
        kind: "approval",
        title: this.profile.label + " / " + tool.name,
        details: JSON.stringify(
          { endpoint: this.profile.endpoint, arguments: args },
          null,
          2,
        ),
        questions: [],
      });
      if (!answer.allow || this.signal.aborted)
        throw new AgentError("AGENT_PERMISSION_REQUIRED");
      const pending: ExternalReceipt = {
        operation_id: operationId,
        idempotency_key: operationId,
        profileId: this.profile.id,
        connectionDigest,
        tool: tool.name,
        digest,
        state: "pending",
      };
      await this.persist(pending, updated);
      let result: ExternalReceipt;
      try {
        const response = await perform(
          this.profile,
          tool.name,
          args,
          token,
          this.signal,
          operationId,
        );
        result = {
          ...pending,
          result: response.result,
          state: response.failed
            ? "external_state_unknown"
            : response.jobId
              ? "pending"
              : "completed",
          ...(response.jobId ? { job_id: response.jobId } : {}),
        };
      } catch {
        result = { ...pending, state: "external_state_unknown" };
      }
      await this.persist(result, updated);
      return result;
    });
  }
}
