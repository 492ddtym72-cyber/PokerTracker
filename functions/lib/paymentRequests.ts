import type { Env } from "../auth";
import { loadSettlementSnapshot } from "./settlement";

const ID = /^player_[a-f0-9]{24}$/;
const TOKEN = /^[a-f0-9-]{20,80}$/i;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Ungültige Anfrage.");
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number): string {
  if (value == null) return "";
  if (typeof value !== "string" || value.trim().length > maximum) throw new Error("Text ist zu lang oder ungültig.");
  return value.trim();
}
function player(value: unknown): string {
  if (typeof value !== "string" || !ID.test(value)) throw new Error("Ungültiges Spielerprofil.");
  return value;
}
function token(value: unknown): string {
  if (typeof value !== "string" || !TOKEN.test(value)) throw new Error("Ungültige Anforderungs-ID.");
  return value;
}
function amount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 100000000) {
    throw new Error("Ungültiger Betrag.");
  }
  return value as number;
}
function url(value: unknown): string | null {
  const source = text(value, 500);
  if (!source) return null;
  try {
    const parsed = new URL(source);
    if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) throw new Error();
    return parsed.href;
  } catch {
    throw new Error("Nur gültige HTTPS-Zahlungslinks sind erlaubt.");
  }
}
function isId(value: string) { return /^[0-9a-f-]{36}$/i.test(value); }
function now() { return new Date().toISOString(); }

interface RequestRow {
  id: string; from_player_id: string; to_player_id: string;
  from_player_name: string; to_player_name: string; amount_cents: number;
  message: string | null; payment_url: string | null; created_at: string;
  cancelled_at: string | null; last_reminded_at: string | null;
  paid_cents: number;
}
interface ReportRow {
  id: string; request_id: string; amount_cents: number; status: "reported" | "confirmed" | "rejected";
  created_at: string; decided_at: string | null; voided_at: string | null;
}
interface EventRow {
  id: string; request_id: string; kind: string; created_at: string; read_at: string | null;
}
const requestTotals = `(SELECT COALESCE(SUM(sp.amount_cents),0)
  FROM payment_reports report
  JOIN settlement_payments sp ON sp.payment_report_id = report.id AND sp.voided_at IS NULL
  WHERE report.request_id = pr.id)`;

export async function loadPaymentRequests(env: Env, playerId: string) {
  player(playerId);
  const [requests, reports, events, settlement] = await Promise.all([
    env.DB.prepare(`SELECT pr.*, debtor.name AS from_player_name, creditor.name AS to_player_name,
      ${requestTotals} AS paid_cents
      FROM payment_requests pr
      JOIN players debtor ON debtor.id=pr.from_player_id
      JOIN players creditor ON creditor.id=pr.to_player_id
      WHERE pr.to_player_id=? OR (pr.from_player_id=? AND pr.cancelled_at IS NULL)
      ORDER BY pr.created_at DESC LIMIT 100`).bind(playerId, playerId).all<RequestRow>(),
    env.DB.prepare(`SELECT report.*, sp.voided_at
      FROM payment_reports report
      JOIN payment_requests pr ON pr.id=report.request_id
      LEFT JOIN settlement_payments sp ON sp.payment_report_id=report.id
      WHERE pr.to_player_id=? OR (pr.from_player_id=? AND pr.cancelled_at IS NULL)
      ORDER BY report.created_at DESC LIMIT 200`).bind(playerId,playerId).all<ReportRow>(),
    // Keep cancelled requests (and their old notifications) out of the payer's inbox.
    // The sender still retains the withdrawn request in their sent history.
    env.DB.prepare(`SELECT event.id,event.request_id,event.kind,event.created_at,event.read_at
      FROM payment_request_events event
      JOIN payment_requests pr ON pr.id=event.request_id
      WHERE event.to_player_id=?
        AND (pr.from_player_id<>? OR pr.cancelled_at IS NULL)
      ORDER BY event.created_at DESC LIMIT 200`).bind(playerId,playerId).all<EventRow>(),
    loadSettlementSnapshot(env),
  ]);
  return {
    requests: requests.results.map(r => {
      const payer=settlement.players.find(p=>p.id===r.from_player_id);
      const creditor=settlement.players.find(p=>p.id===r.to_player_id);
      const liveLimit=Math.max(0,Math.min(
        payer ? -payer.openBalanceCents : 0,
        creditor ? creditor.openBalanceCents : 0,
      ));
      const unpaid=Math.max(0,r.amount_cents-r.paid_cents);
      return ({
      id:r.id, fromPlayerId:r.from_player_id, toPlayerId:r.to_player_id,
      fromPlayerName:r.from_player_name,toPlayerName:r.to_player_name,
      amountCents:r.amount_cents,paidCents:r.paid_cents,
      remainingCents:Math.min(unpaid,liveLimit),
      stale:unpaid>liveLimit,
      message:r.message, paymentUrl:r.payment_url,
      createdAt:r.created_at,cancelledAt:r.cancelled_at,lastRemindedAt:r.last_reminded_at,
    });
    }),
    reports: reports.results.map(r => ({
      id:r.id,requestId:r.request_id,amountCents:r.amount_cents,status:r.status,
      createdAt:r.created_at,decidedAt:r.decided_at,voidedAt:r.voided_at,
    })),
    events: events.results.map(e => ({
      id:e.id,requestId:e.request_id,kind:e.kind,createdAt:e.created_at,readAt:e.read_at,
    })),
  };
}

