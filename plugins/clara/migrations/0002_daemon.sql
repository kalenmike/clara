-- Clara daemon — worker run tracking and the single-writer lock.
--
-- `runs` records which OpenCode session owns which stage of a feature. It is
-- how the daemon avoids launching the same stage twice across ticks, restarts,
-- and plugin instances.
--
-- `daemon_lock` has exactly one row. A daemon instance must own it before it
-- ticks, so multiple OpenCode locations can load the plugin without spawning
-- duplicate workers.

CREATE TABLE runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_id  INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  stage       TEXT NOT NULL CHECK (stage IN ('spec', 'test', 'build', 'docs', 'judge')),
  agent       TEXT NOT NULL,
  session_id  TEXT,
  status      TEXT NOT NULL DEFAULT 'starting'
              CHECK (status IN ('starting', 'running', 'done', 'failed', 'interrupted')),
  created_at  TEXT NOT NULL,
  started_at  TEXT,
  finished_at TEXT,
  note        TEXT
);

CREATE INDEX idx_runs_feature ON runs (feature_id, stage, id);
CREATE INDEX idx_runs_status  ON runs (status);
CREATE UNIQUE INDEX idx_runs_session ON runs (session_id) WHERE session_id IS NOT NULL;

CREATE TABLE daemon_lock (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  owner        TEXT NOT NULL,
  pid          INTEGER NOT NULL,
  heartbeat_at TEXT NOT NULL
);
