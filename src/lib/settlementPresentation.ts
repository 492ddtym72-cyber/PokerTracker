import type { SettlementPlayer } from "../types";

/** A selected profile only has a balance where they participated.
 * Return null rather than inventing a 0 € balance for other groups.
 */
export function personalSettlementBalance(
  players: readonly SettlementPlayer[],
  currentPlayerId: string | null,
): number | null {
  if (!currentPlayerId) return null;
  return players.find((player) => player.id === currentPlayerId)?.openBalanceCents ?? null;
}
