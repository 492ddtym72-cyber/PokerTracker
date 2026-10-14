-- Existing completed nights remain in the lifetime pool. No historical results or payments are changed.
ALTER TABLE poker_nights ADD COLUMN settlement_mode TEXT NOT NULL DEFAULT 'pooled'
  CHECK (settlement_mode IN ('pooled', 'separate'));

-- Local session payments are independent of the global payment ledger.
CREATE TABLE IF NOT EXISTS session_settlement_payments (
  id TEXT PRIMARY KEY,
  night_id TEXT NOT NULL REFERENCES poker_nights(id) ON DELETE RESTRICT,
  from_player_id TEXT NOT NULL REFERENCES players(id),
  to_player_id TEXT NOT NULL REFERENCES players(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  paid_at TEXT NOT NULL,
  note TEXT,
  client_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  voided_at TEXT,
  CHECK (from_player_id <> to_player_id)
);
CREATE INDEX IF NOT EXISTS idx_session_payments_night ON session_settlement_payments(night_id, voided_at);
CREATE INDEX IF NOT EXISTS idx_poker_nights_mode ON poker_nights(settlement_mode, status);
