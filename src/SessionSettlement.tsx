import { useEffect, useState } from "react";
import { loadSessionSettlement, recordSessionPayment, voidSessionPayment } from "./lib/api";
import { formatMoney, parseMoney } from "./lib/money";
import { SettlementFlow } from "./SettlementFlow";
import { SettlementBalanceHero } from "./SettlementBalanceHero";
import { SettlementViewToggle, type SettlementView } from "./SettlementViewToggle";
import { personalSettlementPlayer } from "./lib/settlementPresentation";
import { SettlementPlayerResults } from "./SettlementPlayerResults";
import { t } from "./i18n";
import { SettlementTransferCard } from "./SettlementTransferCard";
import { useSettlementWallet, PaymentWalletFallback } from "./SettlementWallet";
import { PaymentRequestDialog } from "./PaymentRequestDialog";
import type { PlayerProfile, SettlementResponse, SettlementSuggestion } from "./types";
import "./sessionSettlement.css";

function localDate() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function SessionSettlement({
  nightId,
  currentPlayerId,
  photoFor,
  playerProfiles,
  onDataChange,
}: {
  nightId: string;
  currentPlayerId: string | null;
  photoFor: (playerId: string) => string | null;
  playerProfiles: PlayerProfile[];
  onDataChange?: (snapshot: SettlementResponse) => void;
}) {
  const [data, setData] = useState<SettlementResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<SettlementSuggestion | null>(null);
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(localDate);
  const [note, setNote] = useState("");
  const [requestDraft, setRequestDraft] = useState<SettlementSuggestion | null>(null);
  const [view, setView] = useState<SettlementView>("list");

  useEffect(() => {
    let live = true;
    setLoading(true);
    setData(null);
    setError("");
    loadSessionSettlement(nightId)
      .then(result => { if (live) setData(result); })
      .catch(err => { if (live) setError(err instanceof Error ? err.message : t("Abrechnung konnte nicht geladen werden.")); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [nightId]);

  async function refresh() {
    const updated = await loadSessionSettlement(nightId);
    setData(updated);
    onDataChange?.(updated);
  }
  const wallet = useSettlementWallet({kind: "session", id: nightId}, () => { void refresh().catch(() => undefined); });

  function selectTransfer(entry: SettlementSuggestion) {
    setSelected(entry);
    setAmount((entry.amountCents / 100).toFixed(2).replace(".", ","));
    setPaidAt(localDate());
    setNote("");
  }

  async function markPaid(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !selected) return;
    const cents = parseMoney(amount);
    if (cents === null || cents <= 0 || cents > selected.amountCents) {
      setError(t("Bitte einen Betrag bis zur offenen Summe angeben."));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const updated = await recordSessionPayment(nightId, {
        fromPlayerId: selected.fromPlayerId,
        toPlayerId: selected.toPlayerId,
        amountCents: cents,
        paidAt,
        note,
        clientToken: crypto.randomUUID(),
      });
      setData(updated);
      onDataChange?.(updated);
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Zahlung konnte nicht gespeichert werden."));
    } finally {
      setBusy(false);
    }
  }

  async function undoPayment(paymentId: string) {
    if (busy || !window.confirm(t("Diese Zahlung wirklich rückgängig machen?"))) return;
    setBusy(true);
    setError("");
    try {
      const updated = await voidSessionPayment(nightId, paymentId);
      setData(updated);
      onDataChange?.(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Zahlung konnte nicht storniert werden."));
    } finally {
      setBusy(false);
    }
  }

  // Payment plans remain frozen; the view switch never recalculates transfers.
  const pending = data?.suggestions ?? [];
  const diagramTransfers = data?.plan ?? [];
  const personalPlayer = data
    ? personalSettlementPlayer(data.players, currentPlayerId)
    : null;

  if (loading) return <section className="local-settlement"><p className="local-settlement-muted">{t("Lädt …")}</p></section>;

  return (
    <section className="local-settlement" aria-label={t("Session-Abrechnung")}>
      {personalPlayer && <SettlementBalanceHero player={personalPlayer} />}

      {data && data.groupDifferenceCents !== 0 && (
        <p className="local-settlement-error">{t("Die Session hat eine offene Differenz.")}</p>
      )}

      {data && (
        <div className="settlement-section-head local-settlement-view-head">
          <SettlementViewToggle view={view} onChange={setView} />
        </div>
      )}

      {data && data.groupDifferenceCents === 0 && diagramTransfers.length === 0 && (
        <p className="local-settlement-empty">{t("Alles beglichen")}</p>
      )}

      {view === "flow" && data && data.groupDifferenceCents === 0 && diagramTransfers.length > 0 && (
        <div className="local-settlement-diagram">
          <SettlementFlow
            suggestions={diagramTransfers}
            currentPlayerId={currentPlayerId}
            profilePhotoFor={photoFor}
            onSelect={(transfer) => {
              const remaining = "remainingCents" in transfer ? Number(transfer.remainingCents) : transfer.amountCents;
              if (remaining <= 0) return;
              selectTransfer({ ...transfer, amountCents: remaining });
              setView("list");
            }}
            note={pending.length === 0 ? t("Erfasste Zahlungen") : t("Offene Zahlungen")}
          />
        </div>
      )}

      {view === "list" && <div className="settlement-suggestion-list">
        {data?.plan.map((entry, index) => {
          const key = entry.fromPlayerId + ":" + entry.toPlayerId;
          return <SettlementTransferCard key={key + ":" + index}
            transfer={entry} currentPlayerId={currentPlayerId} photoFor={photoFor}
            onCopy={(remaining) => { void wallet.copy(remaining); }}
            onWallet={(remaining, app) => { void wallet.open(remaining, app); }}
            onRecord={selectTransfer}
            onRequest={currentPlayerId ? setRequestDraft : undefined}
            copied={wallet.copiedKey === key} copying={wallet.copyingKey === key}
            openingApp={wallet.openingKey === key + ":paypal" ? "paypal" :
              wallet.openingKey === key + ":revolut" ? "revolut" : null}
          />;
        })}
      </div>}

      {view === "list" && selected && (
        <form className="named-ledger-payment-form" onSubmit={markPaid}>
          <strong>{selected.fromPlayerName} → {selected.toPlayerName}</strong>
          <label>{t("Betrag")}
            <input required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} />
          </label>
          <label>{t("Datum")}
            <input type="date" required value={paidAt} onChange={event => setPaidAt(event.target.value)} />
          </label>
          <label>{t("Notiz (optional)")}
            <input maxLength={200} value={note} onChange={event => setNote(event.target.value)} />
          </label>
          <div className="payment-editor-actions">
            <button type="button" className="secondary-button" onClick={() => setSelected(null)}>
              {t("Abbrechen")}
            </button>
            <button type="submit" className="gold-cta" disabled={busy}>
              {busy ? t("Speichert …") : t("Zahlung speichern")}
            </button>
          </div>
        </form>
      )}

      {wallet.fallback && <PaymentWalletFallback fallback={wallet.fallback}
        onCancel={wallet.clearFallback} onContinue={() => { void wallet.continueFallback(); }} />}
      {wallet.error && <p className="local-settlement-error" role="alert">{wallet.error}</p>}

      {data && data.payments.length > 0 && (
        <div className="local-settlement-history">
          <h3>{t("Zahlungsverlauf")}</h3>
          {data.payments.map(payment => (
            <div className={"local-settlement-payment" + (payment.voidedAt ? " is-void" : "")} key={payment.id}>
              <span>{payment.fromPlayerName} → {payment.toPlayerName}</span>
              <strong>{formatMoney(payment.amountCents)}</strong>
              {payment.voidedAt ? <small>{t("Storniert")}</small> : (
                <button type="button" disabled={busy} onClick={() => void undoPayment(payment.id)}>{t("Rückgängig")}</button>
              )}
            </div>
          ))}
        </div>
      )}

      {error && <p className="local-settlement-error" role="alert">{error}</p>}
      {requestDraft && currentPlayerId === requestDraft.toPlayerId && <PaymentRequestDialog
        suggestion={requestDraft} currentPlayerId={currentPlayerId}
        profiles={playerProfiles} scope={{kind: "session", id: nightId}}
        onClose={() => setRequestDraft(null)} />}
    </section>
  );
}
