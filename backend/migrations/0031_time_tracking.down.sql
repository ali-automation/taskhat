DROP TABLE IF EXISTS worklogs;
ALTER TABLE issues DROP COLUMN IF EXISTS remaining_estimate_seconds;
ALTER TABLE issues DROP COLUMN IF EXISTS original_estimate_seconds;
