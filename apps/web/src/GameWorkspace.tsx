import { useTranslation } from "react-i18next";
import type { gameContext } from "../../../packages/domain/src/game.js";
import {
  useData,
  key,
  Pin,
  type DomainQuery,
  type Go,
  type Report,
} from "./domain-widgets.js";

export function GamePanel({
  query,
  report,
  choose,
}: {
  query: DomainQuery;
  report: Report;
  choose: Go;
}) {
  const { t, i18n } = useTranslation();
  const data = useData<ReturnType<typeof gameContext>>(query, "game", report);
  const n = new Intl.NumberFormat(i18n.resolvedLanguage, {
    maximumFractionDigits: 12,
  });
  if (!data) return <p>{t("common.loading")}</p>;
  if (!data.rules.length && !data.proposals.length && !data.observations.length)
    return <p>{t("domain.noGame")}</p>;
  return (
    <>
      <div className="domain-columns">
        {(
          [
            ["domain.rules", data.rules],
            ["domain.proposals", data.proposals],
          ] as const
        ).map(([label, rules]) => (
          <section key={label}>
            <h2>{t(label)}</h2>
            {rules.map((rule) => (
              <article className="domain-card" key={key(rule.target)}>
                <Pin target={rule.target} choose={choose}>
                  {rule.title}
                </Pin>{" "}
                <small>{t("domain." + rule.certainty)}</small>
                <ul className="domain-values">
                  {Object.entries(rule.quantities).map(([name, value]) => (
                    <li key={name}>
                      <code>{name}</code> {n.format(value.value)}{" "}
                      {value.unit ?? t("domain.missingUnit")}
                      {"minimum" in value && value.minimum !== undefined && (
                        <>
                          {" "}
                          · {t("domain.minimum")} {n.format(value.minimum)}
                        </>
                      )}
                      {"maximum" in value && value.maximum !== undefined && (
                        <>
                          {" "}
                          · {t("domain.maximum")} {n.format(value.maximum)}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                {rule.evidence.map((ref) => (
                  <Pin
                    key={ref.reference_id}
                    target={ref.target}
                    choose={choose}
                  >
                    {t("domain.evidence")}
                  </Pin>
                ))}
                {rule.decisions.map((item) => (
                  <Pin
                    key={key(item.target)}
                    target={item.target}
                    choose={choose}
                  >
                    {item.title}
                  </Pin>
                ))}
              </article>
            ))}
          </section>
        ))}
      </div>
      <h2>{t("domain.observations")}</h2>
      <ul className="domain-values">
        {data.observations.map((observation) => (
          <li key={key(observation.target)}>
            <Pin target={observation.target} choose={choose}>
              {observation.title}
            </Pin>{" "}
            <code>{observation.build_id}</code>{" "}
            <time dateTime={observation.observed_at}>
              {observation.observed_at}
            </time>
            <details>
              <summary>{t("domain.observationConditions")}</summary>
              <pre>{JSON.stringify(observation.conditions, null, 2)}</pre>
            </details>
            {observation.evidence.map((ref) => (
              <Pin key={ref.reference_id} target={ref.target} choose={choose}>
                {t("domain.evidence")}
              </Pin>
            ))}
          </li>
        ))}
      </ul>
      {!!data.differences.length && (
        <div className="domain-table">
          <table>
            <thead>
              <tr>
                <th scope="col">{t("domain.field")}</th>
                <th scope="col">{t("domain.planned")}</th>
                <th scope="col">{t("domain.observed")}</th>
                <th scope="col">{t("domain.delta")}</th>
              </tr>
            </thead>
            <tbody>
              {data.differences.map((item) => (
                <tr key={key(item.observation) + item.parameter}>
                  <th scope="row">
                    <code>{item.parameter}</code>
                  </th>
                  <td>
                    {item.planned
                      ? n.format(item.planned.value) +
                        " " +
                        (item.planned.unit ?? "")
                      : t("domain.unknown")}
                  </td>
                  <td>
                    {n.format(item.observed.value)} {item.observed.unit}
                  </td>
                  <td>
                    {item.delta === null
                      ? t("domain.unknown")
                      : n.format(item.delta)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
