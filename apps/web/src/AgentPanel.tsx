import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  AgentAnswer,
  AgentExecution,
  AgentInstallation,
  AgentRequest,
  ProviderId,
} from "../../../packages/agent-core/src/contracts.js";
import type { Draft } from "../../server/contracts.js";
import { api, ApiError, remember, runCommand, stored } from "./api.js";

function PendingInput({
  execution,
  respond,
  report,
}: {
  execution: AgentExecution;
  respond: (request: AgentRequest, answer: AgentAnswer) => Promise<void>;
  report: (error: unknown) => void;
}) {
  const { t } = useTranslation();
  const request = execution.pending!;
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  async function submit(allow: boolean) {
    setBusy(true);
    try {
      await respond(request, {
        allow,
        ...(request.kind === "question" ? { answers } : {}),
      });
    } catch (error) {
      setBusy(false);
      report(error);
    }
  }
  return (
    <section
      className="agent-input"
      aria-label={t(
        request.kind === "question" ? "agent.question" : "agent.approval",
      )}
    >
      <h3>
        {t(request.kind === "question" ? "agent.question" : "agent.approval")}
      </h3>
      {request.kind === "approval" && (
        <>
          <p>{request.title}</p>
          <pre tabIndex={0}>{request.details}</pre>
        </>
      )}
      {request.questions.map((question) => (
        <fieldset disabled={busy} key={question.id}>
          <legend>{question.question}</legend>
          {question.options.map((option) => (
            <label key={option}>
              <input
                type={question.multiple ? "checkbox" : "radio"}
                name={request.id + question.id}
                checked={answers[question.id]?.includes(option) ?? false}
                onChange={(event) =>
                  setAnswers((previous) => ({
                    ...previous,
                    [question.id]: question.multiple
                      ? event.target.checked
                        ? [...(previous[question.id] ?? []), option]
                        : (previous[question.id] ?? []).filter(
                            (value) => value !== option,
                          )
                      : [option],
                  }))
                }
              />
              {option}
            </label>
          ))}
          <label>
            {t("agent.freeAnswer")}
            <input
              value={
                question.options.includes(answers[question.id]?.[0] ?? "")
                  ? ""
                  : (answers[question.id]?.join(", ") ?? "")
              }
              onChange={(event) =>
                setAnswers((previous) => ({
                  ...previous,
                  [question.id]: [event.target.value],
                }))
              }
            />
          </label>
        </fieldset>
      ))}
      <div className="modal-controls">
        <button
          className="primary-button"
          disabled={busy}
          onClick={() => {
            void submit(true);
          }}
        >
          {t(request.kind === "question" ? "agent.answer" : "agent.allowOnce")}
        </button>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => {
            void submit(false);
          }}
        >
          {t("agent.decline")}
        </button>
      </div>
    </section>
  );
}

