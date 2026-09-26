-- 0082_visit_retention.sql
-- The privacy notice promises that a record of somebody opening a published app names their
-- account for thirteen months, and that only counts without names remain after that. The nightly
-- job that keeps the promise (services/usage/visit-retention.ts) looks for the app opens that still
-- name an account and are old enough to fold, in three places.
--
-- WHY PARTIAL. The archive keeps every call the node has ever counted, and it has no index on "ts"
-- at all. A daily query over it would read the whole table to find one day's worth of named opens.
-- These three indexes hold only the rows the job is looking for: an app open that still names
-- somebody. A folded row carries '(signed-in)' (USAGE_FOLDED_VISITOR in storage/types/usage.ts) and
-- leaves the index, so each stays about thirteen months of named opens, however old the node gets.
--
-- The predicate is written with literals because the planner can use a partial index only when the
-- query's own WHERE clause proves the index's, and the query writes the same literals. Mirrors the
-- SQLite indexes in schema-tables-4.ts.
CREATE INDEX IF NOT EXISTS "UsageCall_named_visit_idx" ON "UsageCall"("ts")
  WHERE "surface" = 'app' AND "ownerGhii" <> '' AND "ownerGhii" <> '(signed-in)';

CREATE INDEX IF NOT EXISTS "UsageCallArchive_named_visit_idx" ON "UsageCallArchive"("ts")
  WHERE "surface" = 'app' AND "ownerGhii" <> '' AND "ownerGhii" <> '(signed-in)';

CREATE INDEX IF NOT EXISTS "UsageRollup_named_visit_idx" ON "UsageRollup"("bucket")
  WHERE "grain" = 'day' AND "surface" = 'app' AND "ownerGhii" <> '' AND "ownerGhii" <> '(signed-in)';
