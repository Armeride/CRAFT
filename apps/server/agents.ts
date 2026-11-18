import type { FastifyInstance } from "fastify";
import {
  AgentService,
  type AgentServiceOptions,
  type StartAgent,
} from "../../packages/agent-core/src/service.js";
import { knowledgeTools } from "../../packages/agent-core/src/knowledge.js";
import {
  AgentError,
  type AgentAnswer,
  type ProviderId,
} from "../../packages/agent-core/src/contracts.js";
import { detectAgent } from "../../packages/agent-core/src/detect.js";
import { TaskService } from "../../packages/tasks/src/service.js";
import { ValidationFailure } from "../../packages/domain/src/model.js";
import { HttpCommands } from "./commands.js";

interface Options extends AgentServiceOptions {
  appData: string;
  port: number;
  authorize: (registrationId: string) => void;
}

const providers = { enum: ["codex", "claude", "fake"] };
const uuid = { type: "string", pattern: "^[a-f0-9-]{36}$" };
const params = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string", pattern: "^(?:run|agent)_[a-f0-9-]{36}$" },
  },
};
const text = (maxLength: number) => ({
  type: "string",
  minLength: 1,
  maxLength,
});

export async function registerAgentRoutes(
  app: FastifyInstance,
  options: Options,
): Promise<AgentService> {
  const service = new AgentService(options.appData, options);
  const tasks = new TaskService(options.appData);
  const commands = new HttpCommands(options.appData);
  await service.initialize();
  async function authorizeRun(runId: string) {
    const { run } = await tasks.run(runId, false);
    options.authorize(run.registrationId);
  }
  async function authorizeExecution(id: string) {
    const record = await service.get(id);
    options.authorize(record.registrationId);
    return record;
  }

  app.get("/api/agents", async () =>
    Promise.all(
      (["codex", "claude", "fake"] as const).map((provider) =>
        detectAgent(provider, process.cwd()),
      ),
    ),
  );
  app.post<{ Body: { provider: ProviderId; path: string } }>(
    "/api/agents/probe",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["provider", "path"],
          properties: { provider: providers, path: text(4096) },
        },
      },
    },
    (request) =>
      detectAgent(request.body.provider, process.cwd(), request.body.path),
  );
  app.get<{ Params: { id: string } }>(
    "/api/runs/:id/agents",
    { schema: { params } },
    async (request) => {
      await authorizeRun(request.params.id);
      return service.list(request.params.id);
    },
  );
  app.post<{
    Params: { id: string };
    Body: Omit<StartAgent, "requestId"> & { requestId?: string };
  }>(
    "/api/runs/:id/agents",
    {
      schema: {
        params,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["provider", "prompt"],
          properties: {
            requestId: uuid,
            provider: providers,
            prompt: text(12000),
            path: text(4096),
            model: text(256),
          },
        },
      },
    },
    async (request) => {
      await authorizeRun(request.params.id);
      const requestId =
        request.body.requestId ?? request.headers["x-craft-request-id"];
      if (typeof requestId !== "string")
        throw new AgentError("REQUEST_INVALID");
      return service.start(
        request.params.id,
        { ...request.body, requestId },
        `http://127.0.0.1:${options.port}`,
      );
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/agent-executions/:id",
    { schema: { params } },
    (request) => authorizeExecution(request.params.id),
  );
  app.post<{ Params: { id: string } }>(
    "/api/agent-executions/:id/fork",
    {
      schema: { params, body: { type: "object", additionalProperties: false } },
    },
    async (request) => {
      await authorizeExecution(request.params.id);
      return commands.execute(
        request.headers["x-craft-request-id"],
        "agent-fork:" + request.params.id,
        {},
        () => service.fork(request.params.id),
      );
    },
  );
  app.post<{
    Params: { id: string };
    Body: { requestId: string; answer: AgentAnswer };
  }>(
    "/api/agent-executions/:id/respond",
    {
      schema: {
        params,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["requestId", "answer"],
          properties: {
            requestId: uuid,
            answer: {
              type: "object",
              additionalProperties: false,
              required: ["allow"],
              properties: {
                allow: { type: "boolean" },
                answers: {
                  type: "object",
                  maxProperties: 20,
                  additionalProperties: {
                    type: "array",
                    maxItems: 20,
                    items: { type: "string", maxLength: 4000 },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request) => {
      await authorizeExecution(request.params.id);
      await service.respond(
        request.params.id,
        request.body.requestId,
        request.body.answer,
      );
      return { accepted: true };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/agent-executions/:id/cancel",
    {
      schema: { params, body: { type: "object", additionalProperties: false } },
    },
    async (request) => {
      await authorizeExecution(request.params.id);
      await service.cancel(request.params.id);
      return { accepted: true };
    },
  );

  app.post<{
    Params: { id: string };
    Body: {
      jsonrpc?: string;
      id?: string | number;
      method: string;
      params?: Record<string, unknown>;
    };
  }>(
    "/mcp/:id",
    {
      schema: {
        params,
        body: {
          type: "object",
          required: ["jsonrpc", "method"],
          additionalProperties: false,
          properties: {
            jsonrpc: { const: "2.0" },
            id: { anyOf: [{ type: "string" }, { type: "integer" }] },
            method: text(256),
            params: { type: "object" },
          },
        },
      },
    },
    async (request, reply) => {
      service.authenticated(request.params.id, request.headers.authorization);
      const { id, method } = request.body;
      reply.header("Cache-Control", "no-store");
      if (id === undefined) return reply.code(202).send();
      if (method === "initialize")
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "craft", version: "0.0.0" },
          },
        };
      if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
      if (method === "tools/list")
        return { jsonrpc: "2.0", id, result: { tools: knowledgeTools } };
      if (method !== "tools/call")
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: "Unknown method" },
        };
      const args = request.body.params ?? {};
      try {
        if (
          typeof args["name"] !== "string" ||
          !args["arguments"] ||
          typeof args["arguments"] !== "object" ||
          Array.isArray(args["arguments"])
        )
          throw new AgentError("REQUEST_INVALID");
        const result = await service.callTool(
          request.params.id,
          args["name"],
          args["arguments"] as Record<string, unknown>,
        );
        return {
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(result) }] },
        };
      } catch (error) {
        const code =
          error instanceof ValidationFailure
            ? error.diagnostics[0]?.code
            : error instanceof AgentError
              ? error.code
              : "REQUEST_FAILED";
        return {
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [{ type: "text", text: JSON.stringify({ code }) }],
          },
        };
      }
    },
  );
  app.get("/mcp/:id", async (_request, reply) => reply.code(405).send());
  app.addHook("onClose", () => service.close());
  return service;
}
