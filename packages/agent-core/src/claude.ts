import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  query,
  type CanUseTool,
  type SpawnedProcess,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  AgentError,
  type AgentAdapter,
  type AdapterContext,
  type AgentQuestion,
} from "./contracts.js";
import { knowledgeTools, povKnowledgeTools } from "./knowledge.js";
import { externalTools } from './external.js';
import { resolveProgram, terminateTree } from "./process.js";

export async function consumeClaudeStream(
  stream: AsyncIterable<SDKMessage>,
  context: AdapterContext,
): Promise<void> {
  let hasText = false,
    succeeded = false,
    currentMessage = "",
    session = "";
  const streamed = new Set<string>();
  for await (const message of stream) {
    if (
      "session_id" in message &&
      typeof message.session_id === "string" &&
      session !== message.session_id
    ) {
      session = message.session_id;
      await context.session(session);
    }
    if (message.type === "stream_event") {
      const event = message.event;
      if (event.type === "message_start") currentMessage = event.message.id;
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        streamed.add(currentMessage);
        hasText = true;
        await context.emit({ type: "message.delta", text: event.delta.text });
      }
    }
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text" && !streamed.has(message.message.id)) {
          hasText = true;
          await context.emit({ type: "message.delta", text: block.text });
        }
        if (block.type === "tool_use" && !block.name.startsWith("mcp__craft__"))
          await context.emit({ type: "tool.started", tool: block.name });
      }
    }
    if (message.type === "tool_progress" && !message.tool_name.startsWith("mcp__craft__"))
      await context.emit({ type: "tool.started", tool: message.tool_name });
    if (message.type === "result") {
      if (message.subtype !== "success" || message.is_error)
        throw new AgentError("AGENT_PROVIDER_FAILED", {
          subtype: message.subtype,
          errors:
            message.subtype !== "success" ? message.errors : [message.result],
        });
      if (message.permission_denials.length)
        throw new AgentError("AGENT_PERMISSION_REQUIRED");
      if (!hasText && message.result)
        await context.emit({ type: "message.delta", text: message.result });
      await context.emit({
        type: "usage.updated",
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        },
      });
      succeeded = true;
    }
  }
  if (!succeeded) throw new AgentError("AGENT_PROTOCOL_INVALID");
}

export function claudePermissionHandler(context: AdapterContext): CanUseTool {
  return async (name, input, options) => {
    if (name === "AskUserQuestion" && context.profile !== 'pov') {
      const source = Array.isArray(input["questions"])
        ? (input["questions"] as Record<string, unknown>[])
        : [];
      const questions: AgentQuestion[] = source.map((question, index) => ({
        id: String(index),
        question: String(question["question"] ?? ""),
        multiple: question["multiSelect"] === true,
        options: Array.isArray(question["options"])
          ? question["options"].map((option) =>
              String((option as { label?: string }).label ?? ""),
            )
          : [],
      }));
      const answer = await context.ask({
        kind: "question",
        title: name,
        details: "",
        questions,
      });
      if (!answer.allow)
        return {
          behavior: "deny",
          message: "User declined the question",
          toolUseID: options.toolUseID,
        };
      return {
        behavior: "allow",
        updatedInput: {
          ...input,
          answers: Object.fromEntries(
            questions.map((question) => [
              question.question,
              (answer.answers?.[question.id] ?? []).join(", "),
            ]),
          ),
        },
        toolUseID: options.toolUseID,
      };
    }
    const ownTool = (context.profile === 'pov' ? povKnowledgeTools : [...knowledgeTools, ...externalTools]).some(
      (tool) =>
        name === "mcp__craft__" + tool.name ||
        name === "mcp__craft__" + tool.name.replaceAll(".", "_"),
    );
    const askOnly =
      "serverPolicyAskOnly" in options && options.serverPolicyAskOnly === true;
    if (
      ownTool &&
      !askOnly &&
      (!options.mcpServer ||
        (options.mcpServer.name === "craft" &&
          options.mcpServer.source === "dynamic"))
    )
      return {
        behavior: "allow",
        updatedInput: input,
        toolUseID: options.toolUseID,
      };
    if (context.profile === 'pov') return { behavior: 'deny', message: 'Only filtered CRAFT knowledge tools are available', toolUseID: options.toolUseID };
    const answer = await context.ask({
      kind: "approval",
      title: name,
      details: JSON.stringify(input),
      questions: [],
    });
    return answer.allow
      ? { behavior: "allow", updatedInput: input, toolUseID: options.toolUseID }
      : {
          behavior: "deny",
          message: "User declined this tool",
          toolUseID: options.toolUseID,
        };
  };
}

