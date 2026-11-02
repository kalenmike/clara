-- Generic stage evidence, progress, and stage gates.
--
-- The legacy tests_hash/docs_impact columns and the checkpoints table stay for
-- one more migration so the daemon can keep its old completion predicates
-- while the new tools land. The next migration drops them once the scheduler
-- reads evidence directly.

CREATE TABLE evidence (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  stage_id   TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  actor      TEXT NOT NULL,
  at         TEXT NOT NULL
);

CREATE INDEX idx_evidence_request ON evidence (request_id, stage_id, key, id);

CREATE TABLE progress (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id   INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  stage_id     TEXT NOT NULL,
  n            INTEGER NOT NULL,
  at           TEXT NOT NULL,
  metrics      TEXT NOT NULL DEFAULT '{}',
  blocked_on   TEXT,
  next_step    TEXT,
  open_question TEXT,
  tokens       INTEGER,
  UNIQUE (request_id, n)
);

CREATE INDEX idx_progress_request ON progress (request_id, n);

CREATE TABLE stage_gates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  stage_id   TEXT NOT NULL,
  position   TEXT NOT NULL CHECK (position IN ('before', 'after')),
  result     TEXT NOT NULL CHECK (result IN ('verified', 'rejected')),
  evidence   TEXT,
  actor      TEXT NOT NULL,
  at         TEXT NOT NULL
);

CREATE INDEX idx_stage_gates_request ON stage_gates (request_id, stage_id, id);

-- Copy the software-specific values into generic evidence.
INSERT INTO evidence (request_id, stage_id, key, value, actor, at)
SELECT id, 'test', 'tests_hash', json_quote(tests_hash), 'ai_2', last_event_at
  FROM requests
 WHERE tests_hash IS NOT NULL AND tests_hash <> '';

INSERT INTO evidence (request_id, stage_id, key, value, actor, at)
SELECT id, 'spec', 'docs_impact', json_quote(docs_impact), 'ai_1', last_event_at
  FROM requests
 WHERE docs_impact IS NOT NULL AND trim(docs_impact) <> '';

INSERT INTO evidence (request_id, stage_id, key, value, actor, at)
SELECT e.request_id, 'test', 'tests_total', CAST(json_extract(e.payload, '$.total') AS TEXT), 'ai_2', e.at
  FROM events e
 WHERE e.type = 'tests.frozen'
   AND json_valid(e.payload)
   AND json_extract(e.payload, '$.total') IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM evidence x
      WHERE x.request_id = e.request_id
        AND x.stage_id = 'test'
        AND x.key = 'tests_total'
   );

-- Copy checkpoints into generic progress rows.
INSERT INTO progress
  (request_id, stage_id, n, at, metrics, blocked_on, next_step, open_question, tokens)
SELECT request_id, 'build', n, at,
       json_object(
         'tests_passed', tests_passed,
         'tests_total', tests_total,
         'files_changed', files_changed,
         'criteria_addressed', json(COALESCE(criteria_addressed, '[]'))
       ),
       blocked_on, next_step, open_question, tokens
  FROM checkpoints;

-- Criteria become verification kinds instead of a test path / human gate pair.
CREATE TABLE criteria_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id   INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  text         TEXT NOT NULL,
  verification TEXT NOT NULL DEFAULT 'artifact'
               CHECK (verification IN ('automated', 'human', 'artifact')),
  check_ref    TEXT,
  approved_at  TEXT,
  UNIQUE (request_id, position)
);

INSERT INTO criteria_new (id, request_id, position, text, verification, check_ref, approved_at)
SELECT id, request_id, position, text,
       CASE
         WHEN human_gate = 1 THEN 'human'
         WHEN test_path IS NOT NULL AND trim(test_path) <> '' THEN 'automated'
         ELSE 'artifact'
       END,
       test_path,
       approved_at
  FROM criteria;

DROP TABLE criteria;
ALTER TABLE criteria_new RENAME TO criteria;
CREATE INDEX idx_criteria_request ON criteria (request_id, position);
