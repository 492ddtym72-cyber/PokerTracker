import test from "node:test";
import assert from "node:assert/strict";
import { personalSettlementBalance } from "../src/lib/settlementPresentation.ts";

const member = (id, openBalanceCents) => ({
  id, name: id, openBalanceCents,
  pokerBalanceCents: openBalanceCents,
  paidOutCents: 0, receivedCents: 0,
});

test("personal balance uses only the selected participant in the chosen ledger", () => {
  const riga = [member("Freddi", 6554), member("Denis", -4801)];
  const felix = [member("Freddi", 25), member("Felix", -2975)];
  const schanze = [member("Freddi", -1650), member("Charlotte", 1650)];
  assert.equal(personalSettlementBalance(riga, "Freddi"), 6554);
  assert.equal(personalSettlementBalance(felix, "Freddi"), 25);
  assert.equal(personalSettlementBalance(schanze, "Freddi"), -1650);
  assert.equal(personalSettlementBalance(felix, "Felix"), -2975);
});

test("not participating is different from a fully paid-out zero balance", () => {
  assert.equal(personalSettlementBalance([member("Freddi", 0)], "Freddi"), 0);
  assert.equal(personalSettlementBalance([member("Felix", -100)], "Freddi"), null);
  assert.equal(personalSettlementBalance([], "Freddi"), null);
  assert.equal(personalSettlementBalance([member("Freddi", 42)], null), null);
});

test("poker result does not change as its payment becomes settled", async () => {
  const { playerPaymentStatus, personalSettlementPlayer } = await import("../src/lib/settlementPresentation.ts");
  const winning = { id: "Freddi", name: "Freddi", pokerBalanceCents: 25, openBalanceCents: 25, receivedCents: 0, paidOutCents: 0 };
  assert.equal(playerPaymentStatus(winning).kind, "to_receive");
  const partial = { ...winning, openBalanceCents: 10, receivedCents: 15 };
  assert.deepEqual(playerPaymentStatus(partial), { kind: "part_receive", remainingCents: 10 });
  const paid = { ...winning, openBalanceCents: 0, receivedCents: 25 };
  assert.deepEqual(playerPaymentStatus(paid), { kind: "received", remainingCents: 0 });
  assert.equal(personalSettlementPlayer([paid], "Freddi")?.pokerBalanceCents, 25);
  assert.equal(personalSettlementPlayer([paid], "Felix"), null);
});

test("losses stay negative before and after payment", async () => {
  const { playerPaymentStatus } = await import("../src/lib/settlementPresentation.ts");
  const losing = { id: "Felix", name: "Felix", pokerBalanceCents: -2950, openBalanceCents: -2950, receivedCents: 0, paidOutCents: 0 };
  assert.equal(playerPaymentStatus(losing).kind, "to_pay");
  assert.deepEqual(playerPaymentStatus({ ...losing, openBalanceCents: -1000, paidOutCents: 1950 }),
    { kind: "part_pay", remainingCents: 1000 });
  assert.deepEqual(playerPaymentStatus({ ...losing, openBalanceCents: 0, paidOutCents: 2950 }),
    { kind: "paid", remainingCents: 0 });
  assert.equal(playerPaymentStatus({ ...losing, pokerBalanceCents: 0, openBalanceCents: 0 }).kind, "neutral");
});
