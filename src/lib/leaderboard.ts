import type { PokerNight } from "../types";

// Player statistics describe completed poker results, independent of how
// their real-world payments are settled.
export interface PlayerStats {
  id: string;
  name: string;
  nights: number;
  stakeCents: number;
  cashOutCents: number;
  profitCents: number;
  wins: number;
}

export interface PlayerAppearance {
  playedAt: string;
  createdAt: string;
  resultCents: number;
}

export function getCompletedStatisticNights(nights: readonly PokerNight[]): PokerNight[] {
  return nights.filter((night) => night.status === "completed");
}

export function calculateLeaderboardStats(nights: readonly PokerNight[]): PlayerStats[] {
  const byPlayer = new Map<string, PlayerStats>();

  for (const night of nights) {
    // Both pooled and separately settled sessions belong to the leaderboard.
    // Ongoing sessions must not contribute provisional amounts.
    if (night.status !== "completed") continue;
    const countsAsSession = night.recordType === "session";

    for (const player of night.players) {
      const existing = byPlayer.get(player.id) ?? {
        id: player.id,
        name: player.name,
        nights: 0,
        stakeCents: 0,
        cashOutCents: 0,
        profitCents: 0,
        wins: 0,
      };

      const profit = player.cashOutCents - player.stakeCents + (player.adjustmentCents ?? 0);
      existing.name = player.name;
      existing.profitCents += profit;
      existing.stakeCents += player.stakeCents;
      existing.cashOutCents += player.cashOutCents;

      // Historical baseline records affect cumulative profit, but are not games.
      if (countsAsSession) {
        existing.nights += 1;
        if (profit > 0) existing.wins += 1;
      }

      byPlayer.set(player.id, existing);
    }
  }

  return Array.from(byPlayer.values()).sort(
    (a, b) =>
      b.profitCents - a.profitCents ||
      b.nights - a.nights ||
      a.name.localeCompare(b.name),
  );
}

export function getPlayerAppearances(
  nights: readonly PokerNight[],
  playerId: string,
): PlayerAppearance[] {
  return nights
    .filter((night) => night.recordType === "session" && night.status === "completed")
    .flatMap((night) => {
      const result = night.players.find((candidate) => candidate.id === playerId);
      return result
        ? [{
            playedAt: night.playedAt,
            createdAt: night.createdAt,
            resultCents: result.cashOutCents - result.stakeCents + (result.adjustmentCents ?? 0),
          }]
        : [];
    })
    .sort(
      (a, b) =>
        a.playedAt.localeCompare(b.playedAt) ||
        a.createdAt.localeCompare(b.createdAt),
    );
}
