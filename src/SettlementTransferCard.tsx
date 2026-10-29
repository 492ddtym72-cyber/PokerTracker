import { PlayerAvatar } from "./PlayerAvatar";
import { formatMoney } from "./lib/money";
import { t } from "./i18n";
import type { SettlementPlanTransfer, SettlementSuggestion } from "./types";

export type PaymentWallet = "paypal" | "revolut";

const PAYPAL_MARK_URL = "https://www.paypalobjects.com/paypal-ui/logos/svg/paypal-mark-color.svg";
const REVOLUT_WORDMARK_URL = "https://assets.revolut.com/Brand/Retail/Logos/Wordmark/Revolut_Black.svg";

/** One presentation for Riga, named ledgers and separate sessions. Ledger writes stay scoped in the caller. */
export function SettlementTransferCard({
  transfer, currentPlayerId, photoFor, onCopy, onWallet, onRecord, onRequest,
  copied = false, copying = false, openingApp = null, disabled = false,
}: {
  transfer: SettlementPlanTransfer;
  currentPlayerId: string | null;
  photoFor: (id: string) => string | null;
  onCopy: (remaining: SettlementSuggestion) => void;
  onWallet: (remaining: SettlementSuggestion, app: PaymentWallet) => void;
  onRecord: (remaining: SettlementSuggestion) => void;
  onRequest?: (remaining: SettlementSuggestion) => void;
  copied?: boolean;
  copying?: boolean;
  openingApp?: PaymentWallet | null;
  disabled?: boolean;
}) {
  const isPaid = transfer.remainingCents <= 0;
  const remaining = { ...transfer, amountCents: transfer.remainingCents };
  const canPay = !currentPlayerId || transfer.fromPlayerId === currentPlayerId;
  const isPersonal = !!currentPlayerId &&
    (transfer.fromPlayerId === currentPlayerId || transfer.toPlayerId === currentPlayerId);

  return (
    <article className={"settlement-payment-card" + (isPaid ? " is-paid" : "") + (isPersonal ? " is-personal" : "")}>
      <div className="settlement-payment-flow">
        <div className="settlement-flow-player">
          <PlayerAvatar className={"settlement-flow-avatar settlement-flow-avatar-payer" +
            (transfer.fromPlayerId === currentPlayerId ? " is-me" : "")}
            name={transfer.fromPlayerName} photo={photoFor(transfer.fromPlayerId)} />
          <strong>{transfer.fromPlayerId === currentPlayerId ? t("Du") : transfer.fromPlayerName}</strong>
          <small>{t("Zahlt")}</small>
        </div>
        <div className="settlement-flow-direction" aria-hidden="true">
          <span className="settlement-flow-arrow">→</span>
        </div>
        <div className="settlement-flow-player">
          <PlayerAvatar className={"settlement-flow-avatar settlement-flow-avatar-receiver" +
            (transfer.toPlayerId === currentPlayerId ? " is-me" : "")}
            name={transfer.toPlayerName} photo={photoFor(transfer.toPlayerId)} />
          <strong>{transfer.toPlayerId === currentPlayerId ? t("Du") : transfer.toPlayerName}</strong>
          <small>{t("Erhält")}</small>
        </div>
      </div>

      <div className="settlement-payment-amount">
        <strong>{formatMoney(transfer.amountCents)}</strong>
        {!isPaid && <button type="button" className={"settlement-copy-button" + (copied ? " is-copied" : "")}
          aria-label={copied ? t("Betrag kopiert") : t("Betrag kopieren")}
          disabled={copying || disabled} onClick={() => onCopy(remaining)}>
          {copied ? (
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5.5 12.5 4.1 4.1L18.7 7.5" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="8" y="8" width="10" height="10" rx="2" />
              <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2 2h8a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>}
        {isPaid ? <small className="settlement-transfer-state">✓ {t("gezahlt")}</small> :
          transfer.paidCents > 0 ? <small className="settlement-transfer-state">
            {formatMoney(transfer.remainingCents)} {t("zu zahlen")}
          </small> : null}
      </div>

      {!isPaid && !disabled && <div className={"settlement-payment-actions" + (canPay ? "" : " single-action")}>
        {canPay && <div className="settlement-wallet-actions">
          <button className="paypal-payment-button" type="button" disabled={openingApp === "paypal"}
            onClick={() => onWallet(remaining, "paypal")}>
            <img src={PAYPAL_MARK_URL} alt="" aria-hidden="true" />
            <span>{openingApp === "paypal" ? "…" : "PayPal"}</span>
          </button>
          <button className="revolut-payment-button" type="button" disabled={openingApp === "revolut"}
            onClick={() => onWallet(remaining, "revolut")}>
            <img src={REVOLUT_WORDMARK_URL} alt="Revolut" />
          </button>
        </div>}
        {currentPlayerId === transfer.toPlayerId && onRequest && (
          <button type="button" className="settlement-request-button" onClick={() => onRequest(remaining)}>
            {t("Anfordern")}
          </button>
        )}
        <button type="button" className="settlement-record-button" onClick={() => onRecord(remaining)}>
          {t("Zahlung eintragen")}
        </button>
      </div>}
    </article>
  );
}
