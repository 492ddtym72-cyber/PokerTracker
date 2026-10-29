import { signedPokerResult, playerPaymentCaption } from "./SettlementPlayerResults";
import type { SettlementPlayer } from "./types";

/** The main figure is the immutable poker result, not the remaining payment. */
export function SettlementBalanceHero({ player }: { player: SettlementPlayer }) {
  const caption = playerPaymentCaption(player);
  return (
    <section className="settlement-overview-card">
      <div className="settlement-overview-copy">
        <strong className={
          "settlement-overview-value" +
          (player.pokerBalanceCents > 0 ? " positive" : player.pokerBalanceCents < 0 ? " negative" : "")
        }>
          {signedPokerResult(player.pokerBalanceCents)}
        </strong>
        {caption && <span className="settlement-overview-label">{caption}</span>}
      </div>
            <svg
              className="settlement-overview-chip"
              viewBox="0 0 120 120"
              aria-hidden="true"
              focusable="false"
            >
              <circle cx="60" cy="60" r="53" fill="#071b15" stroke="#315942" strokeWidth="5" />
              <circle cx="60" cy="60" r="47" fill="#103b2a" stroke="#528768" strokeWidth="1.5" />
              <g stroke="#8adaaa" strokeWidth="9" opacity=".6">
                <path d="M60 10v13M60 97v13M10 60h13M97 60h13M24 24l9 9M87 87l9 9M24 96l9-9M87 33l9-9" />
              </g>
              <circle cx="60" cy="60" r="34" fill="#092b1f" stroke="#45765b" strokeWidth="2" />
              <circle cx="60" cy="60" r="29" fill="none" stroke="#194b34" strokeWidth="2" />
              <g fill="#82d69d">
                <circle cx="60" cy="47" r="8" />
                <circle cx="51" cy="59" r="8" />
                <circle cx="69" cy="59" r="8" />
                <path d="M57.7 61h4.6c.1 10 2 15 7 19H50.7c5-4 7-9 7-19Z" />
              </g>
            </svg>
            </section>
  );
}
