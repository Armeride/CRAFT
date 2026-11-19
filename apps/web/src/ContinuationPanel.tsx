import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "./api.js";
import type { ResumeContext } from "../../../packages/tasks/src/resume-contracts.js";
import type {
  ExternalProfile,
  SkillSelection,
} from "../../../packages/agent-core/src/phase7-contracts.js";

const notesKeys = ["decisions", "openQuestions", "nextActions"] as const;
type NotesKey = (typeof notesKeys)[number];

export function useContinuation(
  runId: string,
  report: (error: unknown) => void,
) {
  const [context, setContext] = useState<ResumeContext | null>(null);
  const [skills, setSkills] = useState<SkillSelection[]>([]);
  const [selection, setSelection] = useState<string[] | undefined>();
  const [profiles, setProfiles] = useState<ExternalProfile[]>([]);
  const [profile, setProfile] = useState("");
  const [acknowledged, setAcknowledged] = useState("");
  const path = `/api/runs/${runId}/continuation`;
  useEffect(() => {
    let active = true;
    setContext(null);
    setSelection(undefined);
    setAcknowledged("");
    setProfile("");
    void Promise.all([
      api<ResumeContext>(path),
      api<SkillSelection[]>(`/api/runs/${runId}/skills`),
      api<ExternalProfile[]>("/api/mcp-profiles"),
    ])
      .then(([summary, skillOptions, connections]) => {
        if (!active) return;
        setContext(summary);
        setSkills(skillOptions);
        setProfiles(connections);
      })
      .catch((error) => {
        if (active) report(error);
      });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (id && id !== runId) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        void api<ResumeContext>(path)
          .then((value) => {
            if (active) setContext(value);
          })
          .catch(() => {});
      }, 150);
    };
    window.addEventListener("craft:task-change", refresh);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener("craft:task-change", refresh);
    };
  }, [runId, path, report]);
  return {
    context,
    setContext,
    skills,
    selection,
    setSelection,
    profiles,
    setProfiles,
    profile,
    setProfile,
    path,
    acknowledged,
    setAcknowledged,
    ready:
      !!context &&
      (!context.changedInputs.length || acknowledged === context.currentTarget),
    input: {
      ...(selection ? { skillKeys: selection } : {}),
      ...(profile ? { externalProfileId: profile } : {}),
      ...(acknowledged ? { resumeTarget: acknowledged } : {}),
    },
  };
}

function ProfileForm({
  onSave,
  report,
  disabled,
}: {
  onSave: (item: ExternalProfile) => void;
  report: (error: unknown) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <details className="phase-seven">
      <summary>{t("resume.configure")}</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const rows = String(form.get("tools") ?? "")
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
          const tools = rows.map((line) =>
            /^(read|write):([A-Za-z0-9_.-]{1,128})$/.exec(line),
          );
          if (tools.some((tool) => !tool)) {
            report(new ApiError("EXTERNAL_PROFILE_INVALID", {}));
            return;
          }
          const credentialRef = String(form.get("credentialRef") ?? "").trim();
          const jobStatusTool = String(form.get("jobStatusTool") ?? "").trim();
          setBusy(true);
          setSaved(false);
          void api<ExternalProfile>("/api/mcp-profiles", {
            id: form.get("id"),
            label: form.get("label"),
            endpoint: form.get("endpoint"),
            tools: tools.map((tool) => ({ effect: tool![1], name: tool![2] })),
            ...(credentialRef ? { credentialRef } : {}),
            ...(jobStatusTool ? { jobStatusTool } : {}),
          })
            .then((result) => {
              onSave(result);
              setSaved(true);
            })
            .catch(report)
            .finally(() => setBusy(false));
        }}
      >
        <fieldset disabled={disabled || busy}>
          <label>
            {t("resume.profileId")}
            <input name="id" required pattern="[a-z][a-z0-9-]{0,47}" />
          </label>
          <label>
            {t("resume.profileLabel")}
            <input name="label" required maxLength={120} />
          </label>
          <label>
            {t("resume.endpoint")}
            <input name="endpoint" type="url" required maxLength={2048} />
          </label>
          <label>
            {t("resume.credential")}
            <input
              name="credentialRef"
              placeholder="env:CRAFT_MCP_SECRET_EXAMPLE"
              maxLength={110}
            />
          </label>
          <label>
            {t("resume.allowlist")}
            <textarea name="tools" required maxLength={3900} />
          </label>
          <p>{t("resume.allowHint")}</p>
          <label>
            {t("resume.jobStatusTool")}
            <input name="jobStatusTool" maxLength={128} />
          </label>
          <button type="submit" className="secondary-button">
            {t("resume.profileSave")}
          </button>
        </fieldset>
      </form>
      {saved && <p role="status">{t("resume.profileSaved")}</p>}
    </details>
  );
}

