/**
 * Produces an ordered two-column settlement diagram without changing
 * the underlying payment suggestions.
 */

export interface SettlementFlowTransfer {
  fromPlayerId: string;
  fromPlayerName: string;
  toPlayerId: string;
  toPlayerName: string;
  amountCents: number;
}

export interface SettlementFlowPerson {
  id: string;
  name: string;
  totalCents: number;
}

export interface SettlementFlowOrder {
  payers: SettlementFlowPerson[];
  receivers: SettlementFlowPerson[];
}

function byAmountThenName(a: SettlementFlowPerson, b: SettlementFlowPerson) {
  return (
    b.totalCents - a.totalCents ||
    a.name.localeCompare(b.name, "de") ||
    a.id.localeCompare(b.id)
  );
}

function getPeople(transfers: readonly SettlementFlowTransfer[]): SettlementFlowOrder {
  const payerMap = new Map<string, SettlementFlowPerson>();
  const receiverMap = new Map<string, SettlementFlowPerson>();

  for (const transfer of transfers) {
    const payer = payerMap.get(transfer.fromPlayerId) ?? {
      id: transfer.fromPlayerId,
      name: transfer.fromPlayerName,
      totalCents: 0,
    };
    payer.totalCents += transfer.amountCents;
    payerMap.set(payer.id, payer);

    const receiver = receiverMap.get(transfer.toPlayerId) ?? {
      id: transfer.toPlayerId,
      name: transfer.toPlayerName,
      totalCents: 0,
    };
    receiver.totalCents += transfer.amountCents;
    receiverMap.set(receiver.id, receiver);
  }

  return {
    payers: [...payerMap.values()].sort(byAmountThenName),
    receivers: [...receiverMap.values()].sort(byAmountThenName),
  };
}

/** Count edge crossings between different payer and recipient nodes. */
export function countSettlementFlowCrossings(
  transfers: readonly SettlementFlowTransfer[],
  payers: readonly SettlementFlowPerson[],
  receivers: readonly SettlementFlowPerson[],
): number {
  const payerRanks = new Map(payers.map((payer, index) => [payer.id, index]));
  const receiverRanks = new Map(receivers.map((receiver, index) => [receiver.id, index]));
  let crossings = 0;

  for (let i = 0; i < transfers.length; i += 1) {
    const first = transfers[i];
    const firstPayer = payerRanks.get(first.fromPlayerId);
    const firstReceiver = receiverRanks.get(first.toPlayerId);
    if (firstPayer === undefined || firstReceiver === undefined) continue;

    for (let j = i + 1; j < transfers.length; j += 1) {
      const second = transfers[j];
      const secondPayer = payerRanks.get(second.fromPlayerId);
      const secondReceiver = receiverRanks.get(second.toPlayerId);
      if (secondPayer === undefined || secondReceiver === undefined) continue;
      if ((firstPayer - secondPayer) * (firstReceiver - secondReceiver) < 0) {
        crossings += 1;
      }
    }
  }
  return crossings;
}

/**
 * For a fixed recipient order, dynamic programming finds the payer order
 * with the fewest crossings. Ties keep the original ordering as much as possible.
 */
function bestPayerOrder(
  payers: SettlementFlowPerson[],
  receivers: SettlementFlowPerson[],
  transfers: readonly SettlementFlowTransfer[],
) {
  const destination = new Map(receivers.map((person, index) => [person.id, index]));
  const targets = payers.map((payer) =>
    transfers
      .filter((transfer) => transfer.fromPlayerId === payer.id)
      .map((transfer) => destination.get(transfer.toPlayerId))
      .filter((rank): rank is number => rank !== undefined),
  );

  const size = payers.length;
  const costs = Array.from({ length: size }, () => new Array<number>(size).fill(0));

  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) {
      if (i === j) continue;
      let crossings = 0;
      for (const first of targets[i]) {
        for (const second of targets[j]) {
          if (first > second) crossings += 1;
        }
      }
      // 1000 dominates the maximum of 45 possible tie-breaking inversions.
      costs[i][j] = crossings * 1000 + Number(i > j);
    }
  }

  const states = 1 << size;
  const best = new Float64Array(states).fill(Number.POSITIVE_INFINITY);
  const previous = new Int16Array(states).fill(-1);
  best[0] = 0;

  for (let mask = 0; mask < states; mask += 1) {
    if (!Number.isFinite(best[mask])) continue;

    for (let next = 0; next < size; next += 1) {
      if (mask & (1 << next)) continue;
      let added = 0;
      for (let earlier = 0; earlier < size; earlier += 1) {
        if (mask & (1 << earlier)) added += costs[earlier][next];
      }
      const nextMask = mask | (1 << next);
      const candidate = best[mask] + added;
      if (candidate < best[nextMask]) {
        best[nextMask] = candidate;
        previous[nextMask] = next;
      }
    }
  }

  const order: SettlementFlowPerson[] = [];
  let mask = states - 1;
  while (mask) {
    const index = previous[mask];
    if (index < 0) throw new Error("Could not arrange settlement diagram");
    order.push(payers[index]);
    mask ^= 1 << index;
  }
  order.reverse();

  return {
    payers: order,
    crossings: Math.floor(best[states - 1] / 1000),
    movedPairs: best[states - 1] % 1000,
  };
}

