import type { Env } from "../auth";

export interface SettlementPaymentInput {
  fromPlayerId: string;
  toPlayerId: string;
  amountCents: number;
  paidAt: string;
  note?: string;
  clientToken: string;
}

interface BalanceRow {
  player_id: string;
  player_name: string;
  poker_balance_cents: number;
}

interface PaymentRow {
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
}

interface PaymentTotalRow {
  player_id: string;
  paid_out_cents: number;
  received_cents: number;
}

export interface SettlementPlayer {
  id: string;
  name: string;
  pokerBalanceCents: number;
  paidOutCents: number;
  receivedCents: number;
  openBalanceCents: number;
}

function isPlayerId(value: string) {
  return /^player_[a-f0-9]{24}$/.test(value);
}

function buildSuggestions(players: SettlementPlayer[]) {
  const debtors = players
    .filter((player) => player.openBalanceCents < 0)
    .map((player) => ({
      id: player.id,
      name: player.name,
      remaining: -player.openBalanceCents,
    }))
    .sort((a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name, "de"));

  const creditors = players
    .filter((player) => player.openBalanceCents > 0)
    .map((player) => ({
      id: player.id,
      name: player.name,
      remaining: player.openBalanceCents,
    }))
    .sort((a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name, "de"));

  const suggestions: Array<{
    fromPlayerId: string;
    fromPlayerName: string;
    toPlayerId: string;
    toPlayerName: string;
    amountCents: number;
  }> = [];

  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amountCents = Math.min(debtor.remaining, creditor.remaining);

    if (amountCents > 0) {
      suggestions.push({
        fromPlayerId: debtor.id,
        fromPlayerName: debtor.name,
        toPlayerId: creditor.id,
        toPlayerName: creditor.name,
        amountCents,
      });
      debtor.remaining -= amountCents;
      creditor.remaining -= amountCents;
    }

    if (debtor.remaining === 0) debtorIndex += 1;
    if (creditor.remaining === 0) creditorIndex += 1;
  }

  return suggestions;
}

export function validateSettlementPaymentInput(value: unknown): SettlementPaymentInput {
  if (!value || typeof value !== "object") {
    throw new Error("Ungültige Zahlung.");
  }

  const raw = value as Record<string, unknown>;
  const fromPlayerId = typeof raw.fromPlayerId === "string" ? raw.fromPlayerId.trim() : "";
  const toPlayerId = typeof raw.toPlayerId === "string" ? raw.toPlayerId.trim() : "";
  const amountCents = Number(raw.amountCents);
  const paidAt = typeof raw.paidAt === "string" ? raw.paidAt.trim() : "";
  const note = typeof raw.note === "string" ? raw.note.trim() : "";
  const clientToken = typeof raw.clientToken === "string" ? raw.clientToken.trim() : "";

  if (!isPlayerId(fromPlayerId) || !isPlayerId(toPlayerId)) {
    throw new Error("Ungültiger Spieler in der Zahlung.");
  }

  if (fromPlayerId === toPlayerId) {
    throw new Error("Zahler und Empfänger müssen verschieden sein.");
  }

  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > 100_000_000) {
    throw new Error("Ungültiger Zahlungsbetrag.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) {
    throw new Error("Bitte ein gültiges Zahlungsdatum angeben.");
  }

  if (note.length > 200) {
    throw new Error("Die Zahlungsnotiz ist zu lang.");
  }

  if (!/^[a-f0-9-]{20,80}$/i.test(clientToken)) {
    throw new Error("Ungültige Zahlungs-ID.");
  }

  return {
    fromPlayerId,
    toPlayerId,
    amountCents,
    paidAt,
    ...(note ? { note } : {}),
    clientToken,
  };
}

