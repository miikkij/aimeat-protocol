-- 0135_value_signals.sql
-- What happened to the records an AI made (types/value.ts, 2026-11-20). Mirrors SQLite
-- schema-value.ts. The node derives the signals where a principal writes, deletes or opens a memory
-- record (services/value/signal-buffer.ts): nobody acknowledges anything.
--
-- "ValueKey" is the state of one LIVE AI-made record: its maker, how often the maker revised it, how
-- often someone else corrected it (and by how many bytes), and how often someone else opened it. The
-- row is deleted with the record, so it never outgrows the Memory table; the rejection stays in the
-- daily counts.
--
-- "ValueDaily" is the count per day of each signal, by owner, organism, workspace, maker and key
-- family. Day rows older than the daily window are folded into week rows ("grain" 'week', "day" the
-- Monday) by the core job value-fold, so the table stays bounded and a year-on-year comparison keeps
-- its weeks.

CREATE TABLE IF NOT EXISTS "ValueKey" (
    "ownerGaii"       TEXT    NOT NULL,
    "key"             TEXT    NOT NULL,
    "producer"        TEXT    NOT NULL,
    "producerLevel"   TEXT,
    "producedAt"      TEXT    NOT NULL,
    "revisions"       BIGINT  NOT NULL DEFAULT 0,
    "corrections"     BIGINT  NOT NULL DEFAULT 0,
    "correctionBytes" BIGINT  NOT NULL DEFAULT 0,
    "lastCorrectedAt" TEXT,
    "readsByOthers"   BIGINT  NOT NULL DEFAULT 0,
    "lastReadAt"      TEXT,
    "lastBytes"       BIGINT  NOT NULL DEFAULT 0,
    CONSTRAINT "ValueKey_pkey" PRIMARY KEY ("ownerGaii", "key")
);

CREATE INDEX IF NOT EXISTS "idx_value_key_producer" ON "ValueKey" ("producer");

CREATE TABLE IF NOT EXISTS "ValueDaily" (
    "day"       TEXT   NOT NULL,
    "grain"     TEXT   NOT NULL DEFAULT 'day',
    "ownerGhii" TEXT   NOT NULL,
    "orgId"     TEXT   NOT NULL DEFAULT '',
    "wsId"      TEXT   NOT NULL DEFAULT '',
    "producer"  TEXT   NOT NULL,
    "family"    TEXT   NOT NULL,
    "signal"    TEXT   NOT NULL,
    "count"     BIGINT NOT NULL DEFAULT 0,
    "bytes"     BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT "ValueDaily_pkey" PRIMARY KEY ("day", "grain", "ownerGhii", "orgId", "wsId", "producer", "family", "signal")
);

CREATE INDEX IF NOT EXISTS "idx_value_daily_owner" ON "ValueDaily" ("ownerGhii", "day");
CREATE INDEX IF NOT EXISTS "idx_value_daily_org" ON "ValueDaily" ("orgId", "day");
CREATE INDEX IF NOT EXISTS "idx_value_daily_producer" ON "ValueDaily" ("producer");
CREATE INDEX IF NOT EXISTS "idx_value_daily_day" ON "ValueDaily" ("day");
