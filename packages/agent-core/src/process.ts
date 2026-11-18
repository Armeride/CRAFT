import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { AgentError } from "./contracts.js";

export interface Program {
  command: string;
  args: string[];
}

export async function resolveProgram(
  path: string,
  provider: "codex" | "claude",
): Promise<Program> {
  const absolute = await realpath(path);
  if (/\.(?:cmd|ps1)$/i.test(absolute)) {
    const source = await readFile(absolute, "utf8");
    const suffix =
      provider === "codex"
        ? "@openai/codex/bin/codex.js"
        : "@anthropic-ai/claude-code/cli.js";
    if (!source.replaceAll("\\", "/").includes("node_modules/" + suffix))
      throw new AgentError("AGENT_SHIM_UNSUPPORTED");
    const script = join(
      dirname(absolute),
      "node_modules",
      ...suffix.split("/"),
    );
    await access(script);
    return { command: process.execPath, args: [script] };
  }
  return { command: absolute, args: [] };
}

export async function findProgram(
  provider: "codex" | "claude",
  custom?: string,
): Promise<string | null> {
  if (custom) {
    if (!isAbsolute(custom)) throw new AgentError("AGENT_PATH_INVALID");
    await resolveProgram(custom, provider);
    return realpath(custom);
  }
  const candidates =
    process.platform === "win32"
      ? [provider + ".exe", provider + ".cmd", provider + ".ps1"]
      : [provider];
  for (const directory of (process.env["PATH"] ?? "").split(
    process.platform === "win32" ? ";" : ":",
  )) {
    for (const candidate of candidates) {
      const path = join(directory, candidate);
      try {
        await access(path);
        await resolveProgram(path, provider);
        return realpath(path);
      } catch {}
    }
  }
  return null;
}

export async function capture(
  program: Program,
  args: string[],
  cwd: string,
  timeoutMs = 8000,
): Promise<{ code: number | null; text: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(program.command, [...program.args, ...args], {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let text = "";
    let stopping = false;
    const stop = (code: string) => {
      if (stopping) return;
      stopping = true;
      void terminateTree(child).then(
        () => reject(new AgentError(code)),
        reject,
      );
    };
    const timer = setTimeout(() => stop("AGENT_PROBE_TIMEOUT"), timeoutMs);
    const collect = (data: string) => {
      text += data;
      if (text.length > 256000) stop("AGENT_OUTPUT_LIMIT");
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (!stopping) resolve({ code, text });
    });
    child.stdin.end();
  });
}

export function spawnProgram(
  program: Program,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
): ChildProcessWithoutNullStreams {
  return spawn(program.command, [...program.args, ...args], {
    cwd,
    shell: false,
    windowsHide: true,
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export async function terminateTree(
  child: ChildProcessWithoutNullStreams,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid)
    return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn(
        "taskkill.exe",
        ["/PID", String(child.pid), "/T", "/F"],
        { shell: false, windowsHide: true, stdio: "ignore" },
      );
      killer.once("error", () => resolve());
      killer.once("close", () => resolve());
    });
  } else child.kill("SIGKILL");
  if (child.exitCode === null && child.signalCode === null) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.removeListener("close", done);
        resolve();
      }, 3000);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      child.once("close", done);
    });
  }
  if (child.exitCode === null && child.signalCode === null)
    throw new AgentError("AGENT_TERMINATION_UNCONFIRMED");
}

export function pause(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.reject(new AgentError("AGENT_CANCELLED"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", aborted);
      resolve();
    }, milliseconds);
    function aborted() {
      clearTimeout(timer);
      reject(new AgentError("AGENT_CANCELLED"));
    }
    signal.addEventListener("abort", aborted, { once: true });
  });
}