async function getRequest(env: Env, requestId: string) {
  if (!isId(requestId)) throw new Error("Zahlungsanforderung nicht gefunden.");
  const result = await env.DB.prepare(`SELECT pr.*, ${requestTotals} AS paid_cents
    FROM payment_requests pr WHERE pr.id=?`).bind(requestId).first<RequestRow>();
  if (!result) throw new Error("Zahlungsanforderung nicht gefunden.");
  return result;
}
async function balances(env: Env, from: string, to: string) {
  const snapshot = await loadSettlementSnapshot(env);
  const debtor = snapshot.players.find(p => p.id === from);
  const creditor = snapshot.players.find(p => p.id === to);
  if (!debtor || !creditor || debtor.openBalanceCents >= 0 || creditor.openBalanceCents <= 0) {
    throw new Error("Für diese Spieler besteht kein offener Ausgleich mehr.");
  }
  return Math.min(-debtor.openBalanceCents, creditor.openBalanceCents);
}

export async function createPaymentRequest(env: Env, value: unknown) {
  const data = object(value);
  const from = player(data.fromPlayerId);
  const to = player(data.toPlayerId);
  const actor = player(data.actorPlayerId);
  if (actor !== to || from === to) throw new Error("Bitte das empfangende Spielerprofil wählen.");
  const cents = amount(data.amountCents);
  const message = text(data.message,400);
  const paymentUrl = url(data.paymentUrl);
  const clientToken = token(data.clientToken);
  const existing = await env.DB.prepare("SELECT id FROM payment_requests WHERE client_token=?")
    .bind(clientToken).first<{id:string}>();
  if (existing) return {id:existing.id};
  const snapshot = await loadSettlementSnapshot(env);
  const suggestion = snapshot.suggestions.find(s=>s.fromPlayerId===from && s.toPlayerId===to);
  if (!suggestion || cents > suggestion.amountCents) {
    throw new Error("Der Zahlungsvorschlag hat sich geändert. Bitte Ausgleich neu laden.");
  }
  const id = crypto.randomUUID();
  const createdAt = now();
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO payment_requests
      (id,from_player_id,to_player_id,amount_cents,message,payment_url,created_at,client_token)
      SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS (
        SELECT 1 FROM payment_requests pr
        WHERE pr.from_player_id=? AND pr.to_player_id=? AND pr.cancelled_at IS NULL
          AND pr.amount_cents > ${requestTotals}
      )`).bind(id,from,to,cents,message || null,paymentUrl,createdAt,clientToken,from,to),
    env.DB.prepare(`INSERT INTO payment_request_events(id,request_id,to_player_id,kind,created_at)
      SELECT ?,id,from_player_id,'request',? FROM payment_requests WHERE id=?`)
      .bind(crypto.randomUUID(),createdAt,id),
  ]);
  if (results[0].meta.changes !== 1) throw new Error("Es gibt bereits eine offene Anforderung an diesen Spieler.");
  return {id};
}

export async function remindPaymentRequest(env: Env, id: string, actorPlayerId: unknown) {
  const request = await getRequest(env,id);
  if (player(actorPlayerId) !== request.to_player_id) throw new Error("Falsches Spielerprofil.");
  if (request.cancelled_at || request.amount_cents <= request.paid_cents) throw new Error("Diese Anforderung ist nicht mehr offen.");
  const outstanding=request.amount_cents-request.paid_cents;
  if ((await balances(env,request.from_player_id,request.to_player_id)) < outstanding) {
    throw new Error("Die Bilanz hat sich verändert. Bitte diese Anforderung zurückziehen und neu erstellen.");
  }
  const marker=crypto.randomUUID(), at=now();
  const results=await env.DB.batch([
    env.DB.prepare(`UPDATE payment_requests SET last_reminded_at=?,reminder_token=?
      WHERE id=? AND cancelled_at IS NULL AND
      (last_reminded_at IS NULL OR datetime(last_reminded_at) <= datetime('now','-1 day'))`)
      .bind(at,marker,id),
    env.DB.prepare(`INSERT INTO payment_request_events(id,request_id,to_player_id,kind,created_at)
      SELECT ?,id,from_player_id,'reminder',? FROM payment_requests
      WHERE id=? AND reminder_token=?`).bind(crypto.randomUUID(),at,id,marker),
  ]);
  if (results[0].meta.changes !== 1) throw new Error("Eine Erinnerung ist nur alle 24 Stunden möglich.");
  return {ok:true};
}

export async function cancelPaymentRequest(env: Env,id:string,actorPlayerId:unknown) {
  const request=await getRequest(env,id);
  if (player(actorPlayerId)!==request.to_player_id) throw new Error("Falsches Spielerprofil.");
  const at=now();
  // Withdrawing a request must not create a new recipient notification.
  const result=await env.DB.prepare(
    "UPDATE payment_requests SET cancelled_at=? WHERE id=? AND cancelled_at IS NULL"
  ).bind(at,id).run();
  if (result.meta.changes !== 1) throw new Error("Anforderung wurde bereits zurückgezogen.");
  return {ok:true};
}

export async function reportPayment(env:Env,id:string,value:unknown) {
  const data=object(value), request=await getRequest(env,id);
  if (player(data.actorPlayerId)!==request.from_player_id) throw new Error("Bitte das zahlende Spielerprofil wählen.");
  if (request.cancelled_at) throw new Error("Diese Anforderung wurde zurückgezogen.");
  const cents=amount(data.amountCents), clientToken=token(data.clientToken);
  const existing=await env.DB.prepare("SELECT id FROM payment_reports WHERE client_token=?")
    .bind(clientToken).first<{id:string}>();
  if (existing) return {id:existing.id};
  const remaining=Math.max(0,request.amount_cents-request.paid_cents);
  if (cents>remaining || cents>await balances(env,request.from_player_id,request.to_player_id)) {
    throw new Error("Der Betrag ist nicht mehr offen. Bitte aktualisieren.");
  }
  const reportId=crypto.randomUUID(),at=now();
  const results=await env.DB.batch([
    env.DB.prepare(`INSERT INTO payment_reports(id,request_id,amount_cents,status,created_at,client_token)
      SELECT ?,pr.id,?,'reported',?,? FROM payment_requests pr
      WHERE pr.id=? AND pr.cancelled_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM payment_reports pending WHERE pending.request_id=pr.id AND pending.status='reported')
      AND ? <= pr.amount_cents - ${requestTotals}`)
      .bind(reportId,cents,at,clientToken,id,cents),
    env.DB.prepare(`INSERT INTO payment_request_events(id,request_id,to_player_id,kind,created_at)
      SELECT ?,pr.id,pr.to_player_id,'reported',?
      FROM payment_reports report JOIN payment_requests pr ON pr.id=report.request_id
      WHERE report.id=?`).bind(crypto.randomUUID(),at,reportId),
  ]);
  if (results[0].meta.changes !== 1) throw new Error("Es ist bereits eine Zahlung zur Prüfung vorgemerkt oder der Betrag hat sich geändert.");
  return {id:reportId};
}

// Server-side atomic guard: a simultaneous write cannot pay beyond either
// party's current balance, even when a client has an old settlement snapshot.
function openSql(playerColumn:string) {
  return `(
    (SELECT COALESCE(SUM(r.cash_out_cents-r.stake_cents+COALESCE(a.amount_cents,0)),0)
     FROM night_results r LEFT JOIN night_adjustments a ON a.night_id=r.night_id AND a.player_id=r.player_id
     WHERE r.player_id=${playerColumn})
    + (SELECT COALESCE(SUM(s.amount_cents),0) FROM settlement_payments s
       WHERE s.from_player_id=${playerColumn} AND s.voided_at IS NULL)
    - (SELECT COALESCE(SUM(s.amount_cents),0) FROM settlement_payments s
       WHERE s.to_player_id=${playerColumn} AND s.voided_at IS NULL)
  )`;
}

export async function decidePayment(env:Env,id:string,reportId:string,value:unknown,confirm:boolean) {
  const data=object(value),request=await getRequest(env,id);
  if (player(data.actorPlayerId)!==request.to_player_id) throw new Error("Bitte das empfangende Spielerprofil wählen.");
  if (request.cancelled_at) throw new Error("Diese Anforderung wurde zurückgezogen.");
  if (!isId(reportId)) throw new Error("Zahlung nicht gefunden.");
  const report=await env.DB.prepare("SELECT id,status,amount_cents FROM payment_reports WHERE id=? AND request_id=?")
    .bind(reportId,id).first<{id:string;status:string;amount_cents:number}>();
  if (!report) throw new Error("Zahlung nicht gefunden.");
  if (report.status!=="reported") throw new Error("Diese Zahlung wurde bereits bearbeitet.");
  const at=now(),paymentId=crypto.randomUUID();
  if (confirm) {
    const results=await env.DB.batch([
      env.DB.prepare(`INSERT INTO settlement_payments
       (id,from_player_id,to_player_id,amount_cents,paid_at,note,client_token,created_at,voided_at,payment_report_id)
       SELECT ?,pr.from_player_id,pr.to_player_id,report.amount_cents,?,NULL,?, ?,NULL,report.id
       FROM payment_reports report JOIN payment_requests pr ON pr.id=report.request_id
       WHERE report.id=? AND pr.id=? AND report.status='reported' AND pr.cancelled_at IS NULL
         AND report.amount_cents<=pr.amount_cents-${requestTotals}
         AND ${openSql("pr.from_player_id")} <= -report.amount_cents
         AND ${openSql("pr.to_player_id")} >= report.amount_cents`)
        .bind(paymentId,at.slice(0,10),crypto.randomUUID(),at,reportId,id),
      env.DB.prepare(`UPDATE payment_reports SET status='confirmed',decided_at=?
        WHERE id=? AND status='reported' AND EXISTS
        (SELECT 1 FROM settlement_payments WHERE id=? AND payment_report_id=?)`)
        .bind(at,reportId,paymentId,reportId),
      env.DB.prepare(`INSERT INTO payment_request_events(id,request_id,to_player_id,kind,created_at)
        SELECT ?,pr.id,pr.from_player_id,'confirmed',?
        FROM payment_requests pr JOIN payment_reports report ON report.request_id=pr.id
        JOIN settlement_payments sp ON sp.payment_report_id=report.id
        WHERE report.id=? AND sp.id=?`).bind(crypto.randomUUID(),at,reportId,paymentId),
    ]);
    if (results[0].meta.changes!==1 || results[1].meta.changes!==1) {
      throw new Error("Die offenen Beträge haben sich geändert. Bitte aktualisieren.");
    }
    return {ok:true};
  }
  const results=await env.DB.batch([
    env.DB.prepare("UPDATE payment_reports SET status='rejected',decided_at=? WHERE id=? AND status='reported'")
      .bind(at,reportId),
    env.DB.prepare(`INSERT INTO payment_request_events(id,request_id,to_player_id,kind,created_at)
      SELECT ?,pr.id,pr.from_player_id,'rejected',?
      FROM payment_reports report JOIN payment_requests pr ON pr.id=report.request_id
      WHERE report.id=? AND report.status='rejected' AND report.decided_at=?`)
      .bind(crypto.randomUUID(),at,reportId,at),
  ]);
  if (results[0].meta.changes!==1) throw new Error("Diese Zahlung wurde bereits bearbeitet.");
  return {ok:true};
}

export async function markEventsRead(env:Env,value:unknown) {
  const data=object(value),playerId=player(data.playerId);
  if (!Array.isArray(data.ids) || data.ids.length>200 || !data.ids.every(v=>typeof v==="string" && isId(v))) {
    throw new Error("Ungültige Nachrichten.");
  }
  const ids=data.ids as string[];
  if (ids.length===0) return {ok:true};
  const slots=ids.map(()=>"?").join(",");
  await env.DB.prepare(`UPDATE payment_request_events SET read_at=?
    WHERE to_player_id=? AND read_at IS NULL AND id IN (${slots})`)
    .bind(now(),playerId,...ids).run();
  return {ok:true};
}
