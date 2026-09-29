-- 0090_content_labels.sql
-- Classification labels (TARGET-082). A label is its own row that points at the content it
-- describes, the way "AiProvenance" does, so no memory value and no workspace schema changes, and a
-- read can look the label up before it loads the value.
--
-- A row is addressed by (kind, scope, key): kind is memory, file or row; scope is the owner identity
-- of personal content or 'organism:<id>' for organism content; key is the memory key, the storage
-- key, or '<ws>/<space>/<rowId>'. "ownerGaii" names the person whose content it is, for erasure; it
-- is NULL on organism content, which goes with the organism.
--
-- The read that matters is the batch one (scope + key IN (...)), served by the unique index.
-- Mirrors the SQLite table content_labels in schema-tables-4.ts.
CREATE TABLE IF NOT EXISTS "ContentLabel" (
    "id"            TEXT NOT NULL,
    "kind"          TEXT NOT NULL,
    "scope"         TEXT NOT NULL,
    "key"           TEXT NOT NULL,
    "ownerGaii"     TEXT,
    "label"         TEXT NOT NULL,
    "source"        TEXT NOT NULL,
    "locked"        BOOLEAN NOT NULL DEFAULT false,
    "suggestion"    JSONB,
    "justification" TEXT,
    "humanSaid"     TEXT,
    "history"       JSONB NOT NULL DEFAULT '[]'::jsonb,
    "setBy"         TEXT NOT NULL,
    "updatedAt"     TEXT NOT NULL,

    CONSTRAINT "ContentLabel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ContentLabel_kind_scope_key_key" ON "ContentLabel"("kind", "scope", "key");
CREATE INDEX IF NOT EXISTS "ContentLabel_ownerGaii_idx" ON "ContentLabel"("ownerGaii");
