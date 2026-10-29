import { useEffect, useState } from "react";
import { loadSessionSettlement, recordSessionPayment, voidSessionPayment } from "./lib/api";
import { formatMoney } from "./lib/money";
import { SettlementFlow } from "./SettlementFlow";
import { SettlementBalanceHero } from "./SettlementBalanceHero";
import { SettlementViewToggle, type SettlementView } from "./SettlementViewToggle";
import { personalSettlementBalance } from "./lib/settlementPresentation";
import { t } from "./i18n";
import { PlayerAvatar } from "./PlayerAvatar";
import type { SettlementResponse, SettlementSuggestion } from "./types";
import "./sessionSettlement.css";

function localDate() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function SessionSettlement({
  nightId,
  currentPlayerId,
  photoFor,
  onDataChange,
}: {
  nightId: string;
  currentPlayerId: string | null;
  photoFor: (playerId: string) => string | null;
  onDataChange?: (snapshot: SettlementResponse) => void;
}) {
  const [data, setData] = useState<SettlementResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
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

  const keyFor = (entry: SettlementSuggestion) => entry.fromPlayerId + ":" + entry.toPlayerId;

  async function markPaid(entry: SettlementSuggestion) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const updated = await recordSessionPayment(nightId, {
        fromPlayerId: entry.fromPlayerId,
        toPlayerId: entry.toPlayerId,
        amountCents: entry.amountCents,
        paidAt: localDate(),
        clientToken: crypto.randomUUID(),
      });
      setData(updated);
      onDataChange?.(updated);
      setConfirmKey(null);
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

  async function copyAmount(entry: SettlementSuggestion) {
    const key = keyFor(entry);
    try {
      await navigator.clipboard.writeText((entry.amountCents / 100).toFixed(2).replace(".", ","));
      setCopiedKey(key);
    } catch {
      setError(t("Betrag konnte nicht kopiert werden."));
    }
  }

  // Payment plans remain frozen; the view switch never recalculates transfers.
  const pending = data?.suggestions ?? [];
  const diagramTransfers = data?.plan ?? [];
  const personalBalance = data
    ? personalSettlementBalance(data.players, currentPlayerId)
    : null;

  if (loading) return <section className="local-settlement"><p className="local-settlement-muted">{t("Lädt …")}</p></section>;

  return (
    <section className="local-settlement" aria-label={t("Session-Abrechnung")}>
      {personalBalance !== null && <SettlementBalanceHero balanceCents={personalBalance} />}

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
              setConfirmKey(keyFor(transfer));
              setView("list");
            }}
            note={pending.length === 0 ? t("Erfasste Zahlungen") : t("Offene Zahlungen")}
          />
        </div>
      )}

      {view === "list" && (
      <div className="local-settlement-transfers">
        {data?.plan.map(entry => {
          const key = keyFor(entry);
          const isPaid = entry.remainingCents === 0;
          const openTransfer = { ...entry, amountCents: entry.remainingCents };
          const isConfirming = confirmKey === key;
          return (
            <article className="local-settlement-transfer" key={key}>
              <div className="local-settlement-people">
                <div className="local-settlement-person">
                  <PlayerAvatar className="local-settlement-avatar" name={entry.fromPlayerName} photo={photoFor(entry.fromPlayerId)} />
                  <span>{entry.fromPlayerId === currentPlayerId ? t("Du") : entry.fromPlayerName}</span>
                </div>
                <span className="local-settlement-arrow" aria-hidden="true">→</span>
                <div className="local-settlement-person">
                  <PlayerAvatar className="local-settlement-avatar" name={entry.toPlayerName} photo={photoFor(entry.toPlayerId)} />
                  <span>{entry.toPlayerId === currentPlayerId ? t("Du") : entry.toPlayerName}</span>
                </div>
                <strong className="local-settlement-amount">{formatMoney(entry.amountCents)}</strong>
              </div>
              <div className="local-settlement-actions">
                {isPaid ? <small className="settlement-transfer-state">✓ {t("gezahlt")}</small> : <>
                <button type="button" onClick={() => void copyAmount(openTransfer)} disabled={busy}>
                  {copiedKey === key ? t("Betrag kopiert") : t("Betrag kopieren")}
                </button>
                {isConfirming ? (
                  <>
                    <button type="button" onClick={() => setConfirmKey(null)} disabled={busy}>{t("Abbrechen")}</button>
                    <button type="button" className="local-settlement-primary" onClick={() => void markPaid(openTransfer)} disabled={busy}>
                      {busy ? t("Speichert …") : t("Zahlung bestätigen")}
                    </button>
                  </>
                ) : (
                  <button type="button" className="local-settlement-primary" onClick={() => setConfirmKey(key)} disabled={busy}>
                    {t("Als bezahlt markieren")}
                  </button>
                )}
                </>}
              </div>
            </article>
          );
        })}
      </div>
      )}

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
    </section>
  );
}
