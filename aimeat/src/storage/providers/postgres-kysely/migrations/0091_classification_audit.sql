-- 0091_classification_audit.sql
-- The classification audit log (TARGET-082 V4). A row says that a reader was shown an item, used
-- it in an AI call, was refused it, or changed its label, in one minute. The row is a COUNT: the
-- same reader, the same item and the same action in the same minute is one row whose "count" grows,
-- so the table grows with distinct (reader, item, minute) combinations and never with raw reads.
-- Writes come in batches from an in-memory buffer, and rows older than the operator's retention
-- (default 365 days) are pruned by a core job.
--
-- "minute" is an ISO 8601 UTC timestamp truncated to the minute. "scope" is the owner identity of
-- personal content or 'organism:<id>' for organism content, the same scope the "ContentLabel" row
-- carries. "ownerGaii" names the person whose content it is, for erasure; it is NULL on organism
-- content, which goes with the organism.
--
-- Mirrors the SQLite table classification_audit in schema-tables-4.ts.
CREATE TABLE IF NOT EXISTS "ClassificationAudit" (
    "id"         TEXT NOT NULL,
    "minute"     TEXT NOT NULL,
    "scope"      TEXT NOT NULL,
    "ownerGaii"  TEXT,
    "kind"       TEXT NOT NULL,
    "key"        TEXT NOT NULL,
    "label"      TEXT NOT NULL,
    "reader"     TEXT NOT NULL,
    "readerKind" TEXT NOT NULL,
    "action"     TEXT NOT NULL,
    "purpose"    TEXT,
    "count"      INTEGER NOT NULL DEFAULT 1,
    "firstAt"    TEXT NOT NULL,
    "lastAt"     TEXT NOT NULL,

    CONSTRAINT "ClassificationAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ClassificationAudit_address_key"
    ON "ClassificationAudit"("minute", "reader", "action", "scope", "kind", "key");
CREATE INDEX IF NOT EXISTS "ClassificationAudit_ownerGaii_lastAt_idx" ON "ClassificationAudit"("ownerGaii", "lastAt");
CREATE INDEX IF NOT EXISTS "ClassificationAudit_scope_lastAt_idx" ON "ClassificationAudit"("scope", "lastAt");
CREATE INDEX IF NOT EXISTS "ClassificationAudit_lastAt_idx" ON "ClassificationAudit"("lastAt");
