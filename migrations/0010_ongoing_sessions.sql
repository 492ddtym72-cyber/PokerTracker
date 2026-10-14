-- Additive change: preserve all results, payments, and audit records.
ALTER TABLE poker_nights ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'
  CHECK (status IN ('ongoing','completed'));

-- Prior records with stakes but no cash-outs are provisional.
UPDATE poker_nights SET status='ongoing' WHERE record_type='session' AND id IN (
  SELECT night_id FROM night_results GROUP BY night_id
  HAVING SUM(stake_cents)>0 AND SUM(cash_out_cents)=0
);

CREATE INDEX IF NOT EXISTS idx_poker_nights_status ON poker_nights(status);
