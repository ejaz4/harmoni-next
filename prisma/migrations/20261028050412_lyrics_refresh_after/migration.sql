-- The column now schedules background rechecks for every cached row, not
-- just retries after failures. Renamed in place to keep existing values.
ALTER TABLE "Lyrics" RENAME COLUMN "retryAfter" TO "refreshAfter";
