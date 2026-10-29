import { getLocale, t } from "./i18n";
import { formatMoney } from "./lib/money";
import { playerPaymentStatus } from "./lib/settlementPresentation";
import { PlayerAvatar } from "./PlayerAvatar";
import type { SettlementPlayer } from "./types";

export function signedPokerResult(cents: number): string {
  return (cents > 0 ? "+" : "") + formatMoney(cents);
}

/** Concise payout state; never derives the poker result from outstanding transfers. */
export function playerPaymentCaption(player: SettlementPlayer): string {
  const status = playerPaymentStatus(player);
  switch (status.kind) {
    case "received": return t("erhalten");
    case "to_receive": return t("zu bekommen");
    case "part_receive": return formatMoney(status.remainingCents) + " " + t("noch zu bekommen");
    case "paid": return t("bezahlt");
    case "to_pay": return t("zu zahlen");
    case "part_pay": return formatMoney(status.remainingCents) + " " + t("noch zu zahlen");
    case "neutral": return "";
  }
}

/** Original per-player results stay visible after every transfer is marked paid. */
export function SettlementPlayerResults({
  players, currentPlayerId, photoFor,
}: {
  players: readonly SettlementPlayer[];
  currentPlayerId: string | null;
  photoFor: (playerId: string) => string | null;
}) {
  const ordered = [...players].sort((a,b) =>
    Number(b.id === currentPlayerId) - Number(a.id === currentPlayerId) ||
    b.pokerBalanceCents - a.pokerBalanceCents ||
    a.name.localeCompare(b.name, getLocale())
  );
  return (
    <section className="settlement-player-results">
      <div className="section-title-row named-ledger-history-title">
        <h3>{t("Ergebnisse")}</h3><span>{players.length}</span>
      </div>
      <div className="settlement-balance-list">
        {ordered.map(player => (
          <article key={player.id} className={player.id === currentPlayerId ? "is-current-player" : ""}>
            <PlayerAvatar name={player.name} photo={photoFor(player.id)} />
            <div className="settlement-result-player"><strong>{player.name}</strong></div>
            <div className="settlement-result-figure">
              <b className={player.pokerBalanceCents > 0 ? "positive" : player.pokerBalanceCents < 0 ? "negative" : ""}>
                {signedPokerResult(player.pokerBalanceCents)}
              </b>
              {playerPaymentCaption(player) && <small>{playerPaymentCaption(player)}</small>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
