-- 0136_data_daily.sql
-- What data passed through the node, without the data (types/value.ts DataDailyDelta, 2026-11-20).
-- Mirrors SQLite schema-value.ts. One day's count of writes of one kind (memory, workspace, row,
-- file), from one source (person, agent, app, extension, automation, federation), in one direction
-- (in, shared into an organism), in one size class, at one classification label and of one content
-- class. No key, title, file name, field value or content is kept. "ownerGhii" is the person whose
-- data it is: their own report reads it, the operator's report reads only sums over at least five
-- owners, and the erasure cascade deletes it.
--
-- It goes stale by age: the core job value-fold deletes the day rows older than its window.

CREATE TABLE IF NOT EXISTS "DataDaily" (
    "day"          TEXT   NOT NULL,
    "ownerGhii"    TEXT   NOT NULL,
    "kind"         TEXT   NOT NULL,
    "source"       TEXT   NOT NULL,
    "direction"    TEXT   NOT NULL,
    "sizeBucket"   TEXT   NOT NULL,
    "level"        TEXT   NOT NULL DEFAULT '',
    "contentClass" TEXT   NOT NULL DEFAULT '',
    "count"        BIGINT NOT NULL DEFAULT 0,
    "bytes"        BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT "DataDaily_pkey" PRIMARY KEY ("day", "ownerGhii", "kind", "source", "direction", "sizeBucket", "level", "contentClass")
);

CREATE INDEX IF NOT EXISTS "idx_data_daily_owner" ON "DataDaily" ("ownerGhii", "day");
CREATE INDEX IF NOT EXISTS "idx_data_daily_day" ON "DataDaily" ("day");
