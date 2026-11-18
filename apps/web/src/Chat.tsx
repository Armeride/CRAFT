import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Draft } from "../../server/contracts.js";
import { Icon } from "./Icon.js";
import { AgentPanel } from "./AgentPanel.js";
export function Chat({
  draft,
  title,
  prompt,
  setPrompt,
  store,
  busy,
  swap,
  close,
  report,
  openRun,
}: {
  draft: Draft | undefined;
  title: string;
  prompt: string;
  setPrompt: (text: string) => void;
  store: (text: string, id: string) => Promise<boolean>;
  busy: boolean;
  swap: () => void;
  close: () => void;
  report: (error: unknown) => void;
  openRun: (id: string) => void;
}) {
  const { t, i18n } = useTranslation(),
    pending = useRef<{ text: string; id: string } | null>(null);
  const [connected, setConnected] = useState(false);
  async function submit() {
    const text = prompt.trim();
    if (!text || busy || !draft) return;
    if (!pending.current || pending.current.text !== text)
      pending.current = { text, id: crypto.randomUUID() };
    const id = pending.current.id;
    if (await store(text, id)) {
      setPrompt("");
      pending.current = null;
    }
  }
  return (
    <aside className="chat-panel" aria-label={t("chat.title")}>
      <header>
        <div>
          <Icon name="chat" />
          <h2>{t("chat.title")}</h2>
        </div>
        <div>
          <button
            className="icon-button"
            onClick={swap}
            aria-label={t("panel.swap")}
          >
            <Icon name="swap" />
          </button>
          <button
            className="icon-button"
            onClick={close}
            aria-label={t("panel.chatHide")}
          >
            <Icon name="close" />
          </button>
        </div>
      </header>
      <div className="chat-context">
        <span className="badge">{t("work.context")}</span>
        <strong>{title}</strong>
        <span className="connection-state">
          <span className="small-dot amber-dot" />
          {t(connected ? "agent.ready" : "chat.notConnected")}
        </span>
      </div>
      <div className="chat-history">
        <div className="chat-notice">
          <Icon name="spark" />
          <h3>{t("chat.welcome")}</h3>
          <p>{t(connected ? "agent.hint" : "chat.hint")}</p>
        </div>
        {draft && (
          <AgentPanel
            draft={draft}
            prompt={prompt}
            sent={() => setPrompt("")}
            connection={setConnected}
            report={report}
            openRun={openRun}
          />
        )}
        {draft?.requests.map((request) => (
          <article className="request-bubble" key={request.id}>
            <div>
              <strong>{t("chat.you")}</strong>
              <time dateTime={request.createdAt}>
                {new Intl.DateTimeFormat(i18n.resolvedLanguage, {
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date(request.createdAt))}
              </time>
            </div>
            <p>{request.text}</p>
            <small>
              <Icon name="check" size={13} />
              {t("chat.stored")}
            </small>
          </article>
        ))}
      </div>
      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <textarea
          aria-label={t("chat.prompt")}
          placeholder={t("chat.placeholder")}
          value={prompt}
          maxLength={12000}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <div>
          <span>
            {draft?.requests.length === 100
              ? t("chat.limit")
              : t(connected ? "agent.memoHint" : "chat.notConnected")}
          </span>
          <button
            className="primary-button"
            disabled={
              busy || !draft || !prompt.trim() || draft.requests.length >= 100
            }
          >
            <Icon name="save" size={15} />
            {t(busy ? "chat.storing" : "chat.store")}
          </button>
        </div>
      </form>
    </aside>
  );
}
