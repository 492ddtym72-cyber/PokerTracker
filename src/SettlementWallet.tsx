import { useState } from "react";
import { preparePaymentApp } from "./lib/api";
import { formatMoney } from "./lib/money";
import { getLocale, t } from "./i18n";
import type { PaymentLedgerScope, SettlementSuggestion } from "./types";
import type { PaymentWallet } from "./SettlementTransferCard";

const APP_URLS: Record<PaymentWallet, string> = {
  paypal: "https://www.paypal.com/myaccount/transfer/homepage",
  revolut: "https://revolut.com/app",
};
const RETURN_KEY = "pokertracker-payment-return-notice";

function clipboardAmount(cents: number) {
  return new Intl.NumberFormat(getLocale(), {
    minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false,
  }).format(cents / 100);
}
async function copyText(value: string): Promise<boolean> {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); return true; } }
  catch { /* Try the selection fallback. */ }
  try {
    const el = document.createElement("textarea");
    el.value = value;
    el.setAttribute("readonly", "");
    el.style.position = "fixed"; el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const success = document.execCommand("copy");
    el.remove();
    return success;
  } catch { return false; }
}

type Fallback = { app: PaymentWallet; amountCents: number; toPlayerName: string };
export function useSettlementWallet(scope: PaymentLedgerScope, onStale: () => void) {
  const [copyingKey, setCopyingKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [fallback, setFallback] = useState<Fallback | null>(null);
  const [error, setError] = useState("");

  const keyFor = (suggestion: SettlementSuggestion) =>
    suggestion.fromPlayerId + ":" + suggestion.toPlayerId;

  async function prepared(suggestion: SettlementSuggestion) {
    const next = await preparePaymentApp(suggestion.fromPlayerId, suggestion.toPlayerId, scope);
    if (next.amountCents !== suggestion.amountCents) onStale();
    return next;
  }

  async function copy(suggestion: SettlementSuggestion) {
    const key = keyFor(suggestion);
    setCopyingKey(key); setError("");
    try {
      const current = await prepared(suggestion);
      if (!await copyText(clipboardAmount(current.amountCents))) {
        setError(t("Der Betrag konnte nicht kopiert werden. Bitte manuell übernehmen."));
        return;
      }
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(previous => previous === key ? null : previous), 1600);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Betrag konnte nicht aktualisiert werden."));
      onStale();
    } finally { setCopyingKey(null); }
  }

  function leaveForApp(amountCents: number, app: PaymentWallet) {
    const name = app === "paypal" ? "PayPal" : "Revolut";
    window.sessionStorage.setItem(RETURN_KEY,
      t("{amount} kopiert · Empfänger in {app} auswählen")
        .replace("{amount}", formatMoney(amountCents)).replace("{app}", name));
    window.location.assign(APP_URLS[app]);
  }

  async function open(suggestion: SettlementSuggestion, app: PaymentWallet) {
    const key = keyFor(suggestion);
    setOpeningKey(key + ":" + app); setError(""); setFallback(null);
    try {
      const current = await prepared(suggestion);
      if (!await copyText(clipboardAmount(current.amountCents))) {
        setFallback({ app, amountCents: current.amountCents, toPlayerName: current.toPlayerName });
        return;
      }
      leaveForApp(current.amountCents, app);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Zahlungs-App konnte nicht vorbereitet werden."));
      onStale();
    } finally { setOpeningKey(null); }
  }

  async function continueFallback() {
    if (!fallback) return;
    if (!await copyText(clipboardAmount(fallback.amountCents))) {
      setError(t("Der Betrag konnte nicht kopiert werden. Bitte manuell übernehmen."));
      return;
    }
    leaveForApp(fallback.amountCents, fallback.app);
  }

  return {
    copy, open, copyingKey, copiedKey, openingKey, fallback,
    clearFallback: () => setFallback(null), continueFallback, error,
  };
}

export function PaymentWalletFallback({
  fallback, onCancel, onContinue,
}: {
  fallback: Fallback;
  onCancel: () => void;
  onContinue: () => void;
}) {
  return <section className="paypal-fallback-card">
    <div className="form-card-title"><h2>{t("Zahlungs-App vorbereiten")}</h2></div>
    <p>{t("Aktueller Betrag für {name}: {amount}")
      .replace("{name}", fallback.toPlayerName).replace("{amount}", formatMoney(fallback.amountCents))}</p>
    <p>{t("Der Betrag konnte nicht automatisch kopiert werden. Tippe erneut, um ihn zu kopieren und die Zahlungs-App zu öffnen.")}</p>
    <div className="payment-editor-actions">
      <button type="button" className="secondary-button" onClick={onCancel}>{t("Abbrechen")}</button>
      <button type="button" className="paypal-save-button" onClick={onContinue}>{t("Kopieren & App öffnen")}</button>
    </div>
  </section>;
}
