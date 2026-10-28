import test from "node:test";
import assert from "node:assert/strict";
import { getSeparateSessions } from "../src/lib/separateSessions.ts";

test("only separate session records appear, including ongoing ones", () => {
  const mk = (id, recordType, settlementMode, status, playedAt, createdAt = playedAt) =>
    ({ id, recordType, settlementMode, status, playedAt, createdAt, players: [] });
  const input = [
    mk("pooled", "session", "pooled", "completed", "2026-10-28"),
    mk("baseline", "baseline", "separate", "completed", "2026-10-28"),
    mk("earlier", "session", "separate", "completed", "2026-10-20"),
    mk("ongoing", "session", "separate", "ongoing", "2026-10-27"),
    mk("latest", "session", "separate", "completed", "2026-10-28"),
  ];
  assert.deepEqual(getSeparateSessions(input).map(s => s.id), ["latest", "ongoing", "earlier"]);
  assert.equal(input[0].id, "pooled", "the caller's session order is preserved");
});

test("empty and legacy pooled inputs are safe", () => {
  assert.deepEqual(getSeparateSessions([]), []);
  assert.deepEqual(getSeparateSessions([{ recordType: "session", settlementMode: "pooled" }]), []);
});
