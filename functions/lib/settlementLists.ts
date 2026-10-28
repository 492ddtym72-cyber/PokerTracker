import type { Env } from "../auth";
import {
  buildSuggestions,
  loadSettlementSnapshot,
  validateSettlementPaymentInput,
  type SettlementPlayer,
} from "./settlement";

export const RIGA_LIST_ID = "riga-legacy";
export type ListStatus = "open" | "paying_out" | "closed";
interface ListRow { id: string; name: string; status: ListStatus; created_at: string; updated_at: string }
interface CountRow { list_id: string; total: number; completed: number; people: number }
interface ResultRow { player_id: string; player_name: string; balance: number }
interface PaymentRow {
  id: string; from_player_id: string; from_player_name: string;
  to_player_id: string; to_player_name: string; amount_cents: number;
  paid_at: string; note: string | null; created_at: string; voided_at: string | null;
}
const validId = (value: string) => /^[a-f0-9-]{36}$/i.test(value);
function assertId(value: string) {
  if (!validId(value)) throw new Error("Ungültige Abrechnungsliste.");
}
async function requireList(env: Env, id: string) {
  assertId(id);
  const row = await env.DB.prepare("SELECT id,name,status,created_at,updated_at FROM settlement_lists WHERE id=?")
    .bind(id).first<ListRow>();
  if (!row) throw new Error("Abrechnungsliste nicht gefunden.");
  return row;
}

export async function listSettlementLists(env: Env) {
  const [lists, counts, legacyNights, legacy] = await Promise.all([
    env.DB.prepare("SELECT * FROM settlement_lists ORDER BY created_at DESC").all<ListRow>(),
    env.DB.prepare(`SELECT m.list_id,COUNT(DISTINCT m.night_id) AS total,
        COUNT(DISTINCT CASE WHEN n.status='completed' THEN m.night_id END) AS completed,
        COUNT(DISTINCT r.player_id) AS people
      FROM settlement_list_nights m
      JOIN poker_nights n ON n.id=m.night_id
      LEFT JOIN night_results r ON r.night_id=n.id
      GROUP BY m.list_id`).all<CountRow>(),
    env.DB.prepare(`SELECT COUNT(*) AS count,
        SUM(CASE WHEN n.status='completed' THEN 1 ELSE 0 END) AS completed
      FROM poker_nights n
      WHERE n.settlement_mode='pooled' AND n.record_type='session'
      AND NOT EXISTS (SELECT 1 FROM settlement_list_nights m WHERE m.night_id=n.id)`)
      .first<{count:number;completed:number}>(),
    loadSettlementSnapshot(env),
  ]);
  const countsById = new Map(counts.results.map(row=>[row.list_id,row]));
  const result = [{
    id: RIGA_LIST_ID, name: "Riga", status: "paying_out" as ListStatus,
    totalSessions: Number(legacyNights?.count)||0, completedSessions: Number(legacyNights?.completed)||0,
    playerCount: legacy.players.length,
    totalOutstandingCents: legacy.totalOutstandingCents,
    groupDifferenceCents: legacy.groupDifferenceCents,
    legacy: true,
  }];
  for (const list of lists.results) {
    const count = countsById.get(list.id);
    const snapshot = await loadListSnapshot(env,list.id);
    result.push({
      id:list.id,name:list.name,status:list.status,
      totalSessions:Number(count?.total)||0, completedSessions:Number(count?.completed)||0,
      playerCount:Number(count?.people)||0,
      totalOutstandingCents:snapshot.totalOutstandingCents,
      groupDifferenceCents:snapshot.groupDifferenceCents,
      legacy:false,
    });
  }
  return { lists: result };
}

export async function createSettlementList(env: Env, raw: unknown) {
  if (!raw || typeof raw!=="object") throw new Error("Ungültige Abrechnungsliste.");
  const body = raw as Record<string,unknown>;
  const name=typeof body.name==="string" ? body.name.trim().replace(/\s+/g," ") : "";
  if (name.length<2 || name.length>60 || name.toLocaleLowerCase("de")==="riga")
    throw new Error("Bitte einen anderen Namen mit 2–60 Zeichen wählen.");
  const id=crypto.randomUUID(), now=new Date().toISOString();
  await env.DB.prepare("INSERT INTO settlement_lists(id,name,status,created_at,updated_at) VALUES (?,?,'open',?,?)")
    .bind(id,name,now,now).run();
  return {id,name,status:"open" as const};
}

