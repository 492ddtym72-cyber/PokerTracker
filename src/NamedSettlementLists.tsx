import { useEffect, useState } from "react";
import {
  advanceSettlementList,
  loadNamedSettlement,
  loadSettlementLists,
  recordNamedSettlementPayment,
  voidNamedSettlementPayment,
} from "./lib/api";
import { formatMoney } from "./lib/money";
import { getLocale, t } from "./i18n";
import { SettlementFlow } from "./SettlementFlow";
import type { NamedSettlementResponse, SettlementListSummary, SettlementSuggestion } from "./types";

function localToday() {
  const d=new Date();
  return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
}
function settlementStatus(status:SettlementListSummary["status"]) {
  return status==="open" ? t("Offen für Sessions") : status==="paying_out" ? t("Auszahlung läuft") : t("Abgeschlossen");
}

function NamedSettlement({
  item,currentPlayerId,photoFor,onChanged,
}:{
  item:SettlementListSummary;
  currentPlayerId:string|null;
  photoFor:(id:string)=>string|null;
  onChanged:()=>void;
}) {
  const [open,setOpen]=useState(false);
  const [data,setData]=useState<NamedSettlementResponse|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [selected,setSelected]=useState<SettlementSuggestion|null>(null);
  const [amount,setAmount]=useState("");
  const [paymentDate,setPaymentDate]=useState(localToday);
  const [note,setNote]=useState("");
  const [clientToken,setClientToken]=useState(()=>crypto.randomUUID());

  async function refresh() {
    const snapshot=await loadNamedSettlement(item.id);
    setData(snapshot);
    return snapshot;
  }
  useEffect(()=>{
    if(!open) return;
    let active=true;
    setLoading(true);
    loadNamedSettlement(item.id)
      .then(result=>{if(active)setData(result);})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:t("Abrechnung konnte nicht geladen werden."));})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[open,item.id]);

  function selectTransfer(s:SettlementSuggestion) {
    setSelected(s);
    setAmount((s.amountCents/100).toFixed(2).replace(".",","));
    setPaymentDate(localToday());
    setNote("");
    setClientToken(crypto.randomUUID());
    setError("");
  }

  async function savePayment(e:React.FormEvent) {
    e.preventDefault();
    if(!selected || !data) return;
    const cents=Math.round(Number(amount.trim().replace(",","."))*100);
    if(!Number.isSafeInteger(cents) || cents<=0) {
      setError(t("Bitte einen gültigen Zahlungsbetrag eintragen."));return;
    }
    setSaving(true);setError("");
    try {
      await recordNamedSettlementPayment(item.id,{
        fromPlayerId:selected.fromPlayerId,toPlayerId:selected.toPlayerId,
        amountCents:cents,paidAt:paymentDate,note,clientToken,
      });
      setSelected(null);
      await refresh();
      onChanged();
    } catch(e) {setError(e instanceof Error?e.message:t("Zahlung konnte nicht gespeichert werden."));}
    finally{setSaving(false);}
  }

  async function undoPayment(id:string) {
    if(!window.confirm(t("Diese Zahlung wirklich rückgängig machen?")))return;
    setSaving(true);setError("");
    try{await voidNamedSettlementPayment(item.id,id);await refresh();onChanged();}
    catch(e){setError(e instanceof Error?e.message:t("Zahlung konnte nicht storniert werden."));}
    finally{setSaving(false);}
  }

  async function transition(status:"paying_out"|"closed") {
    const message=status==="paying_out"
      ? t("Auszahlung beginnen? Danach können keine Sessions mehr hinzugefügt oder bearbeitet werden.")
      : t("Abrechnung abschließen? Danach können keine Zahlungen mehr geändert werden.");
    if(!window.confirm(message)) return;
    setSaving(true);setError("");
    try{await advanceSettlementList(item.id,status);await refresh();onChanged();}
    catch(e){setError(e instanceof Error?e.message:t("Aktion fehlgeschlagen."));}
    finally{setSaving(false);}
  }

  const currentStatus=data?.status??item.status;
  return (
    <article className={"settlement-ledger-item"+(open?" is-expanded":"")}>
      <button className="settlement-ledger-trigger" type="button"
        aria-expanded={open} aria-controls={"named-list-"+item.id}
        onClick={()=>{setOpen(v=>!v);setError("");}}>
        <span className="settlement-ledger-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.7">
            <rect x="3.5" y="4" width="17" height="16" rx="3"/>
            <path d="M7 9h10M7 13h10M7 17h7"/>
          </svg>
        </span>
        <span className="settlement-ledger-name">
          <strong>{item.name}</strong>
          <small>{item.totalSessions} {t("Sessions")} · {settlementStatus(currentStatus)}</small>
        </span>
        <span className="settlement-ledger-amount">
          <strong>{formatMoney(data?.totalOutstandingCents??item.totalOutstandingCents)}</strong>
          <small>{t("Noch auszugleichen")}</small>
        </span>
        <svg className={"settlement-ledger-chevron"+(open?" is-open":"")}
          viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="2" aria-hidden="true">
          <path d="m6 9 6 6 6-6"/>
        </svg>
      </button>
      {open && (
        <div id={"named-list-"+item.id} className="settlement-ledger-detail">
          {loading && !data && <p className="settlement-ledger-context">{t("Lädt …")}</p>}
          {data && (
            <>
              <div className="named-ledger-stats">
                <span>{data.players.length} {t("Spieler")}</span>
                <span>{settlementStatus(data.status)}</span>
              </div>
              {data.ongoingSessionCount>0 && (
                <p className="settlement-ledger-context">{data.ongoingSessionCount} {t("laufende Sessions")} · {t("Vorläufig")}</p>
              )}
              {data.groupDifferenceCents!==0 && (
                <p className="local-settlement-error">{t("Offene Session-Differenz")}: {formatMoney(data.groupDifferenceCents)}</p>
              )}
              {data.suggestions.length>0 ? (
                <>
                  <SettlementFlow
                    suggestions={data.suggestions}
                    currentPlayerId={currentPlayerId}
                    profilePhotoFor={photoFor}
                    onSelect={data.status==="closed"?undefined:selectTransfer}
                  />
                  {data.status!=="closed" && (
                    <div className="named-ledger-transfers">
                      {data.suggestions.map(s=>(
                        <button type="button" key={s.fromPlayerId+":"+s.toPlayerId}
                          onClick={()=>selectTransfer(s)}>
                          <span>{s.fromPlayerName} → {s.toPlayerName}</span>
                          <strong>{formatMoney(s.amountCents)}</strong>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ):<div className="settlement-empty-inline">{t("Keine Zahlungen nötig.")}</div>}
              {selected && data.status!=="closed" && (
                <form className="named-ledger-payment-form" onSubmit={savePayment}>
                  <strong>{selected.fromPlayerName} → {selected.toPlayerName}</strong>
                  <label>{t("Betrag")} <input required inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
                  <label>{t("Datum")} <input type="date" required value={paymentDate} onChange={e=>setPaymentDate(e.target.value)}/></label>
                  <label>{t("Notiz (optional)")} <input maxLength={200} value={note} onChange={e=>setNote(e.target.value)}/></label>
                  <div className="payment-editor-actions">
                    <button type="button" className="secondary-button" onClick={()=>setSelected(null)}>{t("Abbrechen")}</button>
                    <button type="submit" className="gold-cta" disabled={saving}>{saving?t("Speichert …"):t("Zahlung speichern")}</button>
                  </div>
                </form>
              )}
              <div className="section-title-row named-ledger-history-title">
                <h3>{t("Zahlungsverlauf")}</h3><span>{data.payments.length}</span>
              </div>
              {data.payments.length===0
                ? <p className="settlement-ledger-context">{t("Noch keine Zahlungen erfasst.")}</p>
                : <div className="payment-history-list">
                  {data.payments.map(p=>(
                    <article key={p.id} className={p.voidedAt?"is-voided":""}>
                      <div>
                        <strong>{p.fromPlayerName} → {p.toPlayerName}</strong>
                        <small>{new Date(p.paidAt+"T12:00:00").toLocaleDateString(getLocale())}{p.note?" · "+p.note:""}</small>
                      </div>
                      <b>{formatMoney(p.amountCents)}</b>
                      {p.voidedAt
                        ? <span className="payment-status">{t("Storniert")}</span>
                        : data.status!=="closed" && <button type="button" className="payment-undo" disabled={saving}
                            onClick={()=>void undoPayment(p.id)}>{t("Rückgängig")}</button>}
                    </article>
                  ))}
                </div>}
              <div className="named-ledger-status-actions">
                {data.status==="open" && <button type="button" className="secondary-button" disabled={saving}
                  onClick={()=>void transition("paying_out")}>{t("Auszahlung starten")}</button>}
                {data.status==="paying_out" && data.totalOutstandingCents===0 && data.groupDifferenceCents===0 &&
                  <button type="button" className="secondary-button" disabled={saving}
                    onClick={()=>void transition("closed")}>{t("Abrechnung abschließen")}</button>}
              </div>
            </>
          )}
          {error && <p className="local-settlement-error" role="alert">{error}</p>}
        </div>
      )}
    </article>
  );
}

export function NamedSettlementLists({
  currentPlayerId,photoFor,nightsVersion,
}: {
  currentPlayerId:string|null;
  photoFor:(id:string)=>string|null;
  nightsVersion:string;
}) {
  const [lists,setLists]=useState<SettlementListSummary[]>([]);
  const [error,setError]=useState("");
  async function refresh() {
    try{const next=await loadSettlementLists();setLists(next.filter(x=>!x.legacy));setError("");}
    catch(e){setError(e instanceof Error?e.message:t("Abrechnungslisten konnten nicht geladen werden."));}
  }
  useEffect(()=>{void refresh();},[nightsVersion]);
  return (
    <>
      {lists.map(item=>(
        <NamedSettlement key={item.id} item={item}
          currentPlayerId={currentPlayerId} photoFor={photoFor} onChanged={()=>void refresh()}/>
      ))}
      {error && <p className="local-settlement-error">{error}</p>}
    </>
  );
}
