PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settlement_payments (
  id TEXT PRIMARY KEY,
  from_player_id TEXT NOT NULL,
  to_player_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (
    amount_cents > 0
    AND amount_cents <= 100000000
  ),
  paid_at TEXT NOT NULL,
  note TEXT,
  client_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  voided_at TEXT,
  CHECK (from_player_id <> to_player_id),
  FOREIGN KEY (from_player_id) REFERENCES players(id),
  FOREIGN KEY (to_player_id) REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_settlement_payments_paid_at
  ON settlement_payments(paid_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_settlement_payments_from_player
  ON settlement_payments(from_player_id, voided_at);

CREATE INDEX IF NOT EXISTS idx_settlement_payments_to_player
  ON settlement_payments(to_player_id, voided_at);
