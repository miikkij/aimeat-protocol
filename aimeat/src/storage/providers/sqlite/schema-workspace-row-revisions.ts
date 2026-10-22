/**
 * @file sqlite/schema-workspace-row-revisions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The SQLite half of row revisions: workspace_rows.updatedBy, and the
 *   workspace_row_revisions table that keeps a row's earlier content when a writer of another
 *   family replaced it. Mirrors Postgres migration 0113. Called at the end of applySchemaTables4,
 *   after workspace_rows exists; idempotent on every boot.
 *
 *   NULL updatedBy is every row written before 2026-10-22, and it reads as createdBy. Nothing is
 *   backfilled and no existing row changes.
 * @version-history
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10, v80; developer ruling 2026-10-22).
 */
import type Database from 'better-sqlite3';

export function applyWorkspaceRowRevisionSchema(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(workspace_rows)').all() as Array<{ name: string }>;
  if (!columns.some(c => c.name === 'updatedBy')) {
    db.exec('ALTER TABLE workspace_rows ADD COLUMN updatedBy TEXT');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_row_revisions (
      revisionId  TEXT    PRIMARY KEY,
      organismId  TEXT    NOT NULL,
      wsId        TEXT    NOT NULL,
      namespace   TEXT    NOT NULL,
      rowId       TEXT    NOT NULL,
      id          TEXT    NOT NULL,
      occurredAt  TEXT    NOT NULL,
      createdAt   TEXT    NOT NULL,
      updatedAt   TEXT    NOT NULL,
      createdBy   TEXT    NOT NULL DEFAULT '',
      updatedBy   TEXT    NOT NULL DEFAULT '',
      body        TEXT    NOT NULL DEFAULT '{}',
      bytes       INTEGER NOT NULL DEFAULT 0,
      replacedAt  TEXT    NOT NULL,
      replacedBy  TEXT    NOT NULL DEFAULT ''
    );
    -- One row's revisions, newest first: the list read, the restore lookup and the per-row cap.
    CREATE INDEX IF NOT EXISTS idx_wsrowrev_row
      ON workspace_row_revisions(organismId, wsId, namespace, rowId, replacedAt DESC);
    -- The age sweep of one space.
    CREATE INDEX IF NOT EXISTS idx_wsrowrev_space_replaced
      ON workspace_row_revisions(organismId, wsId, namespace, replacedAt);
  `);
}
