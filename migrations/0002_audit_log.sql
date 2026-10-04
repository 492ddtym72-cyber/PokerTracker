CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('night.created', 'night.updated', 'night.deleted', 'night.baseline')
  ),
  entity_type TEXT NOT NULL CHECK (entity_type = 'poker_night'),
  entity_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_events_created_at
  ON audit_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_entity_id
  ON audit_events(entity_id, created_at DESC);
