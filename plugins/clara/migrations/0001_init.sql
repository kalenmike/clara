-- Clara ledger — initial schema.
--
-- Model: `events` are the source of truth. `features` is a materialised cache
-- of the current state, rebuilt from events. `criteria`, `checkpoints`,
-- `decisions` and `schema_gaps` are the working records the agents read.
--
-- Nothing here is per-session. Sessions are private to the agent that ran
-- them; only these rows cross an agent boundary.

CREATE TABLE workspaces (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  path       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE features (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id  INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  title         TEXT NOT NULL,
  intent        TEXT NOT NULL,
  meta          TEXT,
  state         TEXT NOT NULL DEFAULT 'spec'
                CHECK (state IN ('spec', 'planned', 'building', 'review', 'done', 'scrapped')),
  spec_path     TEXT,
  branch        TEXT,
  worktree      TEXT,
  tests_hash    TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  tokens        INTEGER NOT NULL DEFAULT 0,
  usd           REAL NOT NULL DEFAULT 0,
  soft_budget   INTEGER,
  hard_budget   INTEGER,
  time_limit_minutes INTEGER,
  docs_impact   TEXT,
  blocked_on    TEXT,
  scrap_reason  TEXT,
  stalled_at    TEXT,
  started_at    TEXT,
  last_event_at TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  closed_at     TEXT,
  UNIQUE (workspace_id, slug)
);

CREATE INDEX idx_features_state     ON features (state);
CREATE INDEX idx_features_workspace ON features (workspace_id, state);

-- Append-only. Never mutated. Every state change, kill, CI result and
-- checkpoint writes one of these.
CREATE TABLE events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  at         TEXT NOT NULL,
  type       TEXT NOT NULL,
  actor      TEXT NOT NULL,
  payload    TEXT
);

CREATE INDEX idx_events_feature ON events (feature_id, id);

-- Acceptance criteria. `test_path` NULL + `human_gate` 0 means the criterion
-- was never made executable and the feature cannot be confirmed done.
CREATE TABLE criteria (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_id  INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  text        TEXT NOT NULL,
  test_path   TEXT,
  human_gate  INTEGER NOT NULL DEFAULT 0,
  approved_at TEXT,
  UNIQUE (feature_id, position)
);

-- What the implementing agent reports at each boundary. Numbers come from
-- CI and git; the prose is the agent's own account and is read with suspicion.
CREATE TABLE checkpoints (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_id         INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  n                  INTEGER NOT NULL,
  at                 TEXT NOT NULL,
  tests_passed       INTEGER NOT NULL DEFAULT 0,
  tests_total        INTEGER NOT NULL DEFAULT 0,
  files_changed      INTEGER NOT NULL DEFAULT 0,
  criteria_addressed TEXT,
  blocked_on         TEXT,
  next_step          TEXT,
  open_question      TEXT,
  tokens             INTEGER,
  UNIQUE (feature_id, n)
);

-- The inbox. One row per thing that needs a human. Closed rows stay as
-- history so "what did you decide without me" is answerable.
CREATE TABLE decisions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_id        INTEGER REFERENCES features(id) ON DELETE CASCADE,
  at                TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('decision', 'blocked', 'failed', 'done')),
  question          TEXT NOT NULL,
  recommendation    TEXT,
  evidence          TEXT,
  reversible        INTEGER NOT NULL DEFAULT 1,
  cost              TEXT,
  default_if_silent TEXT NOT NULL DEFAULT 'block',
  resolved_at       TEXT,
  resolution        TEXT
);

CREATE INDEX idx_decisions_open ON decisions (resolved_at);

-- When the ledger cannot answer a question, it records the gap instead of
-- inventing an answer. These rows are how the schema improves.
CREATE TABLE schema_gaps (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       TEXT NOT NULL,
  question TEXT NOT NULL,
  note     TEXT
);
