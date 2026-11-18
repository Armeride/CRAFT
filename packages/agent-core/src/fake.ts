import { randomUUID } from "node:crypto";
import type { AgentAdapter, AdapterContext } from "./contracts.js";
import { AgentError } from "./contracts.js";
import { pause } from "./process.js";

export class FakeAdapter implements AgentAdapter {
  constructor(
    readonly options: { ask?: boolean; delayMs?: number; fail?: boolean } = {},
  ) {}

  async execute(context: AdapterContext): Promise<void> {
    await context.session("fake-" + randomUUID());
    if (this.options.ask) {
      const answer = await context.ask({
        kind: "question",
        title: "Fixture question",
        details: "",
        questions: [
          {
            id: "focus",
            question: "Choose a focus",
            options: ["Rules", "Story"],
            multiple: false,
          },
        ],
      });
      if (!answer.allow) throw new AgentError("AGENT_PERMISSION_REQUIRED");
      const approval = await context.ask({
        kind: "approval",
        title: "Fixture draft creation",
        details: "Create an unselected draft proposal in this task.",
        questions: [],
      });
      if (!approval.allow) throw new AgentError("AGENT_PERMISSION_REQUIRED");
    }
    await pause(this.options.delayMs ?? 100, context.signal);
    const built = (await context.tool("context.build", {})) as {
      context: { data: { meta?: { title?: string } } };
      workingFingerprint: string;
      draft: string;
    };
    const title = built.context.data.meta?.title ?? "CRAFT fixture draft";
    const body = (built.draft || "# " + title) + "\n\n" + context.userPrompt;
    for (const text of ["Local fixture: ", title]) {
      await context.emit({ type: "message.delta", text });
      await pause(20, context.signal);
    }
    if (this.options.fail) throw new AgentError("AGENT_PROVIDER_FAILED");
    await context.tool("changes.propose", {
      requestId: randomUUID(),
      expectedSnapshot: built.workingFingerprint,
      title,
      body,
    });
    await context.tool("project.validate", {});
  }
}
