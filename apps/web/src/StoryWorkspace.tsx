import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "./api.js";
import type { QueryScope } from "../../../packages/domain/src/analysis.js";
import type {
  storyContext,
  storySequences,
} from "../../../packages/domain/src/story.js";
import type {
  Perspective,
  StoryQuery,
} from "../../../packages/domain/src/story-contracts.js";
import type { ContentMode } from "../../../packages/state-model/src/evaluation-contracts.js";
import type { AgentExecution } from "../../../packages/agent-core/src/contracts.js";
import {
  useData,
  key,
  Pin,
  Mode,
  type DomainQuery,
  type Go,
  type Report,
} from "./domain-widgets.js";
import { StateTraceView } from "./StateComparison.js";

type Story = ReturnType<typeof storyContext>;
type StoryOptions = ReturnType<typeof storySequences>;
const activeExecution = (execution: AgentExecution) =>
  ["starting", "running", "waiting_for_input", "cancelling"].includes(
    execution.state,
  );

function FilteredAgent({
  project,
  baseline,
  perspective,
  report,
  openRun,
}: {
  project: string;
  baseline: string;
  perspective: Perspective;
  report: Report;
  openRun: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState(""),
    [busy, setBusy] = useState(false),
    [execution, setExecution] = useState<AgentExecution>();
  useEffect(() => {
    if (!execution || !activeExecution(execution)) return;
    const timer = setTimeout(() => {
      void api<AgentExecution>(`/api/agent-executions/${execution.id}`)
        .then(setExecution)
        .catch(report);
    }, 900);
    return () => clearTimeout(timer);
  }, [execution, report]);
  async function start() {
    setBusy(true);
    try {
      const run = await api<{ runId: string }>(
        `/api/projects/${project}/tasks`,
        { goal: t("domain.povTask"), baselineId: baseline },
      );
      setExecution(
        await api<AgentExecution>(`/api/runs/${run.runId}/agents`, {
          requestId: crypto.randomUUID(),
          provider: "claude",
          prompt,
          perspective,
        }),
      );
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="domain-filtered">
      <summary>{t("domain.povTask")}</summary>
      <p>{t("domain.povIsolation")}</p>
      <label>
        {t("domain.povPrompt")}
        <textarea
          value={prompt}
          maxLength={12000}
          onChange={(event) => setPrompt(event.target.value)}
        />
      </label>
      <button
        className="primary-button"
        disabled={
          busy || !prompt.trim() || (!!execution && activeExecution(execution))
        }
        onClick={() => {
          void start();
        }}
      >
        {t("domain.povRun")}
      </button>
      {execution && (
        <>
          <p role="status">{t("agent.state." + execution.state)}</p>
          {execution.code && (
            <p>
              {t("errors." + execution.code, { defaultValue: execution.code })}
            </p>
          )}
          {execution.message && <pre>{execution.message}</pre>}
          {activeExecution(execution) ? (
            <button
              className="secondary-button"
              onClick={() => {
                void api<AgentExecution>(
                  `/api/agent-executions/${execution.id}/cancel`,
                  {},
                )
                  .then(setExecution)
                  .catch(report);
              }}
            >
              {t("agent.cancel")}
            </button>
          ) : (
            <button
              className="secondary-button"
              onClick={() => openRun(execution.runId)}
            >
              {t("work.open")}
            </button>
          )}
        </>
      )}
    </details>
  );
}

export function StoryPanel({
  query,
  report,
  choose,
  project,
  baseline,
  openRun,
  scope,
  canStart,
}: {
  query: DomainQuery;
  report: Report;
  choose: Go;
  project: string;
  baseline: string;
  openRun: (id: string) => void;
  scope: QueryScope;
  canStart: boolean;
}) {
  const { t } = useTranslation(),
    options = useData<StoryOptions>(query, "story-options", report);
  const [sequenceId, setSequence] = useState(""),
    [sceneId, setScene] = useState(""),
    [characterId, setCharacter] = useState("");
  const [boundary, setBoundary] = useState<StoryQuery["boundary"]>("after"),
    [mode, setMode] = useState<ContentMode>("confirmed");
  const [pov, setPov] = useState<"author" | Perspective["kind"]>("author");
  const [worldOrder, setWorldOrder] = useState(false),
    [busy, setBusy] = useState(false);
  const [context, setContext] = useState<Story>();
  const [boundPerspective, setBoundPerspective] = useState<Perspective>();
  const sequence =
    options?.sequences.find((item) => item.id === sequenceId) ??
    options?.sequences[0];
  const scene =
    sequence?.scenes.find((item) => item.target.entity_id === sceneId) ??
    sequence?.scenes[0];
  const requestVersion = useRef(0);
  function clear() {
    requestVersion.current++;
    setContext(undefined);
    setBoundPerspective(undefined);
  }
  async function loadContext() {
    if (!sequence || !scene || busy || (pov === "character" && !characterId))
      return;
    const input: StoryQuery = {
      sequenceId: sequence.id,
      sceneId: scene.target.entity_id,
      boundary,
      mode,
      ...(characterId && pov !== "reader" ? { characterId } : {}),
    };
    const perspective =
      pov === "author"
        ? undefined
        : ({
            kind: pov,
            story: input,
            ...(Object.keys(scope).length ? { scope } : {}),
          } satisfies Perspective);
    clear();
    const version = requestVersion.current;
    setBusy(true);
    try {
      const loaded = await query<Story>(
        "story",
        perspective ? {} : { ...input },
        perspective,
      );
      if (requestVersion.current !== version) return;
      setContext(loaded);
      if (perspective) setBoundPerspective(perspective);
    } catch (error) {
      if (requestVersion.current === version) report(error);
    } finally {
      setBusy(false);
    }
  }
  const timeline =
    context?.perspective === "author" && context.timeline
      ? [...context.timeline].sort((a, b) =>
          worldOrder
            ? (a.startTick ?? Infinity) - (b.startTick ?? Infinity) ||
              a.order - b.order
            : a.order - b.order,
        )
      : [];
  return (
    <>
      {!sequence && (
        <p>{t(options ? "domain.noSequences" : "common.loading")}</p>
      )}
      {sequence && (
        <form
          className="domain-form"
          onSubmit={(event) => {
            event.preventDefault();
            void loadContext();
          }}
        >
          <div className="domain-fields">
            <label>
              {t("domain.sequence")}
              <select
                value={sequence.id}
                onChange={(event) => {
                  setSequence(event.target.value);
                  setScene("");
                  clear();
                }}
              >
                {options?.sequences.map((item) => (
                  <option key={item.id}>{item.id}</option>
                ))}
              </select>
            </label>
            <label>
              {t("domain.scene")}
              <select
                value={scene?.target.entity_id ?? ""}
                onChange={(event) => {
                  setScene(event.target.value);
                  clear();
                }}
              >
                {sequence.scenes.map((item) => (
                  <option key={item.order} value={item.target.entity_id}>
                    {pov === "author"
                      ? item.chapter + " · " + item.title
                      : t("domain.scene") + " " + (item.order + 1)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("domain.boundary")}
              <select
                value={boundary}
                onChange={(event) => {
                  setBoundary(event.target.value as StoryQuery["boundary"]);
                  clear();
                }}
              >
                <option value="before">{t("domain.before")}</option>
                <option value="after">{t("domain.after")}</option>
              </select>
            </label>
            <label>
              {t("domain.perspective")}
              <select
                value={pov}
                onChange={(event) => {
                  setPov(event.target.value as typeof pov);
                  clear();
                }}
              >
                {(["author", "character", "reader"] as const).map((item) => (
                  <option key={item} value={item}>
                    {t("domain." + item)}
                  </option>
                ))}
              </select>
            </label>
            {pov !== "reader" && (
              <label>
                {t("domain.character")}
                <select
                  value={characterId}
                  onChange={(event) => {
                    setCharacter(event.target.value);
                    clear();
                  }}
                >
                  <option value="">{t("domain.noCharacter")}</option>
                  {options?.characters.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Mode
              value={mode}
              onChange={(value) => {
                setMode(value);
                clear();
              }}
            />
          </div>
          {pov !== "author" && <p>{t("domain.povPreview")}</p>}
          <button
            className="primary-button"
            disabled={busy || !scene || (pov === "character" && !characterId)}
          >
            {t(busy ? "common.loading" : "domain.readScene")}
          </button>
        </form>
      )}
      {context && (
        <section>
          <h2>{t("domain.sceneResult")}</h2>
          <p>
            {t("domain.tick")} {context.worldTick ?? t("domain.unknown")} ·{" "}
            {t("domain.readerOrder")} {context.readerPosition + 1}
          </p>
          <ul>
            {context.issues.map((issue, index) => (
              <li key={index}>
                {t("domain.issue." + issue.code, { defaultValue: issue.code })}
              </li>
            ))}
          </ul>
          {context.perspective === "author" && "facts" in context && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={worldOrder}
                  onChange={(event) => setWorldOrder(event.target.checked)}
                />
                {t("domain.sortWorld")}
              </label>
              <ol className="domain-flow">
                {timeline.map((item) => (
                  <li key={item.order}>
                    <Pin target={item.target} choose={choose}>
                      {item.chapter} · {item.title}
                    </Pin>
                    <span>
                      {t("domain.readerOrder")} {item.order + 1} ·{" "}
                      {t("domain.tick")} {item.startTick ?? "—"} →{" "}
                      {item.endTick ?? "—"}
                    </span>
                  </li>
                ))}
              </ol>
              {context.profile && (
                <details>
                  <summary>{t("domain.profile")}</summary>
                  <pre>{JSON.stringify(context.profile, null, 2)}</pre>
                </details>
              )}
              {context.state && (
                <StateTraceView value={context.state} choose={choose} />
              )}
              <h3>{t("domain.facts")}</h3>
              <ul className="domain-values">
                {context.facts.map((item) => (
                  <li key={key(item.target)}>
                    <Pin target={item.target} choose={choose}>
                      {item.title}
                    </Pin>{" "}
                    <span>
                      {t("domain." + item.attitude)} ·{" "}
                      {t(
                        item.occurred
                          ? "domain.occurred"
                          : item.role === "plan"
                            ? "domain.plan"
                            : "domain.unconfirmed",
                      )}
                    </span>
                    {item.evidence && (
                      <Pin target={item.evidence} choose={choose}>
                        {t("domain.evidence")}
                      </Pin>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3>{t("domain.disclosures")}</h3>
          {!context.disclosures.length ? (
            <p>{t("common.empty")}</p>
          ) : (
            <ul className="domain-values">
              {context.disclosures.map((item, index) => (
                <li key={index}>
                  {item.text}{" "}
                  <small>
                    {t("domain." + item.certainty)}{" "}
                    {item.attitude && t("domain." + item.attitude)}
                  </small>
                </li>
              ))}
            </ul>
          )}
          {boundPerspective && (
            <PerspectiveSearch
              key={JSON.stringify(boundPerspective)}
              query={query}
              perspective={boundPerspective}
              report={report}
            />
          )}
          {canStart && boundPerspective?.story.mode === "confirmed" && (
            <FilteredAgent
              key={JSON.stringify(boundPerspective)}
              project={project}
              baseline={baseline}
              perspective={boundPerspective}
              report={report}
              openRun={openRun}
            />
          )}
        </section>
      )}
    </>
  );
}

function PerspectiveSearch({
  query,
  perspective,
  report,
}: {
  query: DomainQuery;
  perspective: Perspective;
  report: Report;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(""),
    [found, setFound] = useState<{ snippet: string }[]>(),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="domain-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!text.trim() || busy) return;
        setBusy(true);
        setFound(undefined);
        void query<{ hits: { snippet: string }[] }>(
          "search",
          { text: text.trim() },
          perspective,
        )
          .then((result) => setFound(result.hits))
          .catch(report)
          .finally(() => setBusy(false));
      }}
    >
      <label>
        {t("domain.searchDisclosures")}
        <input
          maxLength={256}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <button className="secondary-button" disabled={busy || !text.trim()}>
        {t("search.submit")}
      </button>
      {found &&
        (found.length ? (
          <ul>
            {found.map((item, index) => (
              <li key={index}>{item.snippet}</li>
            ))}
          </ul>
        ) : (
          <p role="status">{t("common.empty")}</p>
        ))}
    </form>
  );
}
