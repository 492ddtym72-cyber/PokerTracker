import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateLeaderboardStats,
  getCompletedStatisticNights,
  getPlayerAppearances,
} from "../src/lib/leaderboard.ts";

const player = (id, stakeCents, cashOutCents, adjustmentCents = 0) => ({
  id, name: id, stakeCents, cashOutCents, adjustmentCents,
});
const night = (id, settlementMode, status, recordType, playedAt, players) => ({
  id, settlementMode, status, recordType, playedAt,
  createdAt: playedAt + "T20:00:00Z", players,
});

test("both settlement modes affect leaderboard, while ongoing games do not", () => {
  const games = [
    night("ongoing", "separate", "ongoing", "session", "2026-10-03", [
      player("A", 6000, 12000), player("B", 6000, 0),
    ]),
    night("separate", "separate", "completed", "session", "2026-10-02", [
      player("A", 1800, 1100, -100), player("B", 1200, 2000),
    ]),
    night("pooled", "pooled", "completed", "session", "2026-10-01", [
      player("A", 2000, 3000), player("B", 2000, 1000),
    ]),
    night("baseline", "pooled", "completed", "baseline", "2025-12-31", [
      player("A", 0, 5000),
    ]),
  ];
  const stats = calculateLeaderboardStats(games);
  assert.deepEqual(stats, [
    { id: "A", name: "A", nights: 2, stakeCents: 3800, cashOutCents: 9100, profitCents: 5200, wins: 1 },
    { id: "B", name: "B", nights: 2, stakeCents: 3200, cashOutCents: 3000, profitCents: -200, wins: 1 },
  ]);
  assert.deepEqual(getCompletedStatisticNights(games).map((game) => game.id), ["separate", "pooled", "baseline"]);
  assert.equal(getCompletedStatisticNights(games).filter((game) => game.recordType === "session").length, 2);
  assert.equal(
    getCompletedStatisticNights(games).reduce(
      (total, game) => total + game.players.reduce((stake, p) => stake + p.stakeCents, 0), 0,
    ),
    7000,
  );
  assert.deepEqual(getPlayerAppearances(games, "A").map((appearance) => appearance.resultCents), [1000, -800]);
  assert.equal(games[0].id, "ongoing", "calculations must not reorder the input list");
});

test("a player who has only played separately settled sessions appears in rankings and trends", () => {
  const games = [
    night("separate", "separate", "completed", "session", "2026-10-28", [
      player("new-player", 1200, 1800),
      player("other-player", 1200, 600),
    ]),
  ];
  const stats = calculateLeaderboardStats(games);
  assert.equal(stats[0].id, "new-player");
  assert.equal(stats[0].profitCents, 600);
  assert.equal(stats[0].nights, 1);
  assert.deepEqual(getPlayerAppearances(games, "new-player").map((a) => a.resultCents), [600]);
});

test("baseline records never count as played games; no double-counting when status changes", () => {
  const pending = night("pending", "separate", "ongoing", "session", "2026-10-28", [
    player("A", 1000, 1500),
  ]);
  const baseline = night("baseline", "pooled", "completed", "baseline", "2025-01-01", [
    player("A", 0, 200),
  ]);
  assert.deepEqual(calculateLeaderboardStats([pending, baseline]), [
    { id: "A", name: "A", nights: 0, stakeCents: 0, cashOutCents: 200, profitCents: 200, wins: 0 },
  ]);
  const completed = { ...pending, status: "completed" };
  assert.equal(calculateLeaderboardStats([completed, baseline])[0].profitCents, 700);
  assert.equal(calculateLeaderboardStats([completed, baseline])[0].nights, 1);
  assert.deepEqual(getPlayerAppearances([pending, baseline], "A"), []);
  assert.deepEqual(calculateLeaderboardStats([]), []);
});
