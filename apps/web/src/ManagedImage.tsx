import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Draft } from "../../server/contracts.js";
import { api, ApiError } from "./api.js";

export type ImageScope = { runId: string } | { projectId: string };
export const matchImage = (line: string) =>
  /^!\[([^\]\r\n]{1,200})\]\(assets\/craft\/([a-f0-9]{64})\.png\)$/.exec(line);

export function ManagedImage({
  scope,
  digest,
  alt,
}: {
  scope: ImageScope;
  digest: string;
  alt: string;
}) {
  const { t } = useTranslation();
  const path =
    ("runId" in scope
      ? `/api/runs/${scope.runId}`
      : `/api/projects/${scope.projectId}`) +
    "/images/" +
    digest;
  const [loaded, setLoaded] = useState<{
    path: string;
    base64: string | null;
  }>();
  useEffect(() => {
    let live = true;
    void api<{ base64: string }>(path)
      .then((value) => {
        if (live) setLoaded({ path, base64: value.base64 });
      })
      .catch(() => {
        if (live) setLoaded({ path, base64: null });
      });
    return () => {
      live = false;
    };
  }, [path]);
  if (loaded?.path !== path)
    return (
      <p>
        {t("common.loading")} {alt}
      </p>
    );
  return loaded.base64 ? (
    <figure className="managed-image">
      <img src={"data:image/png;base64," + loaded.base64} alt={alt} />
    </figure>
  ) : (
    <p>
      {t("resume.assetMissing")} {alt}
    </p>
  );
}

export function AttachImage({
  draft,
  disabled,
  report,
}: {
  draft: Draft;
  disabled: boolean;
  report: (error: unknown) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <details className="phase-seven">
      <summary>{t("resume.attachments")}</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const fields = new FormData(form);
          const file = fields.get("image");
          const alt = String(fields.get("alt") ?? "");
          if (
            !(file instanceof File) ||
            file.size > 256 * 1024 ||
            file.size === 0
          ) {
            report(new ApiError("ASSET_INVALID", {}));
            return;
          }
          setBusy(true);
          void file
            .arrayBuffer()
            .then((bytes) => {
              const base64 = btoa(
                Array.from(new Uint8Array(bytes), (byte) =>
                  String.fromCharCode(byte),
                ).join(""),
              );
              return api(`/api/runs/${draft.runId}/images`, {
                base64,
                alt,
                expectedDigest: draft.digest,
              });
            })
            .then(() => form.reset())
            .catch(report)
            .finally(() => setBusy(false));
        }}
      >
        <fieldset disabled={disabled || busy}>
          <label>
            {t("resume.file")}
            <input name="image" type="file" accept="image/png,.png" required />
          </label>
          <label>
            {t("resume.alt")}
            <input name="alt" type="text" maxLength={200} required />
          </label>
          <button type="submit" className="secondary-button">
            {t("resume.attach")}
          </button>
        </fieldset>
      </form>
    </details>
  );
}
