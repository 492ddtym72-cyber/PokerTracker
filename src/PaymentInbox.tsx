import { useEffect, useMemo, useState } from "react";
import { loadPaymentInbox, markPaymentEventsRead, paymentRequestAction } from "./lib/api";
import { formatMoney, parseMoney } from "./lib/money";
import { getLocale, t } from "./i18n";
import { PlayerAvatar } from "./PlayerAvatar";
import type { PaymentInboxData, PaymentRequest, PlayerProfile } from "./types";

function requestDate(iso:string) {
  return new Date(iso).toLocaleDateString(getLocale(),{day:"numeric",month:"short",year:"numeric"});
}

export function InboxLauncher({
  currentPlayerId, playerProfiles,
}: {
  currentPlayerId: string | null;
  playerProfiles: PlayerProfile[];
}) {
  const [open,setOpen]=useState(false);
  const [data,setData]=useState<PaymentInboxData|null>(null);
  const [tab,setTab]=useState<"in"|"out">("in");
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState("");
  const [reportFor,setReportFor]=useState<string|null>(null);
  const [reportAmount,setReportAmount]=useState("");
  const photoById=useMemo(()=>new Map(playerProfiles.map(p=>[p.id,p.profilePhoto])),[playerProfiles]);
  const me=currentPlayerId;

  async function refresh(playerId:string) {
    return loadPaymentInbox(playerId).then(next=>{
      // Do not replace messages belonging to the previously selected profile.
      if (window.localStorage.getItem("pokertracker-current-player-id") === playerId) {
        setData(next);
      }
      return next;
    });
  }
  useEffect(()=>{
    setData(null);
    setOpen(false);
    if (!me) return;
    let active=true;
    const reload=()=>loadPaymentInbox(me).then(next=>{
      if(active) setData(next);
    }).catch(()=>{/* Keep the app usable if inbox is unavailable. */});
    void reload();
    const interval=window.setInterval(()=>{
      if(document.visibilityState==="visible") void reload();
    },45000);
    const onFocus=()=>{if(document.visibilityState==="visible")void reload();};
    window.addEventListener("focus",onFocus);
    document.addEventListener("visibilitychange",onFocus);
    return ()=>{active=false;window.clearInterval(interval);
      window.removeEventListener("focus",onFocus);
      document.removeEventListener("visibilitychange",onFocus);
    };
  },[me]);

  const unread=data?.events.filter(event=>!event.readAt).length??0;

  useEffect(()=>{
    if (!open || !me || !data) return;
    const ids=data.events.filter(event=>!event.readAt).map(event=>event.id);
    if(!ids.length) return;
    // Mark once the inbox is actually viewed, without hiding messages locally
    // until the server acknowledges the write.
    void markPaymentEventsRead(me,ids).then(()=>{
      setData(prev=>prev?{...prev,events:prev.events.map(e=>ids.includes(e.id)
        ? {...e,readAt:new Date().toISOString()}:e)}:prev);
    }).catch(()=>{/* Retry next time the inbox opens. */});
  },[open,me,data]);

  useEffect(()=>{
    if(!open)return;
    const handle=(ev:KeyboardEvent)=>{if(ev.key==="Escape")setOpen(false);};
    document.addEventListener("keydown",handle);
    return ()=>document.removeEventListener("keydown",handle);
  },[open]);

  async function run(id:string,action:"remind"|"cancel"|"report"|"confirm"|"reject",extra:Record<string,unknown>={}) {
    if(!me)return;
    setError("");
    setBusy(id+":"+action);
    try {
      await paymentRequestAction(id,action,{actorPlayerId:me,...extra});
      setReportFor(null);
      const next=await refresh(me);
      if(action==="confirm")window.dispatchEvent(new Event("pokertracker:settlement-updated"));
      // Do not show a success state before the server has confirmed the action.
      if(next) setError("");
    } catch(err) {
      setError(err instanceof Error?err.message:t("Aktion fehlgeschlagen."));
    } finally {setBusy(null);}
  }

  function openReport(request:PaymentRequest) {
    setReportFor(request.id);
    setReportAmount((request.remainingCents/100).toFixed(2).replace(".",","));
    setError("");
  }

  const activeRequests=(data?.requests??[]).filter(r=>
    tab==="in"?r.fromPlayerId===me:r.toPlayerId===me);
  const incomingCount=data?.requests.filter(r=>r.fromPlayerId===me&&
    !r.cancelledAt&&r.remainingCents>0).length??0;
  const pending=data?.reports.filter(r=>r.status==="reported"&&
    data.requests.some(request=>request.id===r.requestId&&request.toPlayerId===me)).length??0;

  return (
    <>
      <button type="button" className="inbox-trigger" disabled={!me}
        aria-label={t("Postfach")+(unread?" ("+unread+")":"")}
        title={me?t("Postfach"):t("Bitte zuerst ein Profil auswählen.")}
        onClick={()=>{setOpen(true);setLoading(true);setError("");
          if(me)void refresh(me).catch(e=>setError(e instanceof Error?e.message:String(e)))
            .finally(()=>setLoading(false));
        }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="3"/>
          <path d="m4 7 8 6 8-6"/>
        </svg>
        {unread>0&&<span className="inbox-unread">{unread>9?"9+":unread}</span>}
      </button>
      {open&&me&&(
        <div className="inbox-backdrop" role="presentation" onMouseDown={e=>{
          if(e.target===e.currentTarget)setOpen(false);
        }}>
          <section className="inbox-panel" role="dialog" aria-modal="true" aria-label={t("Postfach")}>
            <div className="inbox-heading">
              <div><span className="inbox-eyebrow">{t("PokerTracker")}</span><h2>{t("Postfach")}</h2></div>
              <button className="inbox-close" type="button" onClick={()=>setOpen(false)}
                aria-label={t("Schließen")}>×</button>
            </div>
            <div className="inbox-tabs" role="group" aria-label={t("Postfachansicht")}>
              <button type="button" className={tab==="in"?"active":""}
                onClick={()=>{setTab("in");setReportFor(null);}}>
                {t("Eingang")}{incomingCount>0&&<span>{incomingCount}</span>}
              </button>
              <button type="button" className={tab==="out"?"active":""}
                onClick={()=>{setTab("out");setReportFor(null);}}>
                {t("Gesendet")}{tab==="out"&&pending>0&&<span>•</span>}
              </button>
            </div>
            <p className="inbox-privacy">{t("Gruppenpostfach: Alle mit dem Gruppenpasswort können Profile wechseln.")}</p>
            {error&&<p className="inbox-error" role="alert">{error}</p>}
            {loading&&!data?<div className="inbox-empty">{t("Lädt …")}</div>:
              activeRequests.length===0?
                <div className="inbox-empty">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
                    <rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/>
                  </svg>
                  <strong>{t("Noch keine Zahlungsanforderungen")}</strong>
                  <small>{tab==="in"?t("Hier erscheinen deine Zahlungserinnerungen."):
                    t("Neue Anforderungen lassen sich unter Ausgleichen senden.")}</small>
                </div>:
                <div className="inbox-list">
                  {activeRequests.map(request=>{
                    const incoming=request.fromPlayerId===me;
                    const otherId=incoming?request.toPlayerId:request.fromPlayerId;
                    const otherName=incoming?request.toPlayerName:request.fromPlayerName;
                    const archived=!!request.cancelledAt || request.remainingCents===0;
                    const pendingReports=(data?.reports??[]).filter(r=>r.requestId===request.id && r.status==="reported");
                    const otherReports=(data?.reports??[]).filter(r=>r.requestId===request.id && r.status!=="reported");
                    const notRead=data?.events.some(e=>e.requestId===request.id&&!e.readAt);
                    const reminderAllowed=!request.lastRemindedAt||
                      Date.now()-new Date(request.lastRemindedAt).getTime()>=86400000;
                    const canAct=!archived && !busy;
                    return <article key={request.id} className={"inbox-request"+(archived?" is-closed":"")}>
                      <div className="inbox-request-head">
                        <PlayerAvatar name={otherName} photo={photoById.get(otherId)??null}/>
                        <div className="inbox-request-person">
                          <strong>{otherName}{notRead&&<i className="inbox-dot"/>}</strong>
                          <small>{requestDate(request.createdAt)} · {incoming?t("Zahlung angefordert"):t("Anforderung gesendet")}</small>
                        </div>
                        <span className="inbox-request-amount">{formatMoney(request.remainingCents)}</span>
                      </div>
                      {request.message&&<p className="inbox-request-message">{request.message}</p>}
                      {request.paymentUrl&&incoming&&!request.stale&&
                        <a className="inbox-pay-link" href={request.paymentUrl} target="_blank"
                          rel="noopener noreferrer">
                          <span>↗</span> {t("Zahlungslink öffnen")}
                        </a>}
                      {request.stale&&!request.cancelledAt&&<div className="inbox-state">{t("Bilanz geändert – Anforderung überprüfen")}</div>}
                      {archived&&<div className="inbox-state">{request.cancelledAt?t("Zurückgezogen"):t("Ausgeglichen")}</div>}
                      {!archived&&pendingReports.length>0&&<div className="inbox-state">
                        {incoming?t("Bestätigung ausstehend"):t("Zahlung gemeldet – bitte prüfen")}
                      </div>}
                      {incoming&&!archived&&pendingReports.length===0&&(
                        request.stale ? <div className="inbox-state">{t("Bitte den Gläubiger um eine aktualisierte Anforderung.")}</div> : reportFor===request.id?
                        <form className="inbox-report-form" onSubmit={e=>{
                          e.preventDefault();
                          const cents=parseMoney(reportAmount);
                          if(cents===null||cents<1||cents>request.remainingCents){
                            setError(t("Bitte einen gültigen Betrag angeben."));return;
                          }
                          void run(request.id,"report",{amountCents:cents,clientToken:crypto.randomUUID()});
                        }}>
                          <label>{t("Gezahlter Betrag")}<input inputMode="decimal" value={reportAmount}
                            onChange={e=>setReportAmount(e.target.value)} autoFocus/></label>
                          <div className="inbox-actions">
                            <button type="button" className="inbox-secondary" onClick={()=>setReportFor(null)}>{t("Abbrechen")}</button>
                            <button type="submit" className="inbox-primary" disabled={!!busy}>{t("Zahlung melden")}</button>
                          </div>
                        </form>:
                        <div className="inbox-actions">
                          <button type="button" className="inbox-primary" disabled={!canAct}
                            onClick={()=>openReport(request)}>{t("Bezahlt melden")}</button>
                        </div>
                      )}
                      {!incoming&&!archived&&(
                        <>
                          {pendingReports.map(report=><div className="inbox-payment-review" key={report.id}>
                            <div><span>{t("Gemeldeter Betrag")}</span><strong>{formatMoney(report.amountCents)}</strong></div>
                            <div className="inbox-actions">
                              <button type="button" className="inbox-secondary" disabled={!canAct}
                                onClick={()=>void run(request.id,"reject",{reportId:report.id})}>{t("Ablehnen")}</button>
                              <button type="button" className="inbox-primary" disabled={!canAct}
                                onClick={()=>void run(request.id,"confirm",{reportId:report.id})}>{t("Geldeingang bestätigen")}</button>
                            </div>
                          </div>)}
                          <div className="inbox-actions">
                            <button type="button" className="inbox-secondary" disabled={!canAct||!reminderAllowed||request.stale}
                              title={!reminderAllowed?t("Eine Erinnerung ist nur alle 24 Stunden möglich."):""}
                              onClick={()=>void run(request.id,"remind")}>{t("Erinnern")}</button>
                            <button type="button" className="inbox-cancel" disabled={!canAct}
                              onClick={()=>{
                                if(window.confirm(t("Anforderung wirklich zurückziehen?")))
                                  void run(request.id,"cancel");
                              }}>{t("Zurückziehen")}</button>
                          </div>
                        </>
                      )}
                      {otherReports.length>0&&
                        <small className="inbox-request-footnote">
                          {otherReports.map(r=>{
                            const label=r.status==="rejected"?t("Abgelehnt"):
                              r.voidedAt?t("Storniert"):t("Bestätigt");
                            return label+" "+formatMoney(r.amountCents);
                          }).join(" · ")}
                        </small>}
                    </article>;
                  })}
                </div>
            }
          </section>
        </div>
      )}
    </>
  );
}
