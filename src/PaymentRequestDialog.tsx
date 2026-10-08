import { useState, type FormEvent } from "react";
import { sendPaymentRequest } from "./lib/api";
import { formatMoney, parseMoney } from "./lib/money";
import { t } from "./i18n";
import { PlayerAvatar } from "./PlayerAvatar";
import type { SettlementSuggestion, PlayerProfile } from "./types";

export function PaymentRequestDialog({
  suggestion, currentPlayerId, profiles, onClose,
}: {
  suggestion: SettlementSuggestion;
  currentPlayerId: string;
  profiles: PlayerProfile[];
  onClose: () => void;
}) {
  const [amount,setAmount]=useState((suggestion.amountCents/100).toFixed(2).replace(".",","));
  const [message,setMessage]=useState("");
  const [paymentUrl,setPaymentUrl]=useState("");
  const [clientToken]=useState(()=>crypto.randomUUID());
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");

  async function submit(event:FormEvent) {
    event.preventDefault();
    if(busy)return;
    const cents=parseMoney(amount);
    if(cents===null||cents<1||cents>suggestion.amountCents){
      setError(t("Bitte einen Betrag bis zur offenen Summe angeben."));return;
    }
    if(currentPlayerId!==suggestion.toPlayerId){
      setError(t("Bitte das empfangende Spielerprofil wählen."));return;
    }
    setBusy(true);setError("");
    try {
      await sendPaymentRequest({
        fromPlayerId:suggestion.fromPlayerId,toPlayerId:suggestion.toPlayerId,
        actorPlayerId:currentPlayerId,amountCents:cents,message,paymentUrl,clientToken,
      });
      window.dispatchEvent(new Event("pokertracker:inbox-updated"));
      onClose();
    } catch(err) {
      setError(err instanceof Error?err.message:t("Anforderung konnte nicht versendet werden."));
    } finally {setBusy(false);}
  }

  return <div className="request-dialog-backdrop" role="presentation" onMouseDown={e=>{
    if(e.target===e.currentTarget&&!busy)onClose();
  }}>
    <section className="request-dialog" role="dialog" aria-modal="true"
      aria-label={t("Zahlung anfordern")}>
      <div className="inbox-heading">
        <div><span className="inbox-eyebrow">{t("Ausgleichen")}</span><h2>{t("Zahlung anfordern")}</h2></div>
        <button type="button" className="inbox-close" onClick={onClose} disabled={busy}
          aria-label={t("Schließen")}>×</button>
      </div>
      <div className="request-dialog-player">
        <PlayerAvatar name={suggestion.fromPlayerName}
          photo={profiles.find(p=>p.id===suggestion.fromPlayerId)?.profilePhoto??null}/>
        <div><strong>{suggestion.fromPlayerName}</strong><small>{t("Offener Zahlungsvorschlag")}</small></div>
        <strong>{formatMoney(suggestion.amountCents)}</strong>
      </div>
      <form className="request-dialog-form" onSubmit={submit}>
        <label>{t("Betrag")}
          <div className="request-money"><input inputMode="decimal" value={amount}
            onChange={e=>setAmount(e.target.value)} required/><span>€</span></div>
        </label>
        <label>{t("Nachricht (optional)")}
          <textarea maxLength={400} rows={3} value={message}
            onChange={e=>setMessage(e.target.value)}
            placeholder={t("Zum Beispiel: Schickst du mir den Betrag diese Woche?")}/>
        </label>
        <label>{t("Zahlungslink (optional)")}
          <input type="url" maxLength={500} value={paymentUrl} onChange={e=>setPaymentUrl(e.target.value)}
            placeholder="https://..." pattern="https://.*"/>
        </label>
        <p className="request-dialog-hint">{t("Die Anforderung ändert keine Bilanz. Externe Zahlungslinks werden nicht automatisch geprüft.")}</p>
        {error&&<p className="inbox-error" role="alert">{error}</p>}
        <div className="inbox-actions">
          <button type="button" className="inbox-secondary" disabled={busy} onClick={onClose}>{t("Abbrechen")}</button>
          <button type="submit" className="inbox-primary" disabled={busy}>
            {busy?t("Speichert …"):t("Anforderung senden")}
          </button>
        </div>
      </form>
    </section>
  </div>;
}
