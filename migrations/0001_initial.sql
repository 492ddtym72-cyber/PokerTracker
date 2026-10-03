PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS poker_nights (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  played_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS night_results (
  id TEXT PRIMARY KEY,
  night_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  stake_cents INTEGER NOT NULL CHECK (stake_cents >= 0),
  cash_out_cents INTEGER NOT NULL CHECK (cash_out_cents >= 0),
  created_at TEXT NOT NULL,
  UNIQUE (night_id, player_id),
  FOREIGN KEY (night_id) REFERENCES poker_nights(id) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_poker_nights_played_at
  ON poker_nights(played_at DESC);

CREATE INDEX IF NOT EXISTS idx_night_results_night_id
  ON night_results(night_id);

CREATE INDEX IF NOT EXISTS idx_night_results_player_id
  ON night_results(player_id);
