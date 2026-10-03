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
  updatedAt: string;
  players: PlayerResult[];
}

export interface NightPlayerInput {
  name: string;
  stakeCents: number;
  cashOutCents: number;
}

export interface NightInput {
  title: string;
  playedAt: string;
  players: NightPlayerInput[];
}
