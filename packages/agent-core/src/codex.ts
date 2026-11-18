import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
  AgentError,
  type AgentAdapter,
  type AdapterContext,
  type AgentQuestion,
} from "./contracts.js";
import {
  resolveProgram,
  spawnProgram,
  terminateTree,
  type Program,
} from "./process.js";

type RpcMessage = {
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
};

export class CodexConnection {
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private closed = false;
  private failure: Error | undefined;
  private closing: Promise<void> | undefined;

  constructor(
    program: Program,
    cwd: string,
    token: string,
    notification: (message: RpcMessage) => Promise<void>,
    failed: (error: Error) => void,
  ) {
    this.child = spawnProgram(
      program,
      [
        "app-server",
        "--stdio",
        ...[
          "hooks",
          "apps",
          "plugins",
          "remote_plugin",
          "multi_agent",
          "multi_agent_v2",
        ].flatMap((name) => ["-c", `features.${name}=false`]),
      ],
      cwd,
      {
        CRAFT_MCP_TOKEN: token,
      },
    );
    const fatal = (error: Error) => {
      if (this.failure) return;
      this.failure = error;
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(error);
      }
      this.pending.clear();
      failed(error);
      void this.close().catch(failed);
    };
    this.child.stderr.resume();
    this.child.stdin.on("error", () =>
      fatal(new AgentError("AGENT_PIPE_FAILED")),
    );
    this.child.on("error", () => fatal(new AgentError("AGENT_SPAWN_FAILED")));
    this.child.on("close", () => {
      this.closed = true;
      fatal(new AgentError("AGENT_CONNECTION_LOST"));
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      if (Buffer.byteLength(this.buffer) > 4 * 1024 * 1024) {
        fatal(new AgentError("AGENT_OUTPUT_LIMIT"));
        return;
      }
      let boundary: number;
      while ((boundary = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, boundary).trim();
        this.buffer = this.buffer.slice(boundary + 1);
        if (!line) continue;
        try {
          const message = JSON.parse(line) as RpcMessage;
          if (!message || typeof message !== "object")
            throw Error("Invalid frame");
          if (typeof message.id === "number" && !message.method) {
            const entry = this.pending.get(message.id);
            if (entry) {
              clearTimeout(entry.timer);
              this.pending.delete(message.id);
              if (message.error)
                entry.reject(
                  new AgentError("AGENT_REQUEST_REJECTED", message.error),
                );
              else entry.resolve(message.result);
            }
          } else void notification(message).catch(fatal);
        } catch {
          fatal(new AgentError("AGENT_PROTOCOL_INVALID"));
        }
      }
    });
  }

  send(message: RpcMessage): void {
    if (this.failure) throw this.failure;
    if (this.closed) throw new AgentError("AGENT_CONNECTION_LOST");
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }

  request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AgentError("AGENT_PROTOCOL_TIMEOUT"));
      }, 90000);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async close(): Promise<void> {
    this.closing ??= this.stop();
    return this.closing;
  }

  private async stop(): Promise<void> {
    if (!this.closed) this.child.stdin.end();
    if (!this.closed)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1500);
        this.child.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    await terminateTree(this.child);
  }
}

function questions(value: unknown): AgentQuestion[] {
  if (!Array.isArray(value)) return [];
  return value.map(
    (item: {
      id?: string;
      question?: string;
      options?: { label?: string }[];
    }) => ({
      id: String(item.id ?? ""),
      question: String(item.question ?? ""),
      options: item.options?.map((option) => String(option.label ?? "")) ?? [],
      multiple: false,
    }),
  );
}

// config/read includes null-valued optional fields. The thread config override
// converts JSON to TOML, where null has no representation.
export function disabledMcpServers(
  servers: Record<string, unknown>,
): Record<string, unknown> {
  const withoutNull = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(withoutNull)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([, item]) => item !== null && item !== undefined)
              .map(([key, item]) => [key, withoutNull(item)]),
          )
        : value;
  return Object.fromEntries(
    Object.entries(servers).map(([name, value]) => [
      name,
      { ...(withoutNull(value) as Record<string, unknown>), enabled: false },
    ]),
  );
}

export class CodexAdapter implements AgentAdapter {
  constructor(private readonly programOverride?: Program) {}

