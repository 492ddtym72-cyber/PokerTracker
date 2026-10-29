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
