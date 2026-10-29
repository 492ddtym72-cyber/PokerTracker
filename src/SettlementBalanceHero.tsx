import { formatMoney } from "./lib/money";
import { t } from "./i18n";

/** Open balance in this one settlement: positive = receives, negative = pays. */
export function SettlementBalanceHero({ balanceCents }: { balanceCents: number }) {
  return (
    <section className="settlement-overview-card">
              <div className="settlement-overview-copy">
                <span className="settlement-overview-label">
                  {balanceCents > 0
                    ? t("Du bekommst")
                    : balanceCents < 0
                      ? t("Du zahlst")
                      : t("Alles ausgeglichen")}
                </span>
                <strong className={
                  "settlement-overview-value" +
                  (balanceCents > 0
                    ? " positive"
                    : balanceCents < 0
                      ? " negative"
                      : "")
                }>
                  {formatMoney(Math.abs(balanceCents))}
                </strong>
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
