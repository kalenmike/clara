-- Clara alerts and feature records.
--
-- `alerts` is the deterministic human-wait outbox. The home agent reads it
-- read-only and is the only component that delivers it. Rows stay after they
-- resolve so delivery can be deduplicated across restarts.
--
-- Feature records moved out of docs/features so canonical docs can be edited
-- by the docs agent without touching the generated per-feature records.

CREATE TABLE alerts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL UNIQUE,
  feature_id  INTEGER REFERENCES features(id) ON DELETE CASCADE,
  slug        TEXT,
  workspace   TEXT,
  kind        TEXT NOT NULL
              CHECK (kind IN ('decision', 'stalled', 'budget', 'approval', 'gates', 'kill')),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX idx_alerts_open ON alerts (resolved_at, id);
CREATE INDEX idx_alerts_feature ON alerts (feature_id, id);

UPDATE features
   SET spec_path = replace(spec_path, '/docs/features/', '/docs/records/')
 WHERE spec_path LIKE '%/docs/features/%';
