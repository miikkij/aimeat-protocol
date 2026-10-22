-- 0113_workspace_row_revisions.sql
--
-- A row's earlier content, kept when a writer of another family replaced it.
--
-- An append with a caller-chosen rowId replaces the stored row. That is how an ingest removes
-- duplicates, how the refinery moves a queue row, and how an app re-sends its own event. A row space
-- keeps no version history, so a principal that held the append door and not the delete authority
-- (memory:purge) could remove another member's row content for good by re-appending under its rowId
-- (secaudit 2026-10, v80). The developer ruled on 2026-10-22: no refusal and no approval step. When a
-- write replaces a row whose last writer is of another writer family, the node keeps the old content
-- here, the row keeps its original author in "createdBy", and "updatedBy" names the new writer. The
-- delete authority lists and restores a revision on REST, MCP and the CLI.
--
-- NULL "updatedBy" is every row written before this migration, and it reads as "createdBy". Nothing
-- is backfilled and no existing row changes.
--
-- Mirrors the SQLite schema in providers/sqlite/schema-workspace-row-revisions.ts.

ALTER TABLE "WorkspaceRow" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT;

CREATE TABLE IF NOT EXISTS "WorkspaceRowRevision" (
  "revisionId"   TEXT NOT NULL,
  "organismId"   TEXT NOT NULL,
  "wsId"         TEXT NOT NULL,
  "namespace"    TEXT NOT NULL,
  "rowId"        TEXT NOT NULL,
  -- The row's surrogate id, which the row's classification label is addressed by.
  "id"           TEXT NOT NULL,
  "occurredAt"   TEXT NOT NULL,
  "createdAt"    TEXT NOT NULL,
  "updatedAt"    TEXT NOT NULL,
  "createdBy"    TEXT NOT NULL DEFAULT '',
  -- The principal that wrote this content.
  "updatedBy"    TEXT NOT NULL DEFAULT '',
  "body"         JSONB NOT NULL DEFAULT '{}'::jsonb,
  "bytes"        INTEGER NOT NULL DEFAULT 0,
  "replacedAt"   TEXT NOT NULL,
  "replacedBy"   TEXT NOT NULL DEFAULT '',
  CONSTRAINT "WorkspaceRowRevision_pkey" PRIMARY KEY ("revisionId")
);

-- One row's revisions, newest first: the list read, the restore lookup and the per-row cap.
CREATE INDEX IF NOT EXISTS "WorkspaceRowRevision_row_idx"
  ON "WorkspaceRowRevision"("organismId", "wsId", "namespace", "rowId", "replacedAt" DESC);
-- The age sweep of one space.
CREATE INDEX IF NOT EXISTS "WorkspaceRowRevision_space_replaced_idx"
  ON "WorkspaceRowRevision"("organismId", "wsId", "namespace", "replacedAt");