export async function loadSettlementSnapshot(env: Env) {
  const [balanceQuery, paymentTotalsQuery, paymentQuery] = await Promise.all([
    env.DB.prepare(
      `SELECT
         p.id AS player_id,
         p.name AS player_name,
         COALESCE(SUM(
           r.cash_out_cents - r.stake_cents + COALESCE(a.amount_cents, 0)
         ), 0) AS poker_balance_cents
       FROM players p
       JOIN night_results r ON r.player_id = p.id
       LEFT JOIN night_adjustments a
         ON a.night_id = r.night_id AND a.player_id = r.player_id
       GROUP BY p.id, p.name
       ORDER BY p.name COLLATE NOCASE ASC`,
    ).all<BalanceRow>(),
    env.DB.prepare(
      `SELECT
         player_id,
         SUM(paid_out_cents) AS paid_out_cents,
         SUM(received_cents) AS received_cents
       FROM (
         SELECT
           from_player_id AS player_id,
           amount_cents AS paid_out_cents,
           0 AS received_cents
         FROM settlement_payments
         WHERE voided_at IS NULL

         UNION ALL

         SELECT
           to_player_id AS player_id,
           0 AS paid_out_cents,
           amount_cents AS received_cents
         FROM settlement_payments
         WHERE voided_at IS NULL
       )
       GROUP BY player_id`,
    ).all<PaymentTotalRow>(),
    env.DB.prepare(
      `SELECT
         sp.id,
         sp.from_player_id,
         payer.name AS from_player_name,
         sp.to_player_id,
         receiver.name AS to_player_name,
         sp.amount_cents,
         sp.paid_at,
         sp.note,
         sp.created_at,
         sp.voided_at
       FROM settlement_payments sp
       JOIN players payer ON payer.id = sp.from_player_id
       JOIN players receiver ON receiver.id = sp.to_player_id
       ORDER BY sp.paid_at DESC, sp.created_at DESC
       LIMIT 200`,
    ).all<PaymentRow>(),
  ]);

  const players = balanceQuery.results.map<SettlementPlayer>((row) => ({
    id: row.player_id,
    name: row.player_name,
    pokerBalanceCents: Number(row.poker_balance_cents) || 0,
    paidOutCents: 0,
    receivedCents: 0,
    openBalanceCents: Number(row.poker_balance_cents) || 0,
  }));

  const byId = new Map(players.map((player) => [player.id, player]));

  for (const totals of paymentTotalsQuery.results) {
    const player = byId.get(totals.player_id);
    if (!player) continue;

    player.paidOutCents = Number(totals.paid_out_cents) || 0;
    player.receivedCents = Number(totals.received_cents) || 0;
    player.openBalanceCents =
      player.pokerBalanceCents + player.paidOutCents - player.receivedCents;
  }

  const suggestions = buildSuggestions(players);
  const groupDifferenceCents = players.reduce(
    (sum, player) => sum + player.openBalanceCents,
    0,
  );
  const totalOutstandingCents = suggestions.reduce(
    (sum, suggestion) => sum + suggestion.amountCents,
    0,
  );

  return {
    players,
    suggestions,
    payments: paymentQuery.results.map((payment) => ({
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
    totalOutstandingCents,
    groupDifferenceCents,
  };
}

export async function writeSettlementPayment(env: Env, input: SettlementPaymentInput) {
  const existing = await env.DB.prepare(
    "SELECT id FROM settlement_payments WHERE client_token = ? LIMIT 1",
  ).bind(input.clientToken).first<{ id: string }>();

  if (existing?.id) {
    return loadSettlementSnapshot(env);
  }

  const snapshot = await loadSettlementSnapshot(env);
  const payer = snapshot.players.find((player) => player.id === input.fromPlayerId);
  const receiver = snapshot.players.find((player) => player.id === input.toPlayerId);

  if (!payer || !receiver) {
    throw new Error("Der ausgewählte Spieler existiert nicht.");
  }

  if (payer.openBalanceCents >= 0) {
    throw new Error("Der Zahler hat aktuell keine offene Schuld.");
  }

  if (receiver.openBalanceCents <= 0) {
    throw new Error("Der Empfänger hat aktuell keinen offenen Gewinn.");
  }

  const maximumCents = Math.min(-payer.openBalanceCents, receiver.openBalanceCents);
  if (input.amountCents > maximumCents) {
    throw new Error("Die Zahlung ist größer als der aktuell offene Betrag.");
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO settlement_payments
     (id, from_player_id, to_player_id, amount_cents, paid_at, note, client_token, created_at, voided_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).bind(
    crypto.randomUUID(),
    input.fromPlayerId,
    input.toPlayerId,
    input.amountCents,
    input.paidAt,
    input.note ?? null,
    input.clientToken,
    now,
  ).run();

  return loadSettlementSnapshot(env);
}

export async function voidSettlementPayment(env: Env, paymentId: string) {
  const payment = await env.DB.prepare(
    "SELECT id, voided_at FROM settlement_payments WHERE id = ? LIMIT 1",
  ).bind(paymentId).first<{ id: string; voided_at: string | null }>();

  if (!payment?.id) {
    throw new Error("Zahlung nicht gefunden.");
  }

  if (!payment.voided_at) {
    await env.DB.prepare(
      "UPDATE settlement_payments SET voided_at = ? WHERE id = ? AND voided_at IS NULL",
    ).bind(new Date().toISOString(), paymentId).run();
  }

  return loadSettlementSnapshot(env);
}

