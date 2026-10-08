import assert from "node:assert/strict";
import test from "node:test";
import {
  countSettlementFlowCrossings,
  orderSettlementFlow,
} from "../src/lib/settlementFlowLayout.ts";

function transfer(fromPlayerName, toPlayerName, amountCents) {
  return {
    fromPlayerId: fromPlayerName,
    fromPlayerName,
    toPlayerId: toPlayerName,
    toPlayerName,
    amountCents,
  };
}

const existingTransfers = [
  transfer("Denis", "Freddi", 4801),
  transfer("Ferdi", "Freddi", 1753),
  transfer("Ferdi", "Benny", 865),
  transfer("Jonas F.", "Benny", 1420),
  transfer("Charlotte", "Benny", 5168),
  transfer("Theo", "Benny", 3080),
  transfer("Pascal", "Benny", 1125),
  transfer("Niko B", "Benny", 736),
  transfer("Niko B", "Tom", 309),
  transfer("Paul", "Tom", 811),
  transfer("Paul", "Jakob", 234),
];

test("current flow can display all transfers without crossing lines", () => {
  const layout = orderSettlementFlow(existingTransfers);
  assert.equal(layout.payers.length, 8);
  assert.equal(layout.receivers.length, 4);
  assert.equal(
    countSettlementFlowCrossings(existingTransfers, layout.payers, layout.receivers),
    0,
  );
  assert.deepEqual(
    layout.receivers.map((person) => person.name),
    ["Freddi", "Benny", "Tom", "Jakob"],
  );
});

test("layout is deterministic even when suggestions arrive in a different order", () => {
  const original = orderSettlementFlow(existingTransfers);
  const shuffled = orderSettlementFlow([...existingTransfers].reverse());
  assert.deepEqual(shuffled, original);
});

test("layout preserves all payment totals and identities", () => {
  const layout = orderSettlementFlow(existingTransfers);
  const paid = Object.fromEntries(layout.payers.map((payer) => [payer.name, payer.totalCents]));
  const received = Object.fromEntries(layout.receivers.map((receiver) => [receiver.name, receiver.totalCents]));
  assert.equal(paid.Denis, 4801);
  assert.equal(paid.Ferdi, 2618);
  assert.equal(received.Freddi, 6554);
  assert.equal(received.Benny, 12394);
  assert.equal(received.Tom, 1120);
  assert.equal(received.Jakob, 234);
  assert.equal(
    layout.payers.reduce((sum, payer) => sum + payer.totalCents, 0),
    layout.receivers.reduce((sum, receiver) => sum + receiver.totalCents, 0),
  );
});

test("unavoidable crossings are minimized rather than inventing new transfers", () => {
  const transfers = [
    transfer("One", "A", 100),
    transfer("One", "B", 100),
    transfer("Two", "A", 100),
    transfer("Two", "B", 100),
  ];
  const layout = orderSettlementFlow(transfers);
  assert.equal(countSettlementFlowCrossings(transfers, layout.payers, layout.receivers), 1);
  assert.equal(layout.payers.length, 2);
  assert.equal(layout.receivers.length, 2);
});

test("empty or one-sided diagrams remain valid", () => {
  assert.deepEqual(orderSettlementFlow([]), { payers: [], receivers: [] });
  const layout = orderSettlementFlow([
    transfer("P1", "Recipient", 100),
    transfer("P2", "Recipient", 200),
  ]);
  assert.equal(layout.payers.length, 2);
  assert.equal(layout.receivers.length, 1);
  assert.equal(countSettlementFlowCrossings([
    transfer("P1", "Recipient", 100),
    transfer("P2", "Recipient", 200),
  ], layout.payers, layout.receivers), 0);
});

test("larger diagrams still have a bounded, complete ordering", () => {
  const transfers = Array.from({ length: 13 }, (_, index) =>
    transfer("Payer" + index, "Winner" + (index % 5), index + 100),
  );
  const layout = orderSettlementFlow(transfers);
  assert.equal(layout.payers.length, 13);
  assert.equal(layout.receivers.length, 5);
  assert.equal(new Set(layout.payers.map((p) => p.id)).size, 13);
});
