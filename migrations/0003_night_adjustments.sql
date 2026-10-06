PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS night_adjustments (
  id TEXT PRIMARY KEY,
  night_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (
    amount_cents <> 0
    AND amount_cents >= -100000000
    AND amount_cents <= 100000000
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (night_id, player_id),
  FOREIGN KEY (night_id) REFERENCES poker_nights(id) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_night_adjustments_night_id
  ON night_adjustments(night_id);

CREATE INDEX IF NOT EXISTS idx_night_adjustments_player_id
  ON night_adjustments(player_id);
