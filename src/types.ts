export interface PlayerResult {
  id: string;
  name: string;
  stakeCents: number;
  cashOutCents: number;
  adjustmentCents: number;
}

export interface PokerNight {
  id: string;
  title: string;
  playedAt: string;
  createdAt: string;
  updatedAt: string;
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
      field: "title" | "date";
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

export interface SettlementResponse {
  players: SettlementPlayer[];
  suggestions: SettlementSuggestion[];
  payments: SettlementPayment[];
  totalOutstandingCents: number;
  groupDifferenceCents: number;
}

export interface SettlementPaymentInput {
  fromPlayerId: string;
  toPlayerId: string;
  amountCents: number;
  paidAt: string;
  note?: string;
  clientToken: string;
}
