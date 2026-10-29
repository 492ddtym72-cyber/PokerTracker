/**
 * Paying a transfer must not trigger a new routing calculation.
 * Reconcile each recorded payment against the ORIGINAL (pre-payment) plan.
 * This is deliberately pure so all three settlement ledgers behave alike.
 */
export interface FixedTransfer {
  fromPlayerId: string;
  fromPlayerName: string;
  toPlayerId: string;
  toPlayerName: string;
  amountCents: number;
}

export interface RecordedTransfer {
  from_player_id: string;
  to_player_id: string;
  amount_cents: number;
  voided_at: string | null;
}

export interface PlannedTransfer extends FixedTransfer {
  paidCents: number;
  remainingCents: number;
}

function route(fromId: string, toId: string) {
  return JSON.stringify([fromId, toId]);
}

export function reconcileFixedTransfers<T extends FixedTransfer>(
  original: readonly T[],
  payments: readonly RecordedTransfer[],
): { plan: PlannedTransfer[]; suggestions: T[]; unmatchedPaymentCents: number } {
  const paidByRoute = new Map<string, number>();
  for (const payment of payments) {
    if (payment.voided_at !== null) continue;
    const key = route(payment.from_player_id, payment.to_player_id);
    paidByRoute.set(key, (paidByRoute.get(key) ?? 0) + payment.amount_cents);
  }

  const plan: PlannedTransfer[] = original.map((transfer) => {
    const key = route(transfer.fromPlayerId, transfer.toPlayerId);
    // Allocate chronologically along the original plan when a route appears twice.
    const paidCents = Math.min(transfer.amountCents, paidByRoute.get(key) ?? 0);
    paidByRoute.set(key, (paidByRoute.get(key) ?? 0) - paidCents);
    return {
      ...transfer,
      paidCents,
      remainingCents: transfer.amountCents - paidCents,
    };
  });
  // Historical off-plan payments are never deleted or silently assigned to
  // another recipient. They remain visible in the payment history.
  const unmatchedPaymentCents = [...paidByRoute.values()].reduce((sum, cents) => sum + cents, 0);
  const suggestions = plan.filter((p) => p.remainingCents > 0).map((p) => ({
    fromPlayerId: p.fromPlayerId,
    fromPlayerName: p.fromPlayerName,
    toPlayerId: p.toPlayerId,
    toPlayerName: p.toPlayerName,
    amountCents: p.remainingCents,
  })) as T[];
  return { plan, suggestions, unmatchedPaymentCents };
}
