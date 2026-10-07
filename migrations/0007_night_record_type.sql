ALTER TABLE poker_nights
  ADD COLUMN record_type TEXT NOT NULL DEFAULT 'session'
  CHECK (record_type IN ('session', 'baseline'));