function* permutations<T>(items: readonly T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield [...items];
    return;
  }
  for (let i = 0; i < items.length; i += 1) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) yield [items[i], ...tail];
  }
}

function inversionsFromBase(
  reordered: readonly SettlementFlowPerson[],
  original: readonly SettlementFlowPerson[],
) {
  const base = new Map(original.map((person, index) => [person.id, index]));
  let count = 0;
  for (let i = 0; i < reordered.length; i += 1) {
    for (let j = i + 1; j < reordered.length; j += 1) {
      if ((base.get(reordered[i].id) ?? 0) > (base.get(reordered[j].id) ?? 0)) {
        count += 1;
      }
    }
  }
  return count;
}

/**
 * For larger graphs, use a bounded barycentric layout and locally undo
 * any changes that would increase crossings.
 */
function orderLargeFlow(
  transfers: readonly SettlementFlowTransfer[],
  starting: SettlementFlowOrder,
): SettlementFlowOrder {
  let payers = starting.payers.slice();
  let receivers = starting.receivers.slice();
  let bestPayers = payers;
  let bestReceivers = receivers;
  let bestCrossings = countSettlementFlowCrossings(transfers, payers, receivers);

  const barycenter = (
    personId: string,
    isPayer: boolean,
    other: readonly SettlementFlowPerson[],
  ) => {
    const ranks = new Map(other.map((person, index) => [person.id, index]));
    let sum = 0;
    let weight = 0;
    for (const transfer of transfers) {
      if ((isPayer ? transfer.fromPlayerId : transfer.toPlayerId) !== personId) continue;
      const neighbor = isPayer ? transfer.toPlayerId : transfer.fromPlayerId;
      const rank = ranks.get(neighbor);
      if (rank === undefined) continue;
      sum += rank * transfer.amountCents;
      weight += transfer.amountCents;
    }
    return weight ? sum / weight : Number.POSITIVE_INFINITY;
  };

  for (let pass = 0; pass < 12; pass += 1) {
    payers = payers.slice().sort((a, b) =>
      barycenter(a.id, true, receivers) - barycenter(b.id, true, receivers) ||
      byAmountThenName(a, b),
    );
    receivers = receivers.slice().sort((a, b) =>
      barycenter(a.id, false, payers) - barycenter(b.id, false, payers) ||
      byAmountThenName(a, b),
    );
    const crossings = countSettlementFlowCrossings(transfers, payers, receivers);
    if (crossings < bestCrossings) {
      bestCrossings = crossings;
      bestPayers = payers;
      bestReceivers = receivers;
    }
  }

  payers = bestPayers.slice();
  receivers = bestReceivers.slice();

  for (let pass = 0; pass < 8; pass += 1) {
    let improved = false;
    for (const side of ["payer", "receiver"] as const) {
      const ordered = side === "payer" ? payers : receivers;
      for (let i = 0; i < ordered.length - 1; i += 1) {
        const swapped = ordered.slice();
        [swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]];
        const crossings = countSettlementFlowCrossings(
          transfers,
          side === "payer" ? swapped : payers,
          side === "receiver" ? swapped : receivers,
        );
        if (crossings < bestCrossings) {
          bestCrossings = crossings;
          if (side === "payer") payers = swapped;
          else receivers = swapped;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  return { payers, receivers };
}

export function orderSettlementFlow(
  transfers: readonly SettlementFlowTransfer[],
): SettlementFlowOrder {
  const starting = getPeople(transfers);
  const { payers, receivers } = starting;

  if (payers.length <= 1 || receivers.length <= 1) return starting;

  // Small graphs can be optimized exactly on both sides at low cost.
  if (payers.length > 10 || receivers.length > 4) {
    return orderLargeFlow(transfers, starting);
  }

  let chosen: {
    payers: SettlementFlowPerson[];
    receivers: SettlementFlowPerson[];
    crossings: number;
    recipientChanges: number;
    payerChanges: number;
  } | null = null;

  for (const candidateReceivers of permutations(receivers)) {
    const candidatePayers = bestPayerOrder(payers, candidateReceivers, transfers);
    const recipientChanges = inversionsFromBase(candidateReceivers, receivers);
    if (
      chosen === null ||
      candidatePayers.crossings < chosen.crossings ||
      (candidatePayers.crossings === chosen.crossings &&
        (recipientChanges < chosen.recipientChanges ||
          (recipientChanges === chosen.recipientChanges &&
            candidatePayers.movedPairs < chosen.payerChanges)))
    ) {
      chosen = {
        payers: candidatePayers.payers,
        receivers: candidateReceivers,
        crossings: candidatePayers.crossings,
        recipientChanges,
        payerChanges: candidatePayers.movedPairs,
      };
    }
  }

  return chosen
    ? { payers: chosen.payers, receivers: chosen.receivers }
    : starting;
}
