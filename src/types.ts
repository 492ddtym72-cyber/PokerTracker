export interface PlayerProfile {
  id: string;
  name: string;
  profilePhoto: string | null;
}

export interface PlayerResult {
  id: string;
  name: string;
  stakeCents: number;
  cashOutCents: number;
  adjustmentCents: number;
}

export type NightStatus = "ongoing" | "completed";
export type SettlementMode = "pooled" | "separate";

export interface PokerNight {
  id: string;
  title: string;
  playedAt: string;
  createdAt: string;
  updatedAt: string;
  recordType: "session" | "baseline";
  status: NightStatus;
  settlementMode: SettlementMode;
  settlementListId?: string | null;
  players: PlayerResult[];
}

export interface NightPlayerInput {
  playerId?: string;
  name: string;
  stakeCents: number;
  cashOutCents: number;
}

export interface NightInput {
  title: string;
  playedAt: string;
  players: NightPlayerInput[];
  status?: NightStatus;
  settlementMode?: SettlementMode;
  settlementListId?: string | null;
}

export interface NightAdjustmentInput {
  playerId: string;
  amountCents: number;
}

export type AuditEventType =
  | "night.created"
  | "night.updated"
  | "night.deleted"
  | "night.baseline";

export type AuditChange =
  | {
      type: "field";
      field: "title" | "date" | "status";
      before: string;
      after: string;
    }
  | {
      type: "player_added";
      player: string;
      stakeCents: number;
      cashOutCents: number;
    }
  | {
      type: "player_removed";
      player: string;
      stakeCents: number;
      cashOutCents: number;
    }
  | {
      type: "player_amount";
      player: string;
      field: "stake" | "cash_out";
      beforeCents: number;
      afterCents: number;
    };

export interface AuditEvent {
  id: string;
  eventType: AuditEventType;
  entityId: string;
  createdAt: string;
  title: string;
  playedAt: string | null;
  playerCount: number;
  totalStakeCents: number;
  changes: AuditChange[];
}

export interface HistoryResponse {
  events: AuditEvent[];
  pagination: {
    offset: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}


export interface SettlementPlayer {
  id: string;
  name: string;
  pokerBalanceCents: number;
  paidOutCents: number;
  receivedCents: number;
  openBalanceCents: number;
}

export interface SettlementSuggestion {
  fromPlayerId: string;
  fromPlayerName: string;
  toPlayerId: string;
  toPlayerName: string;
  amountCents: number;
}

export interface SettlementPlanTransfer extends SettlementSuggestion {
  paidCents: number;
  remainingCents: number;
}

export interface SettlementPayment {
  id: string;
  fromPlayerId: string;
  fromPlayerName: string;
  toPlayerId: string;
  toPlayerName: string;
  amountCents: number;
  paidAt: string;
  note: string | null;
  createdAt: string;
  voidedAt: string | null;
}

export interface SettlementListSummary {
  id: string;
  name: string;
  status: "open" | "paying_out" | "closed";
  totalSessions: number;
  completedSessions: number;
  playerCount: number;
  totalOutstandingCents: number;
  groupDifferenceCents: number;
  legacy: boolean;
}
export interface NamedSettlementResponse extends SettlementResponse {
  listId: string;
  listName: string;
  status: "open" | "paying_out" | "closed";
}
export interface SettlementResponse {
  players: SettlementPlayer[];
  plan: SettlementPlanTransfer[];
  suggestions: SettlementSuggestion[];
  unmatchedPaymentCents: number;
  payments: SettlementPayment[];
  totalOutstandingCents: number;
  groupDifferenceCents: number;
  ongoingSessionCount: number;
}

export interface SettlementPaymentInput {
  fromPlayerId: string;
  toPlayerId: string;
  amountCents: number;
  paidAt: string;
  note?: string;
  clientToken: string;
}


export type PaymentLedgerScope =
  | { kind: "legacy"; id?: never }
  | { kind: "session" | "list"; id: string };

export interface PreparedPaymentApp {
  fromPlayerId: string;
  fromPlayerName: string;
  toPlayerId: string;
  toPlayerName: string;
  amountCents: number;
  currency: "EUR";
}

export interface PaymentRequest {
  ledgerKind: "legacy" | "session" | "list";
  ledgerId: string | null;
  id: string;
  fromPlayerId: string;
  toPlayerId: string;
  fromPlayerName: string;
  toPlayerName: string;
  amountCents: number;
  paidCents: number;
  remainingCents: number;
  stale: boolean;
  message: string | null;
  paymentUrl: string | null;
  createdAt: string;
  cancelledAt: string | null;
  lastRemindedAt: string | null;
}

export interface PaymentReport {
  id: string;
  requestId: string;
  amountCents: number;
  status: "reported" | "confirmed" | "rejected";
  createdAt: string;
  decidedAt: string | null;
  voidedAt: string | null;
}

export interface PaymentEvent {
  id: string;
  requestId: string;
  kind: "request" | "reminder" | "reported" | "confirmed" | "rejected" | "cancelled";
  createdAt: string;
  readAt: string | null;
}
export interface PaymentInboxData {
  requests: PaymentRequest[];
  reports: PaymentReport[];
  events: PaymentEvent[];
}
