import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { QueryOperation } from "../../../packages/indexer/src/types.js";
import type { ContentMode } from "../../../packages/state-model/src/evaluation-contracts.js";
import type { SnapshotTarget } from "../../../packages/schema/src/generated.js";
import type { Perspective } from "../../../packages/domain/src/story-contracts.js";

export type DomainQuery = <T>(
  operation: QueryOperation,
  args?: Record<string, unknown>,
  perspective?: Perspective,
) => Promise<T>;
export type Go = (entityId: string, revisionId?: string) => void;
export type Report = (error: unknown) => void;

export function useData<T>(
  query: DomainQuery,
  operation: QueryOperation,
  report: Report,
) {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    let current = true;
    setValue(undefined);
    void query<T>(operation)
      .then((data) => {
        if (current) setValue(data);
      })
      .catch((error) => {
        if (current) report(error);
      });
    return () => {
      current = false;
    };
  }, [operation, query, report]);
  return value;
}
export const key = (value: SnapshotTarget) =>
  value.entity_id + "/" + value.revision_id;
export function Pin({
  target,
  choose,
  children,
}: {
  target: SnapshotTarget;
  choose: Go;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className="secondary-button domain-pin"
      onClick={() => choose(target.entity_id, target.revision_id)}
    >
      {children ?? key(target)}
    </button>
  );
}

export function Mode({
  value,
  onChange,
}: {
  value: ContentMode;
  onChange: (mode: ContentMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <label>
      {t("domain.mode")}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as ContentMode)}
      >
        <option value="confirmed">{t("domain.confirmed")}</option>
        <option value="working">{t("domain.working")}</option>
      </select>
    </label>
  );
}
