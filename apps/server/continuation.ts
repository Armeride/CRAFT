import type { FastifyInstance } from "fastify";
import { AgentError } from "../../packages/agent-core/src/contracts.js";
import { ExternalProfiles } from "../../packages/agent-core/src/external.js";
import type { ExternalProfile } from "../../packages/agent-core/src/phase7-contracts.js";
import { listSkills } from "../../packages/agent-core/src/skills.js";
import { validateManagedImage } from "../../packages/project-fs/src/images.js";
import { readSource } from "../../packages/project-fs/src/files.js";
import { getRegistration } from "../../packages/tasks/src/projects.js";
import type { TaskService } from "../../packages/tasks/src/service.js";
import { resumeContext } from "../../packages/tasks/src/resume-context.js";
import { readResumeNotes } from "../../packages/tasks/src/resume-contracts.js";
import type { ResumeNotes } from "../../packages/tasks/src/resume-contracts.js";

const params = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: { id: { type: "string", pattern: "^run_[a-f0-9-]+$" } },
};
const notesFields = {
  type: "array",
  maxItems: 30,
  items: { type: "string", maxLength: 1500 },
};
const digest = {
  anyOf: [{ type: "string", pattern: "^[a-f0-9]{64}$" }, { type: "null" }],
};
const string = (maxLength: number) => ({
  type: "string",
  minLength: 1,
  maxLength,
});

interface Options {
  appData: string;
  tasks: TaskService;
  authorize: (id: string) => void;
  changed?: (
    registration: string,
    type: string,
    runId: string,
  ) => Promise<void>;
}

export function registerContinuationRoutes(
  app: FastifyInstance,
  options: Options,
) {
  const profiles = new ExternalProfiles(options.appData);
  const tasks = options.tasks;
  async function authorize(runId: string) {
    const { run } = await tasks.run(runId);
    options.authorize(run.registrationId);
    return run;
  }

  app.get<{ Params: { id: string } }>(
    "/api/runs/:id/continuation",
    { schema: { params } },
    async (request) => {
      const run = await authorize(request.params.id);
      return resumeContext(tasks, run.runId);
    },
  );

  app.put<{
    Params: { id: string };
    Body: ResumeNotes & { expectedDigest: string | null };
  }>(
    "/api/runs/:id/continuation",
    {
      schema: {
        params,
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "decisions",
            "openQuestions",
            "nextActions",
            "expectedDigest",
          ],
          properties: {
            decisions: notesFields,
            openQuestions: notesFields,
            nextActions: notesFields,
            expectedDigest: digest,
          },
        },
      },
    },
    async (request) => {
      const run = await authorize(request.params.id);
      return tasks.withExecution(run.runId, async () => {
        const notes = readResumeNotes(request.body);
        await tasks.saveDraft(
          run.runId,
          "resume-notes.json",
          JSON.stringify(notes),
          request.body.expectedDigest,
        );
        await tasks.checkpoint(
          run.runId,
          "paused",
          "Continuation notes preserved.",
        );
        await options.changed?.(run.registrationId, "task.changed", run.runId);
        return resumeContext(tasks, run.runId);
      });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/runs/:id/skills",
    { schema: { params } },
    async (request) => {
      const run = await authorize(request.params.id);
      return listSkills(options.appData, await tasks.project(run.runId));
    },
  );

  const imageParams = {
    type: "object",
    additionalProperties: false,
    required: ["id", "digest"],
    properties: {
      id: { type: "string", pattern: "^(?:run|reg)_[a-f0-9-]+$" },
      digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
    },
  };
  async function image(root: string, pin: string) {
    const file = await readSource(root, `assets/craft/${pin}.png`);
    if (file.digest !== pin) throw new AgentError("ASSET_INVALID");
    validateManagedImage(Buffer.from(file.contentBase64, "base64"));
    return { base64: file.contentBase64 };
  }
  app.get<{ Params: { id: string; digest: string } }>(
    "/api/runs/:id/images/:digest",
    { schema: { params: imageParams } },
    async (request) => {
      const run = await authorize(request.params.id);
      return image(run.path, request.params.digest);
    },
  );
  app.get<{ Params: { id: string; digest: string } }>(
    "/api/projects/:id/images/:digest",
    { schema: { params: imageParams } },
    async (request) => {
      options.authorize(request.params.id);
      const registration = await getRegistration(
        options.appData,
        request.params.id,
      );
      return image(registration.root, request.params.digest);
    },
  );
  app.post<{
    Params: { id: string };
    Body: { base64: string; alt: string; expectedDigest: string | null };
  }>(
    "/api/runs/:id/images",
    {
      schema: {
        params,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["base64", "alt", "expectedDigest"],
          properties: {
            base64: string(349528),
            alt: string(200),
            expectedDigest: digest,
          },
        },
      },
    },
    async (request) => {
      const run = await authorize(request.params.id);
      const result = await tasks.attachImage(
        run.runId,
        request.body.base64,
        request.body.alt,
        request.body.expectedDigest,
      );
      await options.changed?.(run.registrationId, "task.changed", run.runId);
      return result;
    },
  );

  app.get("/api/mcp-profiles", () => profiles.list());
  app.post<{ Body: ExternalProfile }>(
    "/api/mcp-profiles",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["id", "label", "endpoint", "tools"],
          properties: {
            id: string(48),
            label: string(120),
            endpoint: string(2048),
            credentialRef: string(110),
            jobStatusTool: string(128),
            tools: {
              type: "array",
              minItems: 1,
              maxItems: 30,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "effect"],
                properties: {
                  name: string(128),
                  effect: { enum: ["read", "write"] },
                },
              },
            },
          },
        },
      },
    },
    async (request) => {
      if (!request.body.endpoint.trim())
        throw new AgentError("EXTERNAL_PROFILE_INVALID");
      return profiles.save(request.body);
    },
  );
}
