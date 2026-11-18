import { capture, findProgram, resolveProgram } from "./process.js";
import { AgentError } from "./contracts.js";
import type {
  AgentCapabilities,
  AgentInstallation,
  ProviderId,
} from "./contracts.js";

export const capabilities: AgentCapabilities = {
  streaming: true,
  interruption: true,
  interactiveApproval: true,
  userQuestions: true,
  mcp: true,
  resume: false,
  usageReporting: true,
};
const unavailable: AgentCapabilities = {
  streaming: false,
  interruption: false,
  interactiveApproval: false,
  userQuestions: false,
  mcp: false,
  resume: false,
  usageReporting: false,
};

export function supportedVersion(
  provider: "codex" | "claude",
  version: string | null,
): boolean {
  const parts = version
    ?.match(/^(\d+)\.(\d+)\.(\d+)/)
    ?.slice(1)
    .map(Number);
  if (!parts) return false;
  const minimum = provider === "codex" ? [0, 169, 0] : [2, 1, 294];
  for (let i = 0; i < minimum.length; i++) {
    if (parts[i]! > minimum[i]!) return true;
    if (parts[i]! < minimum[i]!) return false;
  }
  return true;
}

export async function detectAgent(
  provider: ProviderId,
  cwd: string,
  customPath?: string,
): Promise<AgentInstallation> {
  if (provider === "fake")
    return {
      provider,
      path: null,
      version: "1",
      authentication: "not_required",
      available: true,
      capabilities: { ...capabilities, usageReporting: false },
    };
  let path: string | null = null;
  let version: string | null = null;
  try {
    path = await findProgram(provider, customPath);
    if (!path)
      return {
        provider,
        path,
        version,
        authentication: "unknown",
        available: false,
        code: "AGENT_NOT_INSTALLED",
        capabilities: unavailable,
      };
    const program = await resolveProgram(path, provider);
    const reported = await capture(program, ["--version"], cwd);
    if (reported.code !== 0) throw Error("version");
    version =
      /\b\d+\.\d+\.\d+(?:[-.][A-Za-z0-9.-]+)?/.exec(reported.text)?.[0] ?? null;
    const help = await capture(
      program,
      provider === "codex" ? ["app-server", "--help"] : ["--help"],
      cwd,
    );
    const supported =
      supportedVersion(provider, version) &&
      help.code === 0 &&
      (provider === "codex"
        ? /--listen/.test(help.text)
        : /--strict-mcp-config/.test(help.text) &&
          /--permission-prompts/.test(help.text));
    const auth = await capture(
      program,
      provider === "codex" ? ["login", "status"] : ["auth", "status", "--json"],
      cwd,
    );
    let authentication: AgentInstallation["authentication"] = "unknown";
    if (provider === "codex") {
      if (/not logged in/i.test(auth.text)) authentication = "unauthenticated";
      else if (/logged in/i.test(auth.text) && auth.code === 0)
        authentication = "authenticated";
    } else {
      try {
        const value = JSON.parse(auth.text) as { loggedIn?: boolean };
        if (typeof value.loggedIn === "boolean")
          authentication = value.loggedIn ? "authenticated" : "unauthenticated";
      } catch {}
    }
    return {
      provider,
      path,
      version,
      authentication,
      available: supported,
      ...(!supported ? { code: "AGENT_VERSION_UNSUPPORTED" } : {}),
      capabilities: supported ? capabilities : unavailable,
    };
  } catch (error) {
    return {
      provider,
      path,
      version,
      authentication: "unknown",
      available: false,
      code: error instanceof AgentError ? error.code : "AGENT_PROBE_FAILED",
      capabilities: unavailable,
    };
  }
}
