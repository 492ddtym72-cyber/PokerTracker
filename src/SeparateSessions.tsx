import { useEffect, useMemo, useRef, useState } from "react";
import { getLocale, t } from "./i18n";
import { loadSessionSettlement } from "./lib/api";
import { formatMoney } from "./lib/money";
import { getSeparateSessions } from "./lib/separateSessions";
import { SessionSettlement } from "./SessionSettlement";
import { SettlementCard } from "./SettlementCard";
import type { PokerNight, SettlementResponse, PlayerProfile } from "./types";

type SessionAmount =
  | { status: "ready"; outstandingCents: number; differenceCents: number }
  | { status: "error" };

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
  playerProfiles,
}: {
  nights: PokerNight[];
  currentPlayerId: string | null;
  photoFor: (playerId: string) => string | null;
  playerProfiles: PlayerProfile[];
}) {
  const sessions = useMemo(() => getSeparateSessions(nights), [nights]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, SessionAmount>>({});
  const versions = useRef<Record<string, number>>({});

  function updateAmount(id: string, snapshot: SettlementResponse) {
    versions.current[id] = (versions.current[id] ?? 0) + 1;
    setAmounts((current) => ({
      ...current,
      [id]: {
        status: "ready",
        outstandingCents: snapshot.totalOutstandingCents,
        differenceCents: snapshot.groupDifferenceCents,
      },
    }));
  }

  useEffect(() => {
    let active = true;
    for (const night of sessions) {
      if (night.status !== "completed") continue;
      const version = (versions.current[night.id] ?? 0) + 1;
      versions.current[night.id] = version;
      loadSessionSettlement(night.id)
        .then((snapshot) => {
          if (active && versions.current[night.id] === version) {
            setAmounts((current) => ({
              ...current,
              [night.id]: {
                status: "ready",
                outstandingCents: snapshot.totalOutstandingCents,
                differenceCents: snapshot.groupDifferenceCents,
              },
            }));
          }
        })
        .catch(() => {
          if (active && versions.current[night.id] === version) {
            setAmounts((current) => ({ ...current, [night.id]: { status: "error" } }));
          }
        });
    }
    return () => { active = false; };
  }, [sessions]);

  // Render cards directly beside the named lists: the settlement type is an
  // accounting detail, not a separate visual hierarchy.
  return (
    <>
      {sessions.map((night) => {
        const completed = night.status === "completed";
        const expanded = completed && openId === night.id;
        const summary = amounts[night.id];
        const amount = !completed
          ? t("Läuft")
          : summary?.status === "ready" && summary.differenceCents === 0
            ? formatMoney(summary.outstandingCents)
            : "—";
        return (
          <SettlementCard
            key={night.id}
            title={night.title}
            meta={sessionDate(night.playedAt) + " · " + night.players.length + " " + t("Spieler")}
            amount={amount}
            expanded={expanded}
            panelId={"separate-session-" + night.id}
            disabled={!completed}
            onToggle={() => setOpenId(expanded ? null : night.id)}
          >
            <SessionSettlement
              nightId={night.id}
              currentPlayerId={currentPlayerId}
              photoFor={photoFor}
              playerProfiles={playerProfiles}
              onDataChange={(snapshot) => updateAmount(night.id, snapshot)}
            />
          </SettlementCard>
        );
      })}
    </>
  );
}
