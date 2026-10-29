-- Requests remain informational. Existing Riga rows default to the legacy ledger.
-- All additional columns and indexes are additive; no payment or request is reassigned.
ALTER TABLE payment_requests ADD COLUMN ledger_kind TEXT NOT NULL DEFAULT 'legacy'
  CHECK (ledger_kind IN ('legacy','session','list'));
ALTER TABLE payment_requests ADD COLUMN ledger_id TEXT;
CREATE INDEX IF NOT EXISTS idx_payment_requests_ledger
  ON payment_requests(ledger_kind,ledger_id,from_player_id,to_player_id,cancelled_at);

-- A confirmed inbox report must record its payment in the matching ledger.
ALTER TABLE session_settlement_payments ADD COLUMN payment_report_id TEXT REFERENCES payment_reports(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_payment_report
  ON session_settlement_payments(payment_report_id);
ALTER TABLE settlement_list_payments ADD COLUMN payment_report_id TEXT REFERENCES payment_reports(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_list_payment_report
  ON settlement_list_payments(payment_report_id);
