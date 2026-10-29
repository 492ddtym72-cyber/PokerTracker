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
import { SettlementBalanceHero } from "./SettlementBalanceHero";
import { SettlementViewToggle, type SettlementView } from "./SettlementViewToggle";
import { personalSettlementBalance } from "./lib/settlementPresentation";
import { SettlementCard } from "./SettlementCard";
import { PlayerAvatar } from "./PlayerAvatar";
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
  const [view,setView]=useState<SettlementView>("list");
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

  const personalBalance = data
    ? personalSettlementBalance(data.players, currentPlayerId)
    : null;

  return (
    <SettlementCard
      title={item.name}
      meta={item.totalSessions + " " + t("Sessions")}
      amount={formatMoney(data?.totalOutstandingCents ?? item.totalOutstandingCents)}
      expanded={open}
      panelId={"named-list-" + item.id}
      onToggle={() => { setOpen((value) => !value); setError(""); }}
    >
      {loading && !data && <p className="settlement-ledger-context">{t("Lädt …")}</p>}
      {data && (
        <>
          {personalBalance !== null && <SettlementBalanceHero balanceCents={personalBalance} />}
          {data.ongoingSessionCount > 0 && (
            <p className="settlement-ledger-context">
              {data.ongoingSessionCount} {t("laufende Sessions")}
            </p>
          )}
          {data.groupDifferenceCents !== 0 && (
            <p className="local-settlement-error">
              {t("Offene Session-Differenz")}: {formatMoney(data.groupDifferenceCents)}
            </p>
          )}
          <div className="settlement-section-head named-ledger-view-head">
            <SettlementViewToggle view={view} onChange={setView} />
          </div>
          {data.plan.length === 0 ? (
            <div className="settlement-empty-inline">{t("Keine Zahlungen nötig.")}</div>
          ) : view === "flow" ? (
            <SettlementFlow
              suggestions={data.plan}
              currentPlayerId={currentPlayerId}
              profilePhotoFor={photoFor}
              onSelect={data.status === "closed" ? undefined : (transfer) => {
                const remaining = "remainingCents" in transfer ? Number(transfer.remainingCents) : transfer.amountCents;
                if (remaining <= 0) return;
                selectTransfer({ ...transfer, amountCents: remaining });
                setView("list");
              }}
            />
          ) : (
            <div className="named-ledger-transfers">
              {data.plan.map((transfer,index) => (
                <button
                  type="button"
                  key={transfer.fromPlayerId+":"+transfer.toPlayerId+":"+index}
                  disabled={data.status==="closed" || transfer.remainingCents === 0}
                  onClick={() => selectTransfer({ ...transfer, amountCents: transfer.remainingCents })}
                >
                  <span>{transfer.fromPlayerName} → {transfer.toPlayerName}</span>
                  <strong>{formatMoney(transfer.amountCents)}</strong>
                  {transfer.remainingCents === 0 && <small>✓ {t("gezahlt")}</small>}
                  {transfer.paidCents > 0 && transfer.remainingCents > 0 &&
                    <small>{formatMoney(transfer.remainingCents)} {t("zu zahlen")}</small>}
                </button>
              ))}
            </div>
          )}
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
                <h3>{t("Offene Salden")}</h3><span>{data.players.length}</span>
              </div>
              <div className="settlement-balance-list">
                {data.players.map(player=>(
                  <article key={player.id} className={player.id===currentPlayerId?"is-current-player":""}>
                    <PlayerAvatar name={player.name} photo={photoFor(player.id)} />
                    <div>
                      <strong>{player.name}</strong>
                      <small>{t("Pokerbilanz")} {player.pokerBalanceCents>0?"+":""}{formatMoney(player.pokerBalanceCents)}</small>
                    </div>
                    <b className={player.openBalanceCents>0?"positive":player.openBalanceCents<0?"negative":""}>
                      {formatMoney(player.openBalanceCents)} 
                    </b>
                  </article>
                ))}
              </div>
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
    </SettlementCard>
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
          currentPlayerId={currentPlayerId} photoFor={photoFor} onChanged={()=>{void refresh();window.dispatchEvent(new Event("pokertracker:lists-updated"));}}/>
      ))}
      {error && <p className="local-settlement-error">{error}</p>}
    </>
  );
}
