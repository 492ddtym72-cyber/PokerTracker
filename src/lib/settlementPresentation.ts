import type { SettlementPlayer } from "../types";

/** Missing players are not equivalent to players who have settled their balance. */
export function personalSettlementPlayer(
  players: readonly SettlementPlayer[],
  currentPlayerId: string | null,
): SettlementPlayer | null {
  if (!currentPlayerId) return null;
  return players.find((player) => player.id === currentPlayerId) ?? null;
}

/** Outstanding cash and the original poker result are independent amounts. */
export function personalSettlementBalance(
  players: readonly SettlementPlayer[],
  currentPlayerId: string | null,
): number | null {
  return personalSettlementPlayer(players, currentPlayerId)?.openBalanceCents ?? null;
}

export type PlayerPaymentStatus =
  | { kind: "received" | "to_receive" | "part_receive" | "paid" | "to_pay" | "part_pay" | "neutral"; remainingCents: number };

export function playerPaymentStatus(player: SettlementPlayer): PlayerPaymentStatus {
  if (player.pokerBalanceCents > 0) {
    const remainingCents = Math.max(0, player.openBalanceCents);
    return {
      kind: remainingCents === 0 ? "received" : player.receivedCents > 0 ? "part_receive" : "to_receive",
      remainingCents,
    };
  }
  if (player.pokerBalanceCents < 0) {
    const remainingCents = Math.max(0, -player.openBalanceCents);
    return {
      kind: remainingCents === 0 ? "paid" : player.paidOutCents > 0 ? "part_pay" : "to_pay",
      remainingCents,
    };
  }
  return { kind: "neutral", remainingCents: 0 };
}
