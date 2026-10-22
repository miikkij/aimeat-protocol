/**
 * @file src/storage/providers/sqlite/repos/workspace-row-revisions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite implementation of row revisions: the earlier content of a row, kept when a
 *   writer of another family replaced it (services/workspace-rows/row-service.ts appendRows), and
 *   read back by the delete authority to restore it.
 *
 *   THE PRUNE IS ONE PASS OVER ONE SPACE: what was replaced before the cutoff, what belongs to a row
 *   that is gone, and everything past the newest `keepPerRow` of a row. The same three conditions
 *   are what the Postgres side runs.
 * @structure append / list / get / deleteForRow / prune
 * @version-history
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10, v80; developer ruling 2026-10-22).
 */
import type Database from 'better-sqlite3';
import { logger } from '../../../../utils/logger.js';
import type { WorkspaceRowRevision } from '../../../interface.js';

type Row = Record<string, unknown>;

function parseBody(v: unknown): Record<string, unknown> {
  if (typeof v !== 'string' || !v) return {};
  try {
    const p = JSON.parse(v) as unknown;
    return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
  } catch (err) {
    logger.warn('workspace-row-revisions: unparseable body column, returning empty', { error: String(err) });
    return {};
  }
}

function toRevision(r: Row): WorkspaceRowRevision {
  return {
    revisionId: r.revisionId as string,
    organismId: r.organismId as string,
    wsId: r.wsId as string,
    namespace: r.namespace as string,
    rowId: r.rowId as string,
    id: r.id as string,
    occurredAt: r.occurredAt as string,
    createdAt: r.createdAt as string,
    updatedAt: r.updatedAt as string,
    createdBy: (r.createdBy as string) ?? '',
    updatedBy: (r.updatedBy as string) ?? '',
    body: parseBody(r.body),
    bytes: Number(r.bytes ?? 0),
    replacedAt: r.replacedAt as string,
    replacedBy: (r.replacedBy as string) ?? '',
  };
}

const SPACE = 'organismId = ? AND wsId = ? AND namespace = ?';

export function appendWorkspaceRowRevisions(db: Database.Database, revisions: WorkspaceRowRevision[]): void {
  if (!revisions.length) return;
  const stmt = db.prepare(
    `INSERT INTO workspace_row_revisions
       (revisionId, organismId, wsId, namespace, rowId, id, occurredAt, createdAt, updatedAt,
        createdBy, updatedBy, body, bytes, replacedAt, replacedBy)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const run = db.transaction((batch: WorkspaceRowRevision[]) => {
    for (const r of batch) {
      stmt.run(
        r.revisionId, r.organismId, r.wsId, r.namespace, r.rowId, r.id, r.occurredAt, r.createdAt,
        r.updatedAt, r.createdBy, r.updatedBy, JSON.stringify(r.body), r.bytes, r.replacedAt, r.replacedBy,
      );
    }
  });
  run(revisions);
}

export function listWorkspaceRowRevisions(
  db: Database.Database, organismId: string, wsId: string, namespace: string, rowId: string,
): WorkspaceRowRevision[] {
  const rows = db.prepare(
    `SELECT * FROM workspace_row_revisions WHERE ${SPACE} AND rowId = ?
     ORDER BY replacedAt DESC, revisionId DESC LIMIT 100`,
  ).all(organismId, wsId, namespace, rowId) as Row[];
  return rows.map(toRevision);
}

export function getWorkspaceRowRevision(
  db: Database.Database, organismId: string, wsId: string, namespace: string, revisionId: string,
): WorkspaceRowRevision | null {
  const row = db.prepare(`SELECT * FROM workspace_row_revisions WHERE ${SPACE} AND revisionId = ?`)
    .get(organismId, wsId, namespace, revisionId) as Row | undefined;
  return row ? toRevision(row) : null;
}

export function deleteWorkspaceRowRevisions(
  db: Database.Database, organismId: string, wsId: string, namespace: string, rowId: string,
): number {
  return db.prepare(`DELETE FROM workspace_row_revisions WHERE ${SPACE} AND rowId = ?`)
    .run(organismId, wsId, namespace, rowId).changes;
}

export function pruneWorkspaceRowRevisions(
  db: Database.Database, organismId: string, wsId: string, namespace: string, before: string, keepPerRow: number,
): number {
  const p = [organismId, wsId, namespace];
  const run = db.transaction(() => {
    let n = db.prepare(`DELETE FROM workspace_row_revisions WHERE ${SPACE} AND replacedAt < ?`)
      .run(...p, before).changes;
    n += db.prepare(
      `DELETE FROM workspace_row_revisions WHERE ${SPACE} AND NOT EXISTS (
         SELECT 1 FROM workspace_rows w WHERE w.organismId = workspace_row_revisions.organismId
           AND w.wsId = workspace_row_revisions.wsId AND w.namespace = workspace_row_revisions.namespace
           AND w.rowId = workspace_row_revisions.rowId)`,
    ).run(...p).changes;
    n += db.prepare(
      `DELETE FROM workspace_row_revisions WHERE revisionId IN (
         SELECT revisionId FROM (
           SELECT revisionId, ROW_NUMBER() OVER (PARTITION BY rowId ORDER BY replacedAt DESC, revisionId DESC) AS n
           FROM workspace_row_revisions WHERE ${SPACE}
         ) WHERE n > ?)`,
    ).run(...p, Math.max(keepPerRow, 0)).changes;
    return n;
  });
  return run();
}
