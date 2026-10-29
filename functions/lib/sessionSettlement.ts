import type { Env } from "../auth";
import { reconcileFixedTransfers } from "./fixedTransfers";
import {
  buildSuggestions,
  validateSettlementPaymentInput,
  type SettlementPaymentInput,
  type SettlementPlayer,
} from "./settlement";

type SessionRow = {
  status: "ongoing" | "completed";
  settlement_mode: "pooled" | "separate";
  record_type: "session" | "baseline";
};
type ResultRow = {
  player_id: string;
  player_name: string;
  profit_cents: number;
};
type PaymentRow = {
  id: string;
  from_player_id: string;
  from_player_name: string;
  to_player_id: string;
  to_player_name: string;
  amount_cents: number;
  paid_at: string;
  note: string | null;
  created_at: string;
  voided_at: string | null;
};

async function requireSeparateCompletedNight(env: Env, nightId: string) {
  const night = await env.DB.prepare(
    "SELECT status, settlement_mode, record_type FROM poker_nights WHERE id=?",
  ).bind(nightId).first<SessionRow>();
  if (!night) throw new Error("Pokerabend nicht gefunden.");
  if (night.record_type !== "session" || night.settlement_mode !== "separate") {
    throw new Error("Diese Session wird über die Gesamtbilanz abgerechnet.");
  }
  if (night.status !== "completed") {
    throw new Error("Die Session muss vor der Abrechnung abgeschlossen sein.");
  }
}

export async function loadSessionSettlement(env: Env, nightId: string) {
  await requireSeparateCompletedNight(env, nightId);
  const [results, paymentRows] = await Promise.all([
    env.DB.prepare(`
      SELECT r.player_id, p.name AS player_name,
        (r.cash_out_cents - r.stake_cents + COALESCE(a.amount_cents,0)) AS profit_cents
      FROM night_results r
      JOIN players p ON p.id=r.player_id
      LEFT JOIN night_adjustments a ON a.night_id=r.night_id AND a.player_id=r.player_id
      WHERE r.night_id=?
      ORDER BY p.name COLLATE NOCASE ASC
    `).bind(nightId).all<ResultRow>(),
    env.DB.prepare(`
      SELECT sp.id, sp.from_player_id, payer.name AS from_player_name,
        sp.to_player_id, receiver.name AS to_player_name,
        sp.amount_cents, sp.paid_at, sp.note, sp.created_at, sp.voided_at
      FROM session_settlement_payments sp
      JOIN players payer ON payer.id=sp.from_player_id
      JOIN players receiver ON receiver.id=sp.to_player_id
      WHERE sp.night_id=?
      ORDER BY sp.paid_at DESC, sp.created_at DESC
      LIMIT 200
    `).bind(nightId).all<PaymentRow>(),
  ]);

  const players: SettlementPlayer[] = results.results.map(row => ({
    id: row.player_id,
    name: row.player_name,
    pokerBalanceCents: Number(row.profit_cents) || 0,
    paidOutCents: 0,
    receivedCents: 0,
    openBalanceCents: Number(row.profit_cents) || 0,
  }));
  const byPlayer = new Map(players.map(player => [player.id, player]));
  for (const payment of paymentRows.results) {
    if (payment.voided_at) continue;
    const from = byPlayer.get(payment.from_player_id);
    const to = byPlayer.get(payment.to_player_id);
    if (from) {
      from.paidOutCents += payment.amount_cents;
      from.openBalanceCents += payment.amount_cents;
    }
    if (to) {
      to.receivedCents += payment.amount_cents;
      to.openBalanceCents -= payment.amount_cents;
    }
  }

  const groupDifferenceCents = players.reduce((sum, player) => sum + player.pokerBalanceCents, 0);
  const {plan,suggestions,unmatchedPaymentCents} = groupDifferenceCents === 0
    ? reconcileFixedTransfers(buildSuggestions(players.map(p=>({...p,openBalanceCents:p.pokerBalanceCents}))),paymentRows.results)
    : {plan:[],suggestions:[],unmatchedPaymentCents:0};
  return {
    nightId,
    players,
    plan,
    suggestions,
    unmatchedPaymentCents,
    payments: paymentRows.results.map(payment => ({
      id: payment.id,
      fromPlayerId: payment.from_player_id,
      fromPlayerName: payment.from_player_name,
      toPlayerId: payment.to_player_id,
      toPlayerName: payment.to_player_name,
      amountCents: payment.amount_cents,
      paidAt: payment.paid_at,
      note: payment.note,
      createdAt: payment.created_at,
      voidedAt: payment.voided_at,
    })),
    groupDifferenceCents,
    totalOutstandingCents: suggestions.reduce((sum, suggestion) => sum + suggestion.amountCents, 0),
    ongoingSessionCount: 0,
  };
}

export async function recordSessionPayment(env: Env, nightId: string, raw: unknown) {
  const input: SettlementPaymentInput = validateSettlementPaymentInput(raw);
  const existing = await env.DB.prepare(
    "SELECT night_id FROM session_settlement_payments WHERE client_token=?",
  ).bind(input.clientToken).first<{night_id: string}>();
  if (existing) {
    if (existing.night_id !== nightId) throw new Error("Ungültige Zahlungs-ID.");
    return loadSessionSettlement(env, nightId);
  }
  const snapshot = await loadSessionSettlement(env, nightId);
  if (snapshot.groupDifferenceCents !== 0) {
    throw new Error("Die Session ist noch nicht vollständig ausgeglichen.");
  }
  const transfer = snapshot.suggestions.find(s => s.fromPlayerId === input.fromPlayerId && s.toPlayerId === input.toPlayerId);
  if (!transfer || input.amountCents > transfer.amountCents) {
    throw new Error("Diese Zahlung gehört nicht zum offenen Ausgleichsplan.");
  }
  const payer = snapshot.players.find(player => player.id === input.fromPlayerId);
  const receiver = snapshot.players.find(player => player.id === input.toPlayerId);
  if (!payer || !receiver) throw new Error("Spieler gehört nicht zu dieser Session.");
  if (payer.openBalanceCents >= 0 || receiver.openBalanceCents <= 0) {
    throw new Error("Für diese Spieler besteht kein offener Ausgleich.");
  }
  if (input.amountCents > Math.min(-payer.openBalanceCents, receiver.openBalanceCents)) {
    throw new Error("Die Zahlung übersteigt den offenen Betrag dieser Session.");
  }

  await env.DB.prepare(`
    INSERT INTO session_settlement_payments
      (id, night_id, from_player_id, to_player_id, amount_cents, paid_at, note, client_token, created_at, voided_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `).bind(
    crypto.randomUUID(), nightId, input.fromPlayerId, input.toPlayerId,
    input.amountCents, input.paidAt, input.note ?? null,
    input.clientToken, new Date().toISOString(),
  ).run();
  return loadSessionSettlement(env, nightId);
}

export async function voidSessionPayment(env: Env, nightId: string, paymentId: string) {
  await requireSeparateCompletedNight(env, nightId);
  const result = await env.DB.prepare(
    "SELECT id FROM session_settlement_payments WHERE id=? AND night_id=?",
  ).bind(paymentId, nightId).first<{id: string}>();
  if (!result) throw new Error("Zahlung nicht gefunden.");
  await env.DB.prepare(
    "UPDATE session_settlement_payments SET voided_at=? WHERE id=? AND night_id=? AND voided_at IS NULL",
  ).bind(new Date().toISOString(), paymentId, nightId).run();
  return loadSessionSettlement(env, nightId);
}
