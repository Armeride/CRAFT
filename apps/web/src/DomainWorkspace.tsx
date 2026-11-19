import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "./api.js";
import type {
  QueryEnvelope,
  QueryOperation,
} from "../../../packages/indexer/src/types.js";
import type { QueryScope } from "../../../packages/domain/src/analysis.js";
import type { Perspective } from "../../../packages/domain/src/story-contracts.js";
import { StatePanel } from "./StateComparison.js";
import { StoryPanel } from "./StoryWorkspace.js";
import { GamePanel } from "./GameWorkspace.js";
import type { DomainQuery, Go, Report } from "./domain-widgets.js";

export function DomainWorkspace({
  project,
  baseline,
  choose,
  report,
  openRun,
  activeRun,
}: {
  project: string;
  baseline: string;
  choose: Go;
  report: Report;
  openRun: (id: string) => void;
  activeRun?: string;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"state" | "story" | "game">("state");
  const [view, setView] = useState<"project" | "basis" | "working">("project");
  const [platform, setPlatform] = useState(""),
    [mode, setMode] = useState("");
  const path =
    activeRun && view !== "project"
      ? `/api/runs/${activeRun}/query/${view}`
      : `/api/projects/${project}/query`;
  const scope = useMemo<QueryScope>(
    () => ({
      ...(platform.trim() ? { platform: platform.trim() } : {}),
      ...(mode.trim() ? { mode: mode.trim() } : {}),
    }),
    [platform, mode],
  );
  const query = useMemo<DomainQuery>(
    () =>
      async <T,>(
        operation: QueryOperation,
        args: Record<string, unknown> = {},
        perspective?: Perspective,
      ) => {
        const envelope = await api<QueryEnvelope<T>>(path, {
          operation,
          args,
          baselineId: baseline,
          ...(Object.keys(scope).length ? { scope } : {}),
          ...(perspective ? { perspective } : {}),
        });
        return envelope.data;
      },
    [path, baseline, scope],
  );
  return (
    <div className="page-content domain-page">
      <div className="page-heading">
        <h1>{t("domain.title")}</h1>
      </div>
      <div className="domain-tabs" role="group" aria-label={t("domain.title")}>
        {(["state", "story", "game"] as const).map((name) => (
          <button
            key={name}
            className={tab === name ? "primary-button" : "secondary-button"}
            aria-pressed={tab === name}
            onClick={() => setTab(name)}
          >
            {t("domain." + name)}
          </button>
        ))}
      </div>
      <form
        className="domain-fields"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setPlatform(String(data.get("platform") ?? ""));
          setMode(String(data.get("mode") ?? ""));
        }}
      >
        {activeRun && (
          <label>
            {t("domain.snapshot")}
            <select
              value={view}
              onChange={(event) => setView(event.target.value as typeof view)}
            >
              <option value="project">{t("domain.project")}</option>
              <option value="basis">{t("domain.runBasis")}</option>
              <option value="working">{t("domain.runWorking")}</option>
            </select>
          </label>
        )}
        <label>
          {t("domain.platform")}
          <input name="platform" defaultValue={platform} maxLength={100} />
        </label>
        <label>
          {t("domain.scopeMode")}
          <input name="mode" defaultValue={mode} maxLength={100} />
        </label>
        <button className="secondary-button">{t("domain.applyScope")}</button>
      </form>
      <div key={JSON.stringify([path, baseline, platform, mode])}>
        {tab === "state" ? (
          <StatePanel query={query} report={report} choose={choose} />
        ) : tab === "story" ? (
          <StoryPanel
            query={query}
            report={report}
            choose={choose}
            project={project}
            baseline={baseline}
            openRun={openRun}
            scope={scope}
            canStart={view === "project"}
          />
        ) : (
          <GamePanel query={query} report={report} choose={choose} />
        )}
      </div>
    </div>
  );
}
