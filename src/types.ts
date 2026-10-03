export interface PlayerResult {
  id: string;
  name: string;
  stakeCents: number;
  cashOutCents: number;
}

export interface PokerNight {
  id: string;
  title: string;
  playedAt: string;
  createdAt: string;
  players: PlayerResult[];
}

export interface PokerTrackerState {
  version: 1;
  nights: PokerNight[];
}