export function AgentPanel({
  draft,
  prompt,
  sent,
  connection,
  report,
  openRun,
}: {
  draft: Draft;
  prompt: string;
  sent: () => void;
  connection: (connected: boolean) => void;
  report: (error: unknown) => void;
  openRun: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [installations, setInstallations] = useState<AgentInstallation[]>([]);
  const [provider, setProvider] = useState<ProviderId | "">(() => {
    const saved = stored("craft.agent.provider");
    return saved === "codex" || saved === "claude" || saved === "fake"
      ? saved
      : "";
  });
  const [path, setPath] = useState("");
  const [model, setModel] = useState("");
  const [executions, setExecutions] = useState<AgentExecution[]>([]);
  const [busy, setBusy] = useState(false);
  const latest = useRef(executions);
  latest.current = executions;
  const installation = installations.find((item) => item.provider === provider);
  const current = executions.at(-1);
  const running =
    !!current &&
    ["starting", "running", "waiting_for_input", "cancelling"].includes(
      current.state,
    );

  useEffect(() => {
    let active = true;
    void api<AgentInstallation[]>("/api/agents")
      .then((value) => {
        if (active) setInstallations(value);
      })
      .catch(report);
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    connection(!!provider && installation?.available === true);
    if (provider) {
      remember("craft.agent.provider", provider);
      setPath(stored("craft.agent.path:" + provider) ?? "");
    }
  }, [provider, installation?.available]);
  useEffect(() => {
    let active = true,
      timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      void api<AgentExecution[]>(`/api/runs/${draft.runId}/agents`)
        .then((value) => {
          if (active) setExecutions(value);
        })
        .catch(report);
    };
    refresh();
    const listener = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (id && id !== draft.runId) return;
      clearTimeout(timer);
      timer = setTimeout(refresh, 150);
    };
    const poll = setInterval(() => {
      if (
        latest.current.some((item) =>
          ["starting", "running", "waiting_for_input", "cancelling"].includes(
            item.state,
          ),
        )
      )
        refresh();
    }, 2500);
    window.addEventListener("craft:task-change", listener);
    return () => {
      active = false;
      clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener("craft:task-change", listener);
    };
  }, [draft.runId]);

  async function start() {
    if (!provider || !prompt.trim()) return;
    setBusy(true);
    const input = {
      provider,
      prompt: prompt.trim(),
      ...(path.trim() ? { path: path.trim() } : {}),
      ...(model.trim() ? { model: model.trim() } : {}),
    };
    try {
      const record = await runCommand(draft.runId, async (send) => {
        const body = await send<Draft>(`/api/runs/${draft.runId}/draft`);
        if (body.text !== draft.text) {
          if (body.digest !== draft.digest)
            throw new ApiError("FILE_CHANGED_EXTERNALLY", {});
          await send(
            `/api/runs/${draft.runId}/draft`,
            { text: draft.text, expectedDigest: body.digest },
            "PUT",
          );
        }
        return send<AgentExecution>(`/api/runs/${draft.runId}/agents`, input);
      });
      setExecutions((previous) => [
        ...previous.filter((item) => item.id !== record.id),
        record,
      ]);
      sent();
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  async function probe() {
    if (!provider || !path.trim()) return;
    setBusy(true);
    try {
      const value = await api<AgentInstallation>("/api/agents/probe", {
        provider,
        path: path.trim(),
      });
      setInstallations((previous) => [
        ...previous.filter((item) => item.provider !== provider),
        value,
      ]);
      if (value.available)
        remember("craft.agent.path:" + provider, path.trim());
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  const number = (value: number) =>
    new Intl.NumberFormat(i18n.resolvedLanguage).format(value);
  return (
    <section className="agent-panel" aria-label={t("agent.controls")}>
      <label>
        {t("agent.provider")}
        <select
          value={provider}
          disabled={busy || running}
          onChange={(event) =>
            setProvider(event.target.value as ProviderId | "")
          }
        >
          <option value="">{t("agent.choose")}</option>
          {(["codex", "claude", "fake"] as const).map((id) => (
            <option key={id} value={id}>
              {t("agent.provider." + id)}
            </option>
          ))}
        </select>
      </label>
      {installation && (
        <p className="helper-text">
          {installation.version ?? t("agent.notInstalled")} ·{" "}
          {t("agent.auth." + installation.authentication)}
          {installation.code && <> · {t("errors." + installation.code)}</>}
        </p>
      )}
      {provider && provider !== "fake" && (
        <details>
          <summary>{t("agent.advanced")}</summary>
          {installation?.path && (
            <p className="helper-text">
              <code>{installation.path}</code>
            </p>
          )}
          <label>
            {t("agent.path")}
            <input
              value={path}
              onChange={(event) => setPath(event.target.value)}
            />
          </label>
          <button
            className="secondary-button"
            disabled={busy || running || !path.trim()}
            onClick={() => {
              void probe();
            }}
          >
            {t("agent.probe")}
          </button>
          <label>
            {t("agent.model")}
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
          </label>
        </details>
      )}
      {provider && (
        <p className="helper-text">
          {t(provider === "fake" ? "agent.fixtureHint" : "agent.contextHint")}
        </p>
      )}
      <button
        className="primary-button"
        disabled={
          busy ||
          running ||
          !prompt.trim() ||
          !installation?.available ||
          installation.authentication === "unauthenticated"
        }
        onClick={() => {
          void start();
        }}
      >
        {t(busy ? "agent.starting" : "agent.start")}
      </button>
      {executions.map((execution) => {
        const usage = execution.events.findLast(
          (event) => event.type === "usage.updated",
        )?.usage;
        return (
          <article className="agent-execution" key={execution.id}>
            <p className="agent-state" role="status">
              {t("agent.provider." + execution.provider)} ·{" "}
              {t("agent.state." + execution.state)}
            </p>
            <p>{execution.prompt}</p>
            <div
              className="agent-message"
              role="log"
              aria-label={t("agent.response")}
            >
              {execution.message}
            </div>
            {execution.pending && (
              <PendingInput
                key={execution.pending.id}
                execution={execution}
                report={report}
                respond={async (request, answer) => {
                  await api(`/api/agent-executions/${execution.id}/respond`, {
                    requestId: request.id,
                    answer,
                  });
                }}
              />
            )}
            {[
              "starting",
              "running",
              "waiting_for_input",
              "cancelling",
            ].includes(execution.state) && (
              <button
                className="secondary-button"
                disabled={execution.state === "cancelling"}
                onClick={() => {
                  void api(
                    `/api/agent-executions/${execution.id}/cancel`,
                    {},
                  ).catch(report);
                }}
              >
                {t("agent.cancel")}
              </button>
            )}
            {execution.code && (
              <p className="error-banner">
                {t("errors." + execution.code, {
                  defaultValue: t("errors.REQUEST_FAILED"),
                })}
              </p>
            )}
            {["failed", "cancelled", "interrupted"].includes(
              execution.state,
            ) && (
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void api<{ runId: string }>(
                    `/api/agent-executions/${execution.id}/fork`,
                    {},
                  )
                    .then((run) => openRun(run.runId))
                    .catch(report)
                    .finally(() => setBusy(false));
                }}
              >
                {t("agent.retryWorkspace")}
              </button>
            )}
            {execution.checkpointId && (
              <p className="helper-text">{t("agent.preserved")}</p>
            )}
            {usage && (
              <p className="helper-text">
                {t("agent.usage", {
                  input: number(usage["inputTokens"] ?? 0),
                  output: number(usage["outputTokens"] ?? 0),
                })}
              </p>
            )}
            <details>
              <summary>{t("agent.events")}</summary>
              <ul>
                {execution.events
                  .filter((event) => event.tool)
                  .slice(-20)
                  .map((event) => (
                    <li key={event.sequence}>
                      {t("agent.event." + event.type)} ·{" "}
                      <code>{event.tool}</code>
                    </li>
                  ))}
              </ul>
            </details>
          </article>
        );
      })}
    </section>
  );
}