export function ContinuationPanel({
  preparation,
  report,
  disabled,
}: {
  preparation: ReturnType<typeof useContinuation>;
  report: (error: unknown) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const { context, selection, acknowledged } = preparation;
  const [notes, setNotes] = useState<Partial<Record<NotesKey, string>>>({});
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notesBase, setNotesBase] = useState<string | null>(null);
  if (!context) return null;
  return (
    <details
      className="phase-seven"
      open={context.changedInputs.length > 0 || undefined}
    >
      <summary>{t("resume.title")}</summary>
      <p>
        <strong>{t("resume.goal")}</strong> {context.goal}
      </p>
      {context.acceptance.length > 0 && (
        <p>
          <strong>{t("resume.acceptance")}</strong>{" "}
          {context.acceptance.join(" / ")}
        </p>
      )}
      <p>{context.checkpointSummary}</p>
      <small>
        {t("resume.basis")} <code>{context.originalBasis}</code>
      </small>
      {context.changedInputs.length > 0 && (
        <section>
          <p>
            {t("resume.current")} <code>{context.currentTarget}</code>
          </p>
          <p>{t("resume.changes")}</p>
          <ul>
            {context.changedInputs.map((change) => (
              <li key={change.entityId}>
                <code>
                  {change.entityId} {change.preservedRevision ?? "—"} →{" "}
                  {change.currentRevision ?? "—"}
                </code>
              </li>
            ))}
          </ul>
          <label>
            <input
              type="checkbox"
              checked={acknowledged === context.currentTarget}
              disabled={disabled}
              onChange={(event) =>
                preparation.setAcknowledged(
                  event.target.checked ? context.currentTarget : "",
                )
              }
            />
            {t("resume.ack")}
          </label>
        </section>
      )}
      {context.previous && (
        <details>
          <summary>
            {t("resume.previous")} · {context.previous.provider}
          </summary>
          <p>
            {t("agent.state." + context.previous.state, {
              defaultValue: context.previous.state,
            })}
          </p>
          {context.previous.code && (
            <p>
              {t("errors." + context.previous.code, {
                defaultValue: context.previous.code,
              })}
            </p>
          )}
          <p>{context.previous.prompt}</p>
          <p>{context.previous.result}</p>
        </details>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setSaved(false);
          const parsed = Object.fromEntries(
            notesKeys.map((key) => [
              key,
              (notes[key] ?? context[key].join("\n"))
                .split(/\r?\n/)
                .map((value) => value.trim())
                .filter(Boolean),
            ]),
          );
          void api<ResumeContext>(
            preparation.path,
            {
              ...parsed,
              expectedDigest: Object.keys(notes).length
                ? notesBase
                : context.notesDigest,
            },
            "PUT",
          )
            .then((value) => {
              preparation.setContext(value);
              setNotes({});
              setSaved(true);
            })
            .catch(report)
            .finally(() => setBusy(false));
        }}
      >
        <fieldset disabled={busy || disabled}>
          {notesKeys.map((key) => (
            <label key={key}>
              {t("resume." + key)}
              <textarea
                value={notes[key] ?? context[key].join("\n")}
                maxLength={45000}
                onChange={(event) => {
                  if (!Object.keys(notes).length)
                    setNotesBase(context.notesDigest);
                  setSaved(false);
                  setNotes({ ...notes, [key]: event.target.value });
                }}
              />
            </label>
          ))}
          <button
            className="secondary-button"
            type="submit"
            disabled={!Object.keys(notes).length}
          >
            {t("resume.save")}
          </button>
        </fieldset>
      </form>
      {saved && <p role="status">{t("resume.saved")}</p>}
      <fieldset disabled={disabled}>
        <legend>{t("resume.skills")}</legend>
        <label>
          <input
            type="checkbox"
            checked={!selection}
            onChange={(event) =>
              preparation.setSelection(event.target.checked ? undefined : [])
            }
          />
          {t("resume.reuse")}
        </label>
        {!selection && context.skillPins.length > 0 && (
          <ul>
            {context.skillPins.map((pin) => (
              <li key={pin.id}>
                <code>
                  {pin.id} · {pin.version} · {pin.digest}
                </code>
              </li>
            ))}
          </ul>
        )}
        {preparation.skills.some((skill) => skill.origin === "user") && (
          <p>{t("resume.archiveUserSkill")}</p>
        )}
        {preparation.skills.map((skill) => (
          <div key={skill.key}>
            <label>
              <input
                type="checkbox"
                disabled={!selection}
                checked={selection?.includes(skill.key) ?? false}
                onChange={(event) => {
                  const known = selection ?? [];
                  if (event.target.checked && known.length >= 5) {
                    report(new ApiError("SKILL_INVALID", {}));
                    return;
                  }
                  preparation.setSelection(
                    event.target.checked
                      ? [...known, skill.key]
                      : known.filter((key) => key !== skill.key),
                  );
                }}
              />
              {skill.id} · {skill.version} ·{" "}
              {t("resume.origin." + skill.origin)}
            </label>
            <details>
              <summary>{t("common.details")}</summary>
              <pre>{skill.content}</pre>
              <code>{skill.digest}</code>
            </details>
          </div>
        ))}
      </fieldset>
      <label>
        {t("resume.profiles")}
        <select
          value={preparation.profile}
          disabled={disabled}
          onChange={(event) => preparation.setProfile(event.target.value)}
        >
          <option value="">{t("resume.off")}</option>
          {preparation.profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.label} · {profile.endpoint}
            </option>
          ))}
        </select>
      </label>
      <ProfileForm
        disabled={disabled}
        onSave={(profile) =>
          preparation.setProfiles([
            ...preparation.profiles.filter((item) => item.id !== profile.id),
            profile,
          ])
        }
        report={report}
      />
      {context.external.length > 0 && (
        <section>
          <p>{t("resume.operations")}</p>
          <ul>
            {context.external.map((operation) => (
              <li key={operation.operation_id}>
                {t("resume." + operation.state)}{" "}
                <code>{operation.operation_id}</code>
                {operation.job_id && (
                  <>
                    {" "}
                    · {t("resume.job")} <code>{operation.job_id}</code>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </details>
  );
}