export class ClaudeAdapter implements AgentAdapter {
  async execute(context: AdapterContext): Promise<void> {
    if (!context.installation.path) throw new AgentError("AGENT_NOT_INSTALLED");
    const program = await resolveProgram(context.installation.path, "claude");
    const abort = new AbortController();
    const children = new Set<ChildProcessWithoutNullStreams>();
    const stopTimers = new Set<ReturnType<typeof setTimeout>>();
    let stderr = "";
    const aborted = () => abort.abort();
    context.signal.addEventListener("abort", aborted, { once: true });
    if (context.signal.aborted) abort.abort();
    const stream = query({
      prompt: context.prompt,
      options: {
        cwd: context.cwd,
        pathToClaudeCodeExecutable: program.args[0] ?? program.command,
        abortController: abort,
        settingSources: [],
        strictMcpConfig: true,
        mcpServersDelivery: "argv",
        mcpServers: {
          craft: {
            type: "http",
            url: context.mcp.url,
            headers: { Authorization: "Bearer ${CRAFT_MCP_TOKEN}" },
          },
        },
        tools: context.profile === 'pov' ? [] : ["AskUserQuestion"],
        ...(context.profile === 'pov' ? { plugins: [], skills: [], disallowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob', 'Agent', 'Task', 'WebFetch', 'WebSearch', 'Skill', 'ToolSearch', 'AskUserQuestion'] } : {}),
        permissionMode: "default",
        permissionPrompts: "host",
        canUseTool: claudePermissionHandler(context),
        includePartialMessages: true,
        persistSession: false,
        extraArgs: { restricted: null },
        ...(context.model ? { model: context.model } : {}),
        spawnClaudeCodeProcess: (options) => {
          if (options.args.some((arg) => arg.includes(context.mcp.token)))
            throw new AgentError(
              "AGENT_PROVIDER_FAILED",
              "MCP credentials must not appear in process arguments",
            );
          const child = spawn(options.command, options.args, {
            cwd: options.cwd ?? context.cwd,
            env: { ...options.env, CRAFT_MCP_TOKEN: context.mcp.token },
            shell: false,
            windowsHide: true,
            stdio: ["pipe", "pipe", "pipe"],
          });
          children.add(child);
          child.stderr.setEncoding("utf8");
          child.stderr.on("data", (chunk: string) => {
            stderr = (stderr + chunk).slice(-16000);
          });
          child.once("close", () => children.delete(child));
          const proxy: SpawnedProcess = {
            stdin: child.stdin,
            stdout: child.stdout,
            get killed() {
              return child.killed;
            },
            get exitCode() {
              return child.exitCode;
            },
            get signalCode() {
              return child.signalCode;
            },
            kill: () => {
              child.stdin.end();
              const timer = setTimeout(() => {
                stopTimers.delete(timer);
                void terminateTree(child).catch(() => {});
              }, 1500);
              stopTimers.add(timer);
              return true;
            },
            on: child.on.bind(child),
            once: child.once.bind(child),
            off: child.off.bind(child),
          };
          return proxy;
        },
      },
    });
    try {
      await consumeClaudeStream(stream, context);
    } catch (error) {
      const details = JSON.stringify({
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof AgentError ? { result: error.details } : {}),
        stderr,
      }).replaceAll(context.mcp.token, "[redacted]");
      throw new AgentError(
        error instanceof AgentError ? error.code : "AGENT_PROVIDER_FAILED",
        JSON.parse(details),
      );
    } finally {
      context.signal.removeEventListener("abort", aborted);
      stream.close();
      for (const timer of stopTimers) clearTimeout(timer);
      await Promise.all([...children].map((child) => terminateTree(child)));
    }
  }
}
