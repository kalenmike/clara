-- Rename features to requests, move to domain-neutral lifecycle states, and
-- pin configured pipelines.
--
-- This is a development migration. It rewrites the current ledger in place;
-- there is no compatibility layer after it runs.

CREATE TABLE requests_new (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id       INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slug               TEXT NOT NULL,
  title              TEXT NOT NULL,
  intent             TEXT NOT NULL,
  meta               TEXT,
  state              TEXT NOT NULL DEFAULT 'draft'
                     CHECK (state IN ('draft', 'approved', 'running', 'review', 'completed', 'cancelled')),
  record_path        TEXT,
  branch             TEXT,
  worktree           TEXT,
  tests_hash         TEXT,
  attempts           INTEGER NOT NULL DEFAULT 0,
  tokens             INTEGER NOT NULL DEFAULT 0,
  usd                REAL NOT NULL DEFAULT 0,
  soft_budget        INTEGER,
  hard_budget        INTEGER,
  time_limit_minutes INTEGER,
  docs_impact        TEXT,
  blocked_on         TEXT,
  cancel_reason      TEXT,
  stalled_at         TEXT,
  started_at         TEXT,
  last_event_at      TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  closed_at          TEXT,
  record_committed_at TEXT,
  session_id         TEXT,
  pipeline_id        TEXT,
  pipeline_version   INTEGER,
  pipeline_hash      TEXT,
  pipeline_snapshot  TEXT,
  current_stage_id   TEXT,
  UNIQUE (workspace_id, slug)
);

INSERT INTO requests_new
  (id, workspace_id, slug, title, intent, meta, state, record_path, branch,
   worktree, tests_hash, attempts, tokens, usd, soft_budget, hard_budget,
   time_limit_minutes, docs_impact, blocked_on, cancel_reason, stalled_at,
   started_at, last_event_at, created_at, closed_at, record_committed_at,
   session_id, pipeline_id, pipeline_version, pipeline_hash, pipeline_snapshot,
   current_stage_id)
SELECT
  id, workspace_id, slug, title, intent, meta,
  CASE state
    WHEN 'spec' THEN 'draft'
    WHEN 'planned' THEN 'approved'
    WHEN 'building' THEN 'running'
    WHEN 'review' THEN 'review'
    WHEN 'done' THEN 'completed'
    WHEN 'scrapped' THEN 'cancelled'
    ELSE state
  END,
  spec_path, branch, worktree, tests_hash, attempts, tokens, usd, soft_budget,
  hard_budget, time_limit_minutes, docs_impact, blocked_on, scrap_reason,
  stalled_at, started_at, last_event_at, created_at, closed_at,
  record_committed_at, session_id,
  'software', 1, NULL, NULL,
  CASE state
    WHEN 'spec' THEN 'spec'
    WHEN 'planned' THEN 'test'
    WHEN 'building' THEN 'build'
    WHEN 'review' THEN 'docs'
    ELSE NULL
  END
FROM features;

CREATE TABLE criteria_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id  INTEGER NOT NULL REFERENCES requests_new(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  text        TEXT NOT NULL,
  test_path   TEXT,
  human_gate  INTEGER NOT NULL DEFAULT 0,
  approved_at TEXT,
  UNIQUE (request_id, position)
);

INSERT INTO criteria_new (id, request_id, position, text, test_path, human_gate, approved_at)
SELECT id, feature_id, position, text, test_path, human_gate, approved_at FROM criteria;

CREATE TABLE checkpoints_new (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id         INTEGER NOT NULL REFERENCES requests_new(id) ON DELETE CASCADE,
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
  UNIQUE (request_id, n)
);

INSERT INTO checkpoints_new
  (id, request_id, n, at, tests_passed, tests_total, files_changed,
   criteria_addressed, blocked_on, next_step, open_question, tokens)
SELECT id, feature_id, n, at, tests_passed, tests_total, files_changed,
       criteria_addressed, blocked_on, next_step, open_question, tokens
  FROM checkpoints;

CREATE TABLE decisions_new (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id        INTEGER REFERENCES requests_new(id) ON DELETE CASCADE,
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

INSERT INTO decisions_new
  (id, request_id, at, kind, question, recommendation, evidence, reversible,
   cost, default_if_silent, resolved_at, resolution)
SELECT id, feature_id, at, kind, question, recommendation, evidence, reversible,
       cost, default_if_silent, resolved_at, resolution
  FROM decisions;

CREATE TABLE runs_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id  INTEGER NOT NULL REFERENCES requests_new(id) ON DELETE CASCADE,
  stage       TEXT NOT NULL,
  agent       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'worker' CHECK (role IN ('worker', 'closer')),
  session_id  TEXT,
  status      TEXT NOT NULL DEFAULT 'starting'
              CHECK (status IN ('starting', 'running', 'done', 'failed', 'interrupted')),
  created_at  TEXT NOT NULL,
  started_at  TEXT,
  finished_at TEXT,
  note        TEXT
);