export async function setSettlementListStatus(env:Env,id:string,raw:unknown) {
  const list=await requireList(env,id);
  if (!raw || typeof raw!=="object") throw new Error("Ungültiger Status.");
  const status=(raw as Record<string,unknown>).status;
  if (status!=="paying_out" && status!=="closed") throw new Error("Ungültiger Status.");
  if (list.status==="closed" || (status==="paying_out" && list.status!=="open")
    || (status==="closed" && list.status!=="paying_out"))
    throw new Error("Diese Statusänderung ist nicht erlaubt.");
  if (status==="paying_out") {
    const unfinished=await env.DB.prepare(`SELECT 1 AS found FROM settlement_list_nights m
      JOIN poker_nights n ON n.id=m.night_id WHERE m.list_id=? AND n.status='ongoing' LIMIT 1`)
      .bind(id).first<{found:number}>();
    if (unfinished) throw new Error("Laufende Sessions müssen zuerst abgeschlossen werden.");
  }
  if (status==="closed") {
    const snapshot=await loadListSnapshot(env,id);
    if (snapshot.totalOutstandingCents!==0 || snapshot.groupDifferenceCents!==0)
      throw new Error("Offene Zahlungen müssen vor dem Abschließen beglichen werden.");
  }
  const r=await env.DB.prepare(
    "UPDATE settlement_lists SET status=?,updated_at=? WHERE id=? AND status=?"
  ).bind(status,new Date().toISOString(),id,list.status).run();
  if (r.meta.changes!==1) throw new Error("Die Abrechnungsliste wurde inzwischen verändert.");
  return {id,status};
}

export async function requireOpenList(env: Env,id:string) {
  const list=await requireList(env,id);
  if (list.status!=="open") throw new Error("Diese Abrechnungsliste nimmt keine Sessions mehr an.");
  const paid = await env.DB.prepare("SELECT 1 AS found FROM settlement_list_payments WHERE list_id=? LIMIT 1")
    .bind(id).first<{found:number}>();
  if (paid) throw new Error("Diese Abrechnung enthält bereits Zahlungen und ist gesperrt.");
  return list;
}

export async function requireEditableNightDestination(env:Env,nightId:string) {
  const row=await env.DB.prepare(`SELECT m.list_id,l.status FROM settlement_list_nights m
    JOIN settlement_lists l ON l.id=m.list_id WHERE m.night_id=?`)
    .bind(nightId).first<{list_id:string;status:ListStatus}>();
  if (row?.status!=="open" && row) throw new Error("Diese Abrechnung wird bereits ausgezahlt und ist gesperrt.");
  return row?.list_id ?? null;
}

