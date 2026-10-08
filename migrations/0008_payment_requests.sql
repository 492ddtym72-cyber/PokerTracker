PRAGMA foreign_keys = ON;

-- Requests are messages about existing settlement balances, never new debt.
CREATE TABLE IF NOT EXISTS payment_requests (
  id TEXT PRIMARY KEY,
  from_player_id TEXT NOT NULL REFERENCES players(id),
  to_player_id TEXT NOT NULL REFERENCES players(id),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0 AND amount_cents <= 100000000),
  message TEXT CHECK(message IS NULL OR length(message) <= 400),
  payment_url TEXT CHECK(payment_url IS NULL OR length(payment_url) <= 500),
  created_at TEXT NOT NULL,
  cancelled_at TEXT,
  last_reminded_at TEXT,
  reminder_token TEXT,
  client_token TEXT NOT NULL UNIQUE,
  CHECK(from_player_id <> to_player_id)
);
CREATE INDEX IF NOT EXISTS idx_payment_requests_participants ON payment_requests(from_player_id,to_player_id,created_at DESC);

CREATE TABLE IF NOT EXISTS payment_reports (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES payment_requests(id),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  status TEXT NOT NULL CHECK(status IN ('reported','confirmed','rejected')),
  created_at TEXT NOT NULL,
  decided_at TEXT,
  client_token TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_payment_reports_request ON payment_reports(request_id,status);

ALTER TABLE settlement_payments ADD COLUMN payment_report_id TEXT REFERENCES payment_reports(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_payment_report ON settlement_payments(payment_report_id);

CREATE TABLE IF NOT EXISTS payment_request_events (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES payment_requests(id),
  to_player_id TEXT NOT NULL REFERENCES players(id),
  kind TEXT NOT NULL CHECK(kind IN ('request','reminder','reported','confirmed','rejected','cancelled')),
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_payment_events_inbox ON payment_request_events(to_player_id,created_at DESC);
