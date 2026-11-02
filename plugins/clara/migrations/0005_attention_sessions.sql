-- Link ledger rows to the Clara session that should carry their alerts.
--
-- A feature remembers the session where the human submitted it. Later
-- exceptions for that feature are prompted into the same conversation instead
-- of opening a new one. Workspace-level exceptions fall back to the workspace
-- session.
--
-- Alerts keep the delivery target and timestamp so the daemon can tell which
-- rows have already been handed to Clara. `attention_state` records the last
-- presentation Clara chose for the row.

ALTER TABLE features ADD COLUMN session_id TEXT;
ALTER TABLE workspaces ADD COLUMN session_id TEXT;

ALTER TABLE alerts ADD COLUMN session_id TEXT;
ALTER TABLE alerts ADD COLUMN notified_at TEXT;
ALTER TABLE alerts ADD COLUMN attention_state TEXT;

CREATE INDEX idx_alerts_undelivered ON alerts (session_id, id);