export async function loadListSnapshot(env:Env,id:string) {
  const list=await requireList(env,id);
  const [results,payments,ongoing]=await Promise.all([
    env.DB.prepare(`SELECT r.player_id,p.name AS player_name,
        SUM(r.cash_out_cents-r.stake_cents+COALESCE(a.amount_cents,0)) AS balance
      FROM settlement_list_nights m
      JOIN poker_nights n ON n.id=m.night_id AND n.status='completed'
      JOIN night_results r ON r.night_id=n.id
      JOIN players p ON p.id=r.player_id
      LEFT JOIN night_adjustments a ON a.night_id=n.id AND a.player_id=r.player_id
      WHERE m.list_id=?
      GROUP BY r.player_id,p.name ORDER BY p.name COLLATE NOCASE`).bind(id).all<ResultRow>(),
    env.DB.prepare(`SELECT sp.id,sp.from_player_id,p1.name AS from_player_name,
      sp.to_player_id,p2.name AS to_player_name,sp.amount_cents,
      sp.paid_at,sp.note,sp.created_at,sp.voided_at
      FROM settlement_list_payments sp
      JOIN players p1 ON p1.id=sp.from_player_id
      JOIN players p2 ON p2.id=sp.to_player_id
      WHERE sp.list_id=?
      ORDER BY sp.paid_at DESC,sp.created_at DESC`).bind(id).all<PaymentRow>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM settlement_list_nights m
      JOIN poker_nights n ON n.id=m.night_id WHERE m.list_id=? AND n.status='ongoing'`)
      .bind(id).first<{count:number}>(),
  ]);
  const players: SettlementPlayer[]=results.results.map(row=>({
    id:row.player_id,name:row.player_name,pokerBalanceCents:Number(row.balance)||0,
    paidOutCents:0,receivedCents:0,openBalanceCents:Number(row.balance)||0
  }));
  const byId=new Map(players.map(p=>[p.id,p]));
  for(const payment of payments.results) {
    if(payment.voided_at) continue;
    const payer=byId.get(payment.from_player_id),receiver=byId.get(payment.to_player_id);
    if(payer) {payer.paidOutCents+=payment.amount_cents;payer.openBalanceCents+=payment.amount_cents;}
    if(receiver) {receiver.receivedCents+=payment.amount_cents;receiver.openBalanceCents-=payment.amount_cents;}
  }
  const groupDifferenceCents=players.reduce((sum,p)=>sum+p.pokerBalanceCents,0);
  const suggestions=groupDifferenceCents===0?buildSuggestions(players):[];
  const totalOutstandingCents=suggestions.reduce((sum,p)=>sum+p.amountCents,0);
  return {
    listId:id,listName:list.name,status:list.status,
    players,suggestions,payments:payments.results.map(p=>({
      id:p.id,fromPlayerId:p.from_player_id,fromPlayerName:p.from_player_name,
      toPlayerId:p.to_player_id,toPlayerName:p.to_player_name,
      amountCents:p.amount_cents,paidAt:p.paid_at,note:p.note,
      createdAt:p.created_at,voidedAt:p.voided_at,
    })),groupDifferenceCents,totalOutstandingCents,
    ongoingSessionCount:Number(ongoing?.count)||0,
  };
}

export async function recordListPayment(env:Env,id:string,raw:unknown) {
  const list=await requireList(env,id);
  if(list.status==="closed") throw new Error("Diese Abrechnung ist abgeschlossen.");
  const input=validateSettlementPaymentInput(raw);
  const existing=await env.DB.prepare("SELECT list_id FROM settlement_list_payments WHERE client_token=?")
    .bind(input.clientToken).first<{list_id:string}>();
  if(existing) {
    if(existing.list_id!==id) throw new Error("Zahlungs-ID gehört zu einer anderen Abrechnung.");
    return loadListSnapshot(env,id);
  }
  const snapshot=await loadListSnapshot(env,id);
  if(snapshot.ongoingSessionCount>0) throw new Error("Laufende Sessions müssen zuerst abgeschlossen werden.");
  if(snapshot.groupDifferenceCents!==0) throw new Error("Diese Abrechnung hat noch eine Differenz.");
  const payer=snapshot.players.find(p=>p.id===input.fromPlayerId);
  const receiver=snapshot.players.find(p=>p.id===input.toPlayerId);
  if(!payer || !receiver || payer.openBalanceCents>=0 || receiver.openBalanceCents<=0)
    throw new Error("Für diese Personen besteht kein offener Ausgleich.");
  if(input.amountCents>Math.min(-payer.openBalanceCents,receiver.openBalanceCents))
    throw new Error("Der Betrag übersteigt den offenen Ausgleich.");
  // The first recorded payment starts payout automatically. The batch ensures the
  // payment and lock are committed together, with no partial transition.
  const now=new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO settlement_list_payments
      (id,list_id,from_player_id,to_player_id,amount_cents,paid_at,note,client_token,created_at,voided_at)
      VALUES (?,?,?,?,?,?,?,?,?,NULL)`)
      .bind(crypto.randomUUID(),id,input.fromPlayerId,input.toPlayerId,
        input.amountCents,input.paidAt,input.note??null,input.clientToken,now),
    env.DB.prepare("UPDATE settlement_lists SET status='paying_out',updated_at=? WHERE id=? AND status='open'")
      .bind(now,id),
  ]);
  return loadListSnapshot(env,id);
}

export async function voidListPayment(env:Env,id:string,paymentId:string) {
  const list=await requireList(env,id);
  if(list.status==="closed") throw new Error("Diese Abrechnung ist abgeschlossen.");
  const payment=await env.DB.prepare("SELECT id FROM settlement_list_payments WHERE id=? AND list_id=?")
    .bind(paymentId,id).first<{id:string}>();
  if(!payment) throw new Error("Zahlung nicht gefunden.");
  await env.DB.prepare("UPDATE settlement_list_payments SET voided_at=? WHERE id=? AND list_id=? AND voided_at IS NULL")
    .bind(new Date().toISOString(),paymentId,id).run();
  return loadListSnapshot(env,id);
}
