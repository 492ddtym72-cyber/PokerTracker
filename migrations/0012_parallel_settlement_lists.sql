-- Additive migration: legacy Riga results, payments, requests and route priorities are untouched.
-- Named lists are independent; unmatched pooled sessions remain in the Riga legacy ledger.
CREATE TABLE IF NOT EXISTS settlement_lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(name)) BETWEEN 2 AND 60),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','paying_out','closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settlement_list_nights (
  night_id TEXT PRIMARY KEY REFERENCES poker_nights(id) ON DELETE RESTRICT,
  list_id TEXT NOT NULL REFERENCES settlement_lists(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_settlement_list_nights_list ON settlement_list_nights(list_id);
CREATE TABLE IF NOT EXISTS settlement_list_payments (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES settlement_lists(id) ON DELETE RESTRICT,
  from_player_id TEXT NOT NULL REFERENCES players(id),
  to_player_id TEXT NOT NULL REFERENCES players(id),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0 AND amount_cents <= 100000000),
  paid_at TEXT NOT NULL,
  note TEXT,
  client_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  voided_at TEXT,
  CHECK(from_player_id <> to_player_id)
);
CREATE INDEX IF NOT EXISTS idx_settlement_list_payments ON settlement_list_payments(list_id,voided_at);
-- Membership is one-to-one and only accepts valid games and open lists.
CREATE TRIGGER IF NOT EXISTS trg_list_nights_insert
BEFORE INSERT ON settlement_list_nights BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM settlement_lists WHERE id=NEW.list_id AND status='open'
  ) THEN RAISE(ABORT, 'Settlement list is not open') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM poker_nights WHERE id=NEW.night_id AND settlement_mode='pooled' AND record_type='session'
  ) THEN RAISE(ABORT, 'Invalid list session') END;
END;
CREATE TRIGGER IF NOT EXISTS trg_list_nights_update
BEFORE UPDATE ON settlement_list_nights BEGIN
  SELECT RAISE(ABORT, 'Settlement membership is immutable');
END;
CREATE TRIGGER IF NOT EXISTS trg_list_nights_delete
BEFORE DELETE ON settlement_list_nights BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM settlement_list_payments WHERE list_id=OLD.list_id
  ) OR EXISTS(
    SELECT 1 FROM settlement_lists WHERE id=OLD.list_id AND status<>'open'
  ) THEN RAISE(ABORT, 'Cannot remove session from a paying-out list') END;
END;

-- Defensive DB constraints against concurrent payments and session enrollment.
CREATE TRIGGER IF NOT EXISTS trg_list_nights_payment_guard
BEFORE INSERT ON settlement_list_nights BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM settlement_list_payments WHERE list_id=NEW.list_id
  ) THEN RAISE(ABORT, 'Settlement list already has payments') END;
END;
CREATE TRIGGER IF NOT EXISTS trg_list_payment_guard
BEFORE INSERT ON settlement_list_payments BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM settlement_lists WHERE id=NEW.list_id AND status IN ('open','paying_out')
  ) THEN RAISE(ABORT, 'Settlement list is closed') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM settlement_list_nights m
    JOIN poker_nights n ON n.id=m.night_id
    WHERE m.list_id=NEW.list_id AND n.status='ongoing'
  ) THEN RAISE(ABORT, 'Complete all sessions before payout') END;
END;
