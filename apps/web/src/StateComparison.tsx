import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "./api.js";
import type {
  StateCell,
  StateResult,
  ContentMode,
  StateOptions,
  EvaluationResult,
  StateComparison,
} from "../../../packages/state-model/src/evaluation-contracts.js";
import {
  useData,
  key,
  Pin,
  Mode,
  type DomainQuery,
  type Go,
  type Report,
} from "./domain-widgets.js";

type Options = StateOptions;
type Compare = StateComparison & {
  before: EvaluationResult;
  after: EvaluationResult;
};
type Scenario = Options["scenarios"][number];
interface Side {
  tick: string;
  order: string;
  actor: string;
  event: string;
  overrides: string;
  scene: string;
  boundary: "before" | "after";
}
const side = (tick: string): Side => ({
  tick,
  order: "",
  actor: "",
  event: "",
  overrides: "",
  scene: "",
  boundary: "after",
});

function StateSide({
  label,
  value,
  scenario,
  sequences,
  onChange,
}: {
  label: string;
  value: Side;
  scenario?: Scenario;
  sequences: Options["sequences"];
  onChange: (value: Side) => void;
}) {
  const { t } = useTranslation();
  const update = <K extends keyof Side>(key: K, next: Side[K]) =>
    onChange({ ...value, [key]: next });
  return (
    <fieldset>
      <legend>{label}</legend>
      {!scenario && sequences.length > 0 && (
        <label>
          {t("domain.scene")}
          <select
            value={value.scene}
            onChange={(event) => update("scene", event.target.value)}
          >
            <option value="">{t("domain.manualTick")}</option>
            {sequences.map((sequence) => (
              <optgroup key={sequence.id} label={sequence.id}>
                {sequence.scenes.map((scene) => (
                  <option
                    key={scene.order}
                    value={sequence.id + "/" + scene.target.entity_id}
                  >
                    {scene.chapter} · {scene.title}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      )}
      {!value.scene && (
        <>
          <label>
            {t("domain.tick")}
            <input
              type="number"
              step="1"
              required
              value={value.tick}
              onChange={(event) => update("tick", event.target.value)}
            />
          </label>
          <label>
            {t("domain.order")}
            <input
              type="number"
              step="1"
              min="0"
              value={value.order}
              onChange={(event) => update("order", event.target.value)}
            />
          </label>
        </>
      )}
      <label>
        {t("domain.boundary")}
        <select
          value={value.boundary}
          onChange={(event) =>
            update("boundary", event.target.value as Side["boundary"])
          }
        >
          <option value="after">{t("domain.after")}</option>
          <option value="before">{t("domain.before")}</option>
        </select>
      </label>
      {scenario && (
        <>
          <label>
            {t("domain.actor")}
            <select
              value={value.actor}
              onChange={(event) => update("actor", event.target.value)}
            >
              <option value="">{t("domain.allActors")}</option>
              {scenario.actors.map((actor) => (
                <option key={actor}>{actor}</option>
              ))}
            </select>
          </label>
          <label>
            {t("domain.eventSelection")}
            <select
              value={value.event}
              onChange={(event) => update("event", event.target.value)}
            >
              <option value="">{t("domain.allEvents")}</option>
              <option value="-">{t("domain.noEvents")}</option>
              {scenario.occurrences.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.id} ({event.name})
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("domain.overrides")}
            <textarea
              rows={2}
              maxLength={5000}
              spellCheck={false}
              value={value.overrides}
              onChange={(event) => update("overrides", event.target.value)}
              placeholder='{"actor": {"level": 10}}'
            />
          </label>
        </>
      )}
    </fieldset>
  );
}

function CellValue({ cell }: { cell: StateCell | null }) {
  const { t, i18n } = useTranslation();
  if (cell?.value === undefined) return <span>{t("domain.unknown")}</span>;
  const value = cell.value;
  const label =
    typeof value === "number"
      ? new Intl.NumberFormat(i18n.resolvedLanguage, {
          maximumFractionDigits: 12,
        }).format(value)
      : typeof value === "boolean"
        ? t(value ? "domain.true" : "domain.false")
        : typeof value === "string"
          ? value
          : JSON.stringify(value);
  return (
    <div>
      <span>
        {label} {cell.unit}
      </span>{" "}
      <small>{t("domain." + cell.certainty)}</small>
    </div>
  );
}

export function StateTraceView({
  value,
  choose,
}: {
  value: StateResult;
  choose: Go;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <p>
        {t(value.assumption ? "domain.assumption" : "domain.worldEvidence")} ·{" "}
        {t("domain.tick")} {value.point.worldTick}
      </p>
      <ul className="domain-values">
        {value.cells.map((cell) => (
          <li key={cell.instance + "/" + cell.field}>
            <code>
              {cell.instance} · {cell.field}
            </code>
            <CellValue cell={cell} />
            {cell.source && (
              <Pin target={cell.source} choose={choose}>
                {t("domain.source")}
              </Pin>
            )}
            {cell.evidence && (
              <Pin target={cell.evidence} choose={choose}>
                {t("domain.evidence")}
              </Pin>
            )}
          </li>
        ))}
      </ul>
      {value.issues.length > 0 && (
        <ul>
          {value.issues.map((issue, index) => (
            <li key={index}>
              {t("domain.issue." + issue.code, { defaultValue: issue.code })}{" "}
              {issue.field}
            </li>
          ))}
        </ul>
      )}
      <ol className="domain-flow">
        {value.trace.map((item, index) => (
          <li key={index} data-outcome={item.outcome}>
            <span>
              <strong>
                {item.worldTick}/{item.eventOrder}
              </strong>{" "}
              · <code>{item.occurrenceId}</code>
            </span>
            <span>
              {t("domain." + item.outcome)}
              {item.condition && (
                <>
                  {" "}
                  · {t("domain.condition")} {t("domain." + item.condition)}
                </>
              )}
            </span>
            {item.checks && (
              <details>
                <summary>{t("domain.conditionChecks")}</summary>
                <ul>
                  {Object.entries(item.checks).map(([name, truth]) => (
                    <li key={name}>
                      <code>{name}</code> · {t("domain." + truth)}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {item.reason && (
              <small>
                {t("domain.issue." + item.reason, {
                  defaultValue: item.reason,
                })}
              </small>
            )}
            {item.transition && (
              <Pin target={item.transition} choose={choose}>
                {t("domain.rule")}
              </Pin>
            )}
            {item.evidence && (
              <Pin target={item.evidence} choose={choose}>
                {t("domain.evidence")}
              </Pin>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function StatePanel({
  query,
  report,
  choose,
}: {
  query: DomainQuery;
  report: Report;
  choose: Go;
}) {
  const { t } = useTranslation();
  const options = useData<Options>(query, "state-options", report);
  const [scenarioId, setScenarioId] = useState(""),
    [target, setTarget] = useState("");
  const [before, setBefore] = useState(side("10")),
    [after, setAfter] = useState(side("50"));
  const [mode, setMode] = useState<ContentMode>("confirmed"),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<Compare>();
  const scenario = options?.scenarios.find(
    (value) => key(value.target) === scenarioId,
  );
  function request(value: Side) {
    let actorOverrides: unknown;
    if (scenario && value.overrides.trim()) {
      try {
        actorOverrides = JSON.parse(value.overrides);
      } catch {
        throw new ApiError("REQUEST_INVALID", {});
      }
    }
    const [sequenceId, sceneId] = value.scene.split("/");
    if (!scenario && sequenceId && sceneId)
      return {
        scene: { sequenceId, sceneId, boundary: value.boundary },
        mode,
        ...(target ? { target } : {}),
      };
    return {
      worldTick: Number(value.tick),
      boundary: value.boundary,
      mode,
      ...(value.order ? { eventOrder: Number(value.order) } : {}),
      ...(target ? { target } : {}),
      ...(scenario
        ? {
            scenario: scenario.target,
            ...(value.actor ? { actor: value.actor } : {}),
            ...(value.event
              ? { occurrenceIds: value.event === "-" ? [] : [value.event] }
              : {}),
            ...(actorOverrides !== undefined ? { actorOverrides } : {}),
          }
        : {}),
    };
  }
  const requestVersion = useRef(0);
  function clear() {
    requestVersion.current++;
    setResult(undefined);
  }
  async function compare() {
    if (busy) return;
    setBusy(true);
    clear();
    const version = requestVersion.current;
    try {
      const compared = await query<Compare>("state-compare", {
        before: request(before),
        after: request(after),
      });
      if (requestVersion.current === version) setResult(compared);
    } catch (error) {
      if (requestVersion.current === version) report(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void compare();
        }}
        className="domain-form"
      >
        <div className="domain-fields">
          <Mode
            value={mode}
            onChange={(value) => {
              clear();
              setMode(value);
            }}
          />
          <label>
            {t("domain.target")}
            <select
              value={target}
              onChange={(event) => {
                clear();
                setTarget(event.target.value);
              }}
            >
              <option value="">{t("domain.allTargets")}</option>
              {options?.targets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("domain.scenario")}
            <select
              value={scenarioId}
              onChange={(event) => {
                const selected = options?.scenarios.find(
                  (value) => key(value.target) === event.target.value,
                );
                clear();
                setScenarioId(event.target.value);
                if (selected) {
                  setBefore(side(String(selected.worldTick)));
                  setAfter(side(String(selected.worldTick)));
                }
              }}
            >
              <option value="">{t("domain.canonicalRecords")}</option>
              {options?.scenarios.map((item) => (
                <option key={key(item.target)} value={key(item.target)}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        {scenario?.assumptions.map((item, index) => (
          <p key={index}>{item}</p>
        ))}
        <div className="domain-columns">
          <StateSide
            label={t("domain.left")}
            value={before}
            sequences={options?.sequences ?? []}
            {...(scenario ? { scenario } : {})}
            onChange={(value) => {
              clear();
              setBefore(value);
            }}
          />
          <StateSide
            label={t("domain.right")}
            value={after}
            sequences={options?.sequences ?? []}
            {...(scenario ? { scenario } : {})}
            onChange={(value) => {
              clear();
              setAfter(value);
            }}
          />
        </div>
        <button
          type="submit"
          className="primary-button"
          disabled={busy || !options}
        >
          {t(busy ? "common.loading" : "domain.compare")}
        </button>
      </form>
      {result && (
        <section>
          <h2>{t("domain.differences")}</h2>
          {!result.changes.length ? (
            <p>{t("domain.noDifference")}</p>
          ) : (
            <div className="domain-table">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t("domain.field")}</th>
                    <th scope="col">{t("domain.left")}</th>
                    <th scope="col">{t("domain.right")}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.changes.map((item) => (
                    <tr key={item.instance + "/" + item.field}>
                      <th scope="row">
                        <code>
                          {item.instance} · {item.field}
                        </code>
                      </th>
                      <td>
                        <CellValue cell={item.before} />
                      </td>
                      <td>
                        <CellValue cell={item.after} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="domain-columns">
            <section>
              <h3>{t("domain.left")}</h3>
              <StateTraceView value={result.before} choose={choose} />
            </section>
            <section>
              <h3>{t("domain.right")}</h3>
              <StateTraceView value={result.after} choose={choose} />
            </section>
          </div>
          <details>
            <summary>{t("domain.provenance")}</summary>
            <code>{result.before.inputDigest}</code>
            <br />
            <code>{result.after.inputDigest}</code>
          </details>
        </section>
      )}
    </>
  );
}