INSERT INTO runs_new
  (id, request_id, stage, agent, role, session_id, status, created_at,
   started_at, finished_at, note)
SELECT id, feature_id, stage, agent,
       CASE WHEN stage = 'judge' THEN 'closer' ELSE 'worker' END,
       session_id, status, created_at, started_at, finished_at, note
  FROM runs;

CREATE TABLE alerts_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  key             TEXT NOT NULL UNIQUE,
  request_id      INTEGER REFERENCES requests_new(id) ON DELETE CASCADE,
  slug            TEXT,
  workspace       TEXT,
  kind            TEXT NOT NULL
                  CHECK (kind IN ('decision', 'stalled', 'budget', 'approval',
                                  'stage_gate', 'review_gate', 'cancelled')),
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  resolved_at     TEXT,
  session_id      TEXT,
  notified_at     TEXT,
  attention_state TEXT
);

INSERT INTO alerts_new
  (id, key, request_id, slug, workspace, kind, title, body, created_at,
   resolved_at, session_id, notified_at, attention_state)
SELECT id,
       CASE
         WHEN key LIKE 'gates:%' THEN 'review_gate:' || substr(key, 7)
         WHEN key LIKE 'kill:%' THEN 'cancelled:' || substr(key, 6)
         ELSE key
       END,
       feature_id, slug, workspace,
       CASE kind
         WHEN 'gates' THEN 'review_gate'
         WHEN 'kill' THEN 'cancelled'
         ELSE kind
       END,
       title, body, created_at, resolved_at, session_id, notified_at,
       attention_state
  FROM alerts;

CREATE TABLE events_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests_new(id) ON DELETE CASCADE,
  at         TEXT NOT NULL,
  type       TEXT NOT NULL,
  actor      TEXT NOT NULL,
  payload    TEXT
);

INSERT INTO events_new (id, request_id, at, type, actor, payload)
SELECT id, feature_id, at,
       CASE type
         WHEN 'feature.registered' THEN 'request.submitted'
         WHEN 'feature.stalled' THEN 'request.stalled'
         WHEN 'feature.killed' THEN 'request.cancelled'
         WHEN 'feature.done' THEN 'request.completed'
         ELSE type
       END,
       actor,
       replace(replace(replace(replace(replace(payload,
         '"state":"spec"', '"state":"draft"'),
         '"state":"planned"', '"state":"approved"'),
         '"state":"building"', '"state":"running"'),
         '"state":"scrapped"', '"state":"cancelled"'),
         '"state":"done"', '"state":"completed"')
  FROM events;

DROP TABLE alerts;
DROP TABLE events;
DROP TABLE decisions;
DROP TABLE runs;
DROP TABLE checkpoints;
DROP TABLE criteria;
DROP TABLE features;

ALTER TABLE requests_new RENAME TO requests;
ALTER TABLE criteria_new RENAME TO criteria;
ALTER TABLE checkpoints_new RENAME TO checkpoints;
ALTER TABLE decisions_new RENAME TO decisions;
ALTER TABLE runs_new RENAME TO runs;
ALTER TABLE alerts_new RENAME TO alerts;
ALTER TABLE events_new RENAME TO events;

CREATE INDEX idx_requests_state      ON requests (state);
CREATE INDEX idx_requests_workspace  ON requests (workspace_id, state);
CREATE INDEX idx_criteria_request    ON criteria (request_id, position);
CREATE INDEX idx_events_request      ON events (request_id, id);
CREATE INDEX idx_decisions_open      ON decisions (resolved_at);
CREATE INDEX idx_runs_request        ON runs (request_id, stage, id);
CREATE INDEX idx_runs_status         ON runs (status);
CREATE UNIQUE INDEX idx_runs_session ON runs (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX idx_alerts_open         ON alerts (resolved_at, id);
CREATE INDEX idx_alerts_request      ON alerts (request_id, id);
CREATE INDEX idx_alerts_undelivered  ON alerts (session_id, id);

ALTER TABLE workspaces ADD COLUMN pipeline_id TEXT;
ALTER TABLE workspaces ADD COLUMN pipeline_version INTEGER;
