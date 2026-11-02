-- Track the one-time system commit that closes a feature record.

ALTER TABLE features ADD COLUMN record_committed_at TEXT;
