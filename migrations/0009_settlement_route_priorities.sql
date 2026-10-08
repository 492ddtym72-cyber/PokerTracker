PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settlement_route_priorities (
  snapshot_key TEXT NOT NULL,
  from_player_id TEXT NOT NULL,
  to_player_id TEXT NOT NULL,
  priority INTEGER NOT NULL CHECK (priority >= 0),
  PRIMARY KEY (snapshot_key, from_player_id, to_player_id),
  CHECK (from_player_id <> to_player_id),
  FOREIGN KEY (from_player_id) REFERENCES players(id),
  FOREIGN KEY (to_player_id) REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_settlement_route_priorities_snapshot
  ON settlement_route_priorities(snapshot_key, priority, from_player_id, to_player_id);
