import type { PokerNight } from "../types";

// Keep completed and ongoing isolated sessions discoverable without mutating the source list.
export function getSeparateSessions(nights: readonly PokerNight[]): PokerNight[] {
  return nights
    .filter((night) => night.recordType === "session" && night.settlementMode === "separate")
    .sort((a, b) =>
      b.playedAt.localeCompare(a.playedAt) ||
      b.createdAt.localeCompare(a.createdAt) ||
      a.id.localeCompare(b.id),
    );
}
