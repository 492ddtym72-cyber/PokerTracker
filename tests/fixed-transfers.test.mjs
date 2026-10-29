import assert from "node:assert/strict";
import test from "node:test";
import { reconcileFixedTransfers } from "../functions/lib/fixedTransfers.ts";

const original = [
  { fromPlayerId: "freddi", fromPlayerName: "Freddi", toPlayerId: "nico-s", toPlayerName: "Nico S", amountCents: 893 },
  { fromPlayerId: "freddi", fromPlayerName: "Freddi", toPlayerId: "niko", toPlayerName: "Niko", amountCents: 335 },
  { fromPlayerId: "felix", fromPlayerName: "Felix", toPlayerId: "niko", toPlayerName: "Niko", amountCents: 323 },
  { fromPlayerId: "felix", fromPlayerName: "Felix", toPlayerId: "ferdi", toPlayerName: "Ferdi", amountCents: 269 },
];
function payment(from, to, cents, voided = null) {
  return { from_player_id: from, to_player_id: to, amount_cents: cents, voided_at: voided };
}

test("paying one route never moves another payer or recipient", () => {
  const first = reconcileFixedTransfers(original, []);
  const after = reconcileFixedTransfers(original, [payment("freddi", "nico-s", 893)]);
  assert.deepEqual(after.plan.map(({ fromPlayerId, toPlayerId, amountCents }) => ({ fromPlayerId, toPlayerId, amountCents })),
    original.map(({ fromPlayerId, toPlayerId, amountCents }) => ({ fromPlayerId, toPlayerId, amountCents })));
  assert.equal(after.plan[0].remainingCents, 0);
  assert.deepEqual(after.suggestions, original.slice(1));
  assert.equal(after.suggestions.reduce((sum,p) => sum + p.amountCents,0),
    first.suggestions.reduce((sum,p) => sum + p.amountCents,0) - 893);
});

test("partial payments only reduce the matching route", () => {
  const plan = reconcileFixedTransfers(original, [payment("freddi","niko",100)]);
  assert.deepEqual(plan.plan.map(p => p.remainingCents), [893,235,323,269]);
  assert.equal(plan.plan[1].amountCents, 335);
  assert.equal(plan.plan[1].paidCents, 100);
});

test("undo restores the same transfer, never recalculating", () => {
  const paid = reconcileFixedTransfers(original,[payment("felix","ferdi",269)]);
  const undone = reconcileFixedTransfers(original,[payment("felix","ferdi",269,"2026-10-29")]);
  assert.equal(paid.plan[3].remainingCents,0);
  assert.deepEqual(undone.suggestions,original);
  assert.deepEqual(undone.plan.map(x => x.amountCents),original.map(x=>x.amountCents));
});

test("multiple partial payments and duplicate routes cannot overconsume", () => {
  const repeated = [original[1], {...original[1],amountCents:100}];
  const reconciled = reconcileFixedTransfers(repeated,[payment("freddi","niko",380)]);
  assert.deepEqual(reconciled.plan.map(p => p.remainingCents),[0,55]);
  assert.equal(reconciled.unmatchedPaymentCents,0);
});

test("historical off-plan payments remain unmodified and detectable", () => {
  const old = payment("freddi","ferdi",300);
  const after = reconcileFixedTransfers(original,[old]);
  assert.equal(after.unmatchedPaymentCents,300);
  assert.deepEqual(after.plan.map(p=>p.amountCents),original.map(p=>p.amountCents));
  assert.equal(old.amount_cents,300);
});
