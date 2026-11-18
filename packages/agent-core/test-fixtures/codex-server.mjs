// Sanitized protocol shapes from codex-cli 0.169.0-alpha.11.1.
// This is a model-free native process, not a replacement product runner.
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const mode = process.argv[2];
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const reply = (id, result) => send({ id, result });
const notify = (method, params) => send({ method, params });
if (mode === "tree") {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    windowsHide: true,
    stdio: "ignore",
  });
  writeFileSync(process.argv[3], String(child.pid));
  setInterval(() => {}, 1000);
}
const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    reply(message.id, { userAgent: "sanitized-fixture" });
    continue;
  }
  if (message.method === "config/read") {
    reply(message.id, { config: { mcp_servers: { external: {} } } });
    continue;
  }
  if (message.method === "thread/start") {
    if (
      message.params.config.mcp_servers.external.enabled !== false ||
      message.params.sandbox !== "read-only"
    )
      throw Error("Run overlay missing");
    reply(message.id, { thread: { id: "thread_fixture" } });
    continue;
  }
  if (message.method === "turn/start") {
    if (mode === "malformed") {
      process.stdout.write("not a protocol frame\n");
      continue;
    }
    reply(message.id, { turn: { id: "turn_fixture" } });
    notify("turn/started", { turn: { id: "turn_fixture" } });
    if (mode === "cancel") continue;
    // Split a Korean UTF-8 code point across native stdout chunks.
    const text = Buffer.from(
      JSON.stringify({
        method: "item/agentMessage/delta",
        params: { delta: "국경 초안" },
      }) + "\n",
    );
    const split = text.indexOf(Buffer.from("국")) + 1;
    process.stdout.write(text.subarray(0, split));
    await new Promise((resolve) => setTimeout(resolve, 15));
    process.stdout.write(text.subarray(split));
    send({
      id: "question_fixture",
      method: "item/tool/requestUserInput",
      params: {
        questions: [
          {
            id: "focus",
            question: "Choose focus",
            options: [{ label: "Story" }],
          },
        ],
      },
    });
    continue;
  }
  if (message.id === "question_fixture") {
    if (message.result?.answers?.focus?.answers?.[0] !== "Story")
      throw Error("Answer missing");
    send({
      id: "approval_fixture",
      method: "item/commandExecution/requestApproval",
      params: { command: "sanitized command" },
    });
    continue;
  }
  if (message.id === "approval_fixture") {
    if (message.result?.decision !== "decline") throw Error("Decline missing");
    notify("thread/tokenUsage/updated", {
      tokenUsage: { total: { inputTokens: 10, outputTokens: 3 } },
    });
    notify("turn/completed", {
      turn: { id: "turn_fixture", status: "completed" },
    });
    continue;
  }
  if (message.method === "turn/interrupt") {
    reply(message.id, {});
    notify("turn/completed", {
      turn: { id: "turn_fixture", status: "interrupted" },
    });
  }
}
