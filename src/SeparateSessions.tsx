import { useMemo, useState } from "react";
import { getLocale, t } from "./i18n";
import { getSeparateSessions } from "./lib/separateSessions";
import { SessionSettlement } from "./SessionSettlement";
import type { PokerNight } from "./types";

function sessionDate(playedAt: string) {
  return new Date(playedAt + "T12:00:00").toLocaleDateString(getLocale(), {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function SeparateSessions({
  nights,
  currentPlayerId,
  photoFor,
}: {
  nights: PokerNight[];
  currentPlayerId: string | null;
  photoFor: (playerId: string) => string | null;
}) {
  const sessions = useMemo(() => getSeparateSessions(nights), [nights]);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <section className="settlement-section separate-sessions" aria-label={t("Separate Sessions")}>
      <div className="section-title-row">
        <h2>{t("Separate Sessions")}</h2>
        <span>{sessions.length}</span>
      </div>
      <p className="separate-sessions-intro">
        {t("Diese Sessions werden unabhängig von der Gesamtbilanz abgerechnet.")}
      </p>

      {sessions.length === 0 ? (
        <div className="settlement-empty-inline">{t("Noch keine separaten Sessions.")}</div>
      ) : (
        <div className="separate-session-list">
          {sessions.map((night) => {
            const completed = night.status === "completed";
            const expanded = completed && openId === night.id;
            const panelId = "separate-session-" + night.id;
            return (
              <article className={"separate-session-item" + (expanded ? " is-expanded" : "")} key={night.id}>
                <button
                  type="button"
                  className="separate-session-trigger"
                  disabled={!completed}
                  aria-expanded={completed ? expanded : undefined}
                  aria-controls={completed ? panelId : undefined}
                  onClick={() => setOpenId(expanded ? null : night.id)}
                >
                  <span className="separate-session-symbol" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
                      <rect x="4" y="5" width="13" height="16" rx="2" />
                      <path d="M8 9h5M8 12h5M18 3l3 4-3 4-3-4 3-4Z" />
                    </svg>
                  </span>
                  <span className="separate-session-label">
                    <strong>{night.title}</strong>
                    <small>{sessionDate(night.playedAt)} · {night.players.length} {t("Spieler")}</small>
                  </span>
                  {!completed && <span className="separate-session-state">{t("Läuft")}</span>}
                  {completed && <span className={"separate-session-chevron" + (expanded ? " is-open" : "")} aria-hidden="true">⌄</span>}
                </button>
                {expanded && (
                  <div className="separate-session-detail" id={panelId}>
                    <SessionSettlement
                      key={night.id}
                      nightId={night.id}
                      currentPlayerId={currentPlayerId}
                      photoFor={photoFor}
                    />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