  async execute(context: AdapterContext): Promise<void> {
    if (context.signal.aborted) throw new AgentError("AGENT_CANCELLED");
    if (!context.installation.path) throw new AgentError("AGENT_NOT_INSTALLED");
    const program =
      this.programOverride ??
      (await resolveProgram(context.installation.path, "codex"));
    let threadId = "",
      turnId = "",
      completed = false;
    let finish!: () => void, fail!: (error: Error) => void;
    const done = new Promise<void>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    // A process may fail during initialize, before the completion promise is awaited.
    void done.catch(() => {});
    const connection = new CodexConnection(
      program,
      context.cwd,
      context.mcp.token,
      async (message) => {
        const params = message.params ?? {};
        if (message.id !== undefined && message.method) {
          const isQuestion = [
            "item/tool/requestUserInput",
            "tool/requestUserInput",
          ].includes(message.method);
          const supported =
            isQuestion ||
            [
              "item/commandExecution/requestApproval",
              "item/fileChange/requestApproval",
              "item/permissions/requestApproval",
            ].includes(message.method);
          if (!supported) {
            await context.emit({
              type: "tool.completed",
              tool: message.method,
              code: "AGENT_HOST_REQUEST_UNSUPPORTED",
            });
            connection.send({
              id: message.id,
              error: { code: -32601, message: "Unsupported host request" },
            });
            return;
          }
          const answer = await context.ask({
            kind: isQuestion ? "question" : "approval",
            title: message.method,
            details: JSON.stringify(params),
            questions: questions(params["questions"]),
          });
          let result: unknown = {
            decision: answer.allow ? "accept" : "decline",
          };
          if (isQuestion)
            result = {
              answers: Object.fromEntries(
                questions(params["questions"]).map((question) => [
                  question.id,
                  { answers: answer.answers?.[question.id] ?? [] },
                ]),
              ),
            };
          if (message.method === "item/permissions/requestApproval")
            result = {
              permissions: answer.allow ? (params["permissions"] ?? {}) : {},
              scope: "turn",
            };
          connection.send({ id: message.id, result });
          return;
        }
        if (
          message.method === "item/agentMessage/delta" &&
          typeof params["delta"] === "string"
        )
          await context.emit({ type: "message.delta", text: params["delta"] });
        if (
          message.method === "item/started" ||
          message.method === "item/completed"
        ) {
          const item = params["item"] as
            | {
                type?: string;
                name?: string;
                tool?: string;
                error?: unknown;
                result?: { isError?: boolean; content?: unknown };
              }
            | undefined;
          if (
            item?.type === "mcpToolCall" ||
            item?.type === "commandExecution" ||
            item?.type === "fileChange"
          )
            await context.emit({
              type:
                message.method === "item/started"
                  ? "tool.started"
                  : "tool.completed",
              tool: item.tool ?? item.name ?? item.type,
              ...(message.method === "item/completed" &&
              (item.error || item.result?.isError)
                ? {
                    code: "AGENT_TOOL_FAILED",
                    text: JSON.stringify(item.error ?? item.result?.content),
                  }
                : {}),
            });
        }
        if (message.method === "thread/tokenUsage/updated") {
          const usage = params["tokenUsage"] as
            { total?: Record<string, number> } | undefined;
          if (usage?.total)
            await context.emit({
              type: "usage.updated",
              usage: Object.fromEntries(
                Object.entries(usage.total).filter(
                  ([, value]) =>
                    typeof value === "number" && Number.isFinite(value),
                ),
              ),
            });
        }
        if (message.method === "turn/started")
          turnId = String(
            (params["turn"] as { id?: string } | undefined)?.id ?? turnId,
          );
        if (message.method === "turn/completed") {
          const turn = params["turn"] as { status?: string } | undefined;
          completed = true;
          if (turn?.status === "completed") finish();
          else
            fail(
              new AgentError(
                turn?.status === "interrupted"
                  ? "AGENT_CANCELLED"
                  : "AGENT_PROVIDER_FAILED",
              ),
            );
        }
      },
      (error) => {
        if (!completed) fail(error);
      },
    );
    const aborted = () => {
      if (threadId && turnId)
        void connection
          .request("turn/interrupt", { threadId, turnId })
          .catch(() => {});
      fail(new AgentError("AGENT_CANCELLED"));
      void connection.close().catch(fail);
    };
    context.signal.addEventListener("abort", aborted, { once: true });
    try {
      await connection.request("initialize", {
        clientInfo: { name: "craft", title: "CRAFT", version: "0.0.0" },
        capabilities: { experimentalApi: true },
      });
      connection.send({ method: "initialized" });
      const configuration = await connection.request<{
        config?: { mcp_servers?: Record<string, unknown> };
      }>("config/read", { includeLayers: false, cwd: context.cwd });
      const config: Record<string, unknown> = {
        "features.multi_agent": false,
        "features.multi_agent_v2": false,
        "features.hooks": false,
        "features.apps": false,
        "features.plugins": false,
        "features.remote_plugin": false,
      };
      config["mcp_servers"] = {
        ...disabledMcpServers(configuration.config?.mcp_servers ?? {}),
        craft: {
          url: context.mcp.url,
          bearer_token_env_var: "CRAFT_MCP_TOKEN",
          enabled: true,
          required: true,
        },
      };
      const thread = await connection.request<{ thread: { id: string } }>(
        "thread/start",
        {
          cwd: context.cwd,
          sandbox: "read-only",
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          ephemeral: true,
          config,
          ...(context.model ? { model: context.model } : {}),
        },
      );
      if (!thread.thread?.id) throw new AgentError("AGENT_PROTOCOL_INVALID");
      threadId = thread.thread.id;
      await context.session(threadId);
      if (context.signal.aborted) throw new AgentError("AGENT_CANCELLED");
      const turn = await connection.request<{ turn: { id: string } }>(
        "turn/start",
        { threadId, input: [{ type: "text", text: context.prompt }] },
      );
      turnId = turn.turn?.id ?? turnId;
      if (!turnId) throw new AgentError("AGENT_PROTOCOL_INVALID");
      await done;
    } finally {
      context.signal.removeEventListener("abort", aborted);
      await connection.close();
    }
  }
}
