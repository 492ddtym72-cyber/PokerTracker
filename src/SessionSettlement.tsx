import { useEffect, useState } from "react";
import { loadSessionSettlement, recordSessionPayment, voidSessionPayment } from "./lib/api";
import { formatMoney } from "./lib/money";
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
}: {
  nightId: string;
  currentPlayerId: string | null;
  photoFor: (playerId: string) => string | null;
}) {
  const [data, setData] = useState<SettlementResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

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
      setData(await voidSessionPayment(nightId, paymentId));
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

  if (loading) return <section className="local-settlement"><p className="local-settlement-muted">{t("Lädt …")}</p></section>;

  return (
    <section className="local-settlement" aria-label={t("Session-Abrechnung")}>
      <header className="local-settlement-heading">
        <div>
          <span className="local-settlement-kicker">{t("Nur diese Session")}</span>
          <h2>{t("Wer zahlt wem?")}</h2>
        </div>
        {data && <strong className="local-settlement-total">{formatMoney(data.totalOutstandingCents)}</strong>}
      </header>

      {data && data.groupDifferenceCents !== 0 && (
        <p className="local-settlement-error">{t("Die Session hat eine offene Differenz.")}</p>
      )}
      {data && data.groupDifferenceCents === 0 && data.suggestions.length === 0 && (
        <p className="local-settlement-empty">{t("Alles beglichen")}</p>
      )}

      <div className="local-settlement-transfers">
        {data?.suggestions.map(entry => {
          const key = keyFor(entry);
          const isConfirming = confirmKey === key;
          return (
            <article className="local-settlement-transfer" key={key}>
              <div className="local-settlement-people">
                <div className="local-settlement-person">
                  <PlayerAvatar name={entry.fromPlayerName} photo={photoFor(entry.fromPlayerId)} />
                  <span>{entry.fromPlayerId === currentPlayerId ? t("Du") : entry.fromPlayerName}</span>
                </div>
                <span className="local-settlement-arrow" aria-hidden="true">→</span>
                <div className="local-settlement-person">
                  <PlayerAvatar name={entry.toPlayerName} photo={photoFor(entry.toPlayerId)} />
                  <span>{entry.toPlayerId === currentPlayerId ? t("Du") : entry.toPlayerName}</span>
                </div>
                <strong className="local-settlement-amount">{formatMoney(entry.amountCents)}</strong>
              </div>
              <div className="local-settlement-actions">
                <button type="button" onClick={() => void copyAmount(entry)} disabled={busy}>
                  {copiedKey === key ? t("Betrag kopiert") : t("Betrag kopieren")}
                </button>
                {isConfirming ? (
                  <>
                    <button type="button" onClick={() => setConfirmKey(null)} disabled={busy}>{t("Abbrechen")}</button>
                    <button type="button" className="local-settlement-primary" onClick={() => void markPaid(entry)} disabled={busy}>
                      {busy ? t("Speichert …") : t("Zahlung bestätigen")}
                    </button>
                  </>
                ) : (
                  <button type="button" className="local-settlement-primary" onClick={() => setConfirmKey(key)} disabled={busy}>
                    {t("Als bezahlt markieren")}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

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
      <p className="local-settlement-muted">{t("Diese Zahlungen verändern nicht die Gesamtbilanz.")}</p>
    </section>
  );
}
