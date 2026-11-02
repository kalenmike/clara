-- Drop the remaining software-specific storage.
--
-- Evidence and progress are now the only sources. The old tools that wrote
-- these columns and the checkpoints table are removed in the same change.

ALTER TABLE requests DROP COLUMN tests_hash;
ALTER TABLE requests DROP COLUMN docs_impact;
DROP TABLE checkpoints;
