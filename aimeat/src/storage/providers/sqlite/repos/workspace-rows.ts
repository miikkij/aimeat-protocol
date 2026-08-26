/**
 * @file src/storage/providers/sqlite/repos/workspace-rows.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite implementation of workspace row spaces.
 *
 *   THE CURSOR IS KEYSET, NOT OFFSET, and it is written out as an explicit disjunction rather than
 *   as an SQL row-value comparison. Two reasons: the same expression is what the Postgres side runs,
 *   so the two backends cannot drift into different pagination; and OFFSET on a growing table
 *   silently skips rows when something is appended between two pages, which is exactly what an
 *   append-mostly space does all day.
 *
 *   A REPEATED rowId REPLACES. `createdAt` and the surrogate `id` survive the replacement, so a
 *   re-run of a scheduled ingest updates what it already wrote instead of duplicating it, and the
 *   row's history of when it first arrived is not rewritten by the re-run.
 * @structure append / get / list / delete / deleteBefore / trim / stats / usage / deleteSpace
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import type Database from 'better-sqlite3';
import { logger } from '../../../../utils/logger.js';
import type {
  WorkspaceRowRecord,
  WorkspaceRowFilter,
  WorkspaceRowPage,
  WorkspaceRowStats,
  WorkspaceRowUsage,
  WorkspaceRowScope,
} from '../../../interface.js';
import { encodeRowCursor, decodeRowCursor } from '../../../workspace-row-cursor.js';

type Row = Record<string, unknown>;

/** SQLite stores JSON as TEXT. A malformed blob costs one row its body, never the whole read. */
function parseBody(v: unknown): Record<string, unknown> {
  if (typeof v !== 'string' || !v) return {};
  try {
    const p = JSON.parse(v) as unknown;
    return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
  } catch (err) {
    logger.warn('workspace-rows: unparseable body column, returning empty', { error: String(err) });
    return {};
  }
}

function toRow(r: Row): WorkspaceRowRecord {
  return {
    id: r.id as string,
    organismId: r.organismId as string,
    wsId: r.wsId as string,
    namespace: r.namespace as string,
    rowId: r.rowId as string,
    k1: (r.k1 as string) ?? '',
    k2: (r.k2 as string) ?? '',
    k3: (r.k3 as string) ?? '',
    occurredAt: r.occurredAt as string,
    createdAt: r.createdAt as string,
    updatedAt: r.updatedAt as string,
    createdBy: (r.createdBy as string) ?? '',
    body: parseBody(r.body),
    bytes: Number(r.bytes ?? 0),
  };
}

const bounded = (n: number | undefined, fallback: number): number =>
  Math.min(Math.max(n ?? fallback, 1), 500);

/** Every read of a space starts here, so the three-part address is never assembled twice. */
function spaceWhere(organismId: string, wsId: string, namespace: string): { sql: string; params: unknown[] } {
  return {
    sql: 'organismId = ? AND wsId = ? AND namespace = ?',
    params: [organismId, wsId, namespace],
  };
}

export function appendWorkspaceRows(db: Database.Database, rows: WorkspaceRowRecord[]): void {
  if (!rows.length) return;
  // ON CONFLICT keeps id and createdAt: the row's first arrival is a fact a re-run does not rewrite.
  const stmt = db.prepare(
    `INSERT INTO workspace_rows
       (id, organismId, wsId, namespace, rowId, k1, k2, k3,
        occurredAt, createdAt, updatedAt, createdBy, body, bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(organismId, wsId, namespace, rowId) DO UPDATE SET
       k1 = excluded.k1, k2 = excluded.k2, k3 = excluded.k3,
       occurredAt = excluded.occurredAt, updatedAt = excluded.updatedAt,
       createdBy = excluded.createdBy, body = excluded.body, bytes = excluded.bytes`
  );
  const run = db.transaction((batch: WorkspaceRowRecord[]) => {
    for (const r of batch) {
      stmt.run(
        r.id, r.organismId, r.wsId, r.namespace, r.rowId, r.k1, r.k2, r.k3,
        r.occurredAt, r.createdAt, r.updatedAt, r.createdBy, JSON.stringify(r.body), r.bytes,
      );
    }
  });
  run(rows);
}

export function getWorkspaceRow(
  db: Database.Database, organismId: string, wsId: string, namespace: string, rowId: string,
): WorkspaceRowRecord | null {
  const w = spaceWhere(organismId, wsId, namespace);
  const row = db.prepare(`SELECT * FROM workspace_rows WHERE ${w.sql} AND rowId = ?`)
    .get(...w.params, rowId) as Row | undefined;
  return row ? toRow(row) : null;
}

export function listWorkspaceRows(db: Database.Database, filter: WorkspaceRowFilter): WorkspaceRowPage {
  const desc = filter.order !== 'asc';
  const w = spaceWhere(filter.organismId, filter.wsId, filter.namespace);
  const clauses = [w.sql];
  const params: unknown[] = [...w.params];

  if (filter.k1) { clauses.push('k1 = ?'); params.push(filter.k1); }
  if (filter.k2) { clauses.push('k2 = ?'); params.push(filter.k2); }
  if (filter.k3) { clauses.push('k3 = ?'); params.push(filter.k3); }
  if (filter.since) { clauses.push('occurredAt >= ?'); params.push(filter.since); }
  if (filter.until) { clauses.push('occurredAt <= ?'); params.push(filter.until); }
  if (filter.changedSince) { clauses.push('updatedAt > ?'); params.push(filter.changedSince); }

  const after = decodeRowCursor(filter.cursor);
  if (after) {
    // Written out rather than as a row-value comparison, so this expression and the Postgres one
    // are the same expression. `id` breaks the tie inside one instant.
    const cmp = desc ? '<' : '>';
    clauses.push(`(occurredAt ${cmp} ? OR (occurredAt = ? AND id ${cmp} ?))`);
    params.push(after.occurredAt, after.occurredAt, after.id);
  }

  // One more than asked for, so "is there another page" is answered without a second query.
  const limit = bounded(filter.limit, 100);
  const dir = desc ? 'DESC' : 'ASC';
  const rows = db.prepare(
    `SELECT * FROM workspace_rows WHERE ${clauses.join(' AND ')}
     ORDER BY occurredAt ${dir}, id ${dir} LIMIT ?`
  ).all(...params, limit + 1) as Row[];

  const page = rows.slice(0, limit).map(toRow);
  const more = rows.length > limit;
  const last = page[page.length - 1];
  return { rows: page, cursor: more && last ? encodeRowCursor(last.occurredAt, last.id) : null };
}

export function deleteWorkspaceRow(
  db: Database.Database, organismId: string, wsId: string, namespace: string, rowId: string,
): boolean {
  const w = spaceWhere(organismId, wsId, namespace);
  const res = db.prepare(`DELETE FROM workspace_rows WHERE ${w.sql} AND rowId = ?`)
    .run(...w.params, rowId);
  return res.changes > 0;
}

export function deleteWorkspaceRowsBefore(
  db: Database.Database, organismId: string, wsId: string, namespace: string, before: string,
): number {
  const w = spaceWhere(organismId, wsId, namespace);
  // createdAt, not occurredAt: retention is a promise about how long WE keep a row.
  const res = db.prepare(`DELETE FROM workspace_rows WHERE ${w.sql} AND createdAt < ?`)
    .run(...w.params, before);
  return res.changes;
}

export function trimWorkspaceRows(
  db: Database.Database, organismId: string, wsId: string, namespace: string, keep: number,
): number {
  const w = spaceWhere(organismId, wsId, namespace);
  const run = db.transaction(() => {
    const ids = (db.prepare(
      `SELECT id FROM workspace_rows WHERE ${w.sql}
       ORDER BY occurredAt DESC, id DESC LIMIT 5000 OFFSET ?`
    ).all(...w.params, Math.max(keep, 0)) as Array<{ id: string }>).map(r => r.id);
    if (!ids.length) return 0;
    const holes = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM workspace_rows WHERE id IN (${holes})`).run(...ids);
    return ids.length;
  });
  return run();
}

export function workspaceRowStats(
  db: Database.Database, organismId: string, wsId: string, namespace?: string,
): WorkspaceRowStats[] {
  const clauses = ['organismId = ?', 'wsId = ?'];
  const params: unknown[] = [organismId, wsId];
  if (namespace) { clauses.push('namespace = ?'); params.push(namespace); }
  const rows = db.prepare(
    `SELECT namespace,
            count(*)          AS rows,
            coalesce(sum(bytes), 0) AS bytes,
            min(occurredAt)   AS oldest,
            max(occurredAt)   AS newest,
            max(createdAt)    AS lastWriteAt
     FROM workspace_rows WHERE ${clauses.join(' AND ')} GROUP BY namespace`
  ).all(...params) as Row[];
  return rows.map(r => ({
    namespace: r.namespace as string,
    rows: Number(r.rows ?? 0),
    bytes: Number(r.bytes ?? 0),
    oldest: (r.oldest as string) ?? null,
    newest: (r.newest as string) ?? null,
    lastWriteAt: (r.lastWriteAt as string) ?? null,
  }));
}

export function workspaceRowUsage(db: Database.Database, scope: WorkspaceRowScope): WorkspaceRowUsage {
  const clauses = ['organismId = ?'];
  const params: unknown[] = [scope.organismId];
  if (scope.wsId) { clauses.push('wsId = ?'); params.push(scope.wsId); }
  const row = db.prepare(
    `SELECT count(*) AS rows, coalesce(sum(bytes), 0) AS bytes
     FROM workspace_rows WHERE ${clauses.join(' AND ')}`
  ).get(...params) as Row | undefined;
  return { rows: Number(row?.rows ?? 0), bytes: Number(row?.bytes ?? 0) };
}

export function deleteWorkspaceRowSpace(
  db: Database.Database, organismId: string, wsId: string, namespace?: string,
): number {
  const clauses = ['organismId = ?', 'wsId = ?'];
  const params: unknown[] = [organismId, wsId];
  if (namespace) { clauses.push('namespace = ?'); params.push(namespace); }
  return db.prepare(`DELETE FROM workspace_rows WHERE ${clauses.join(' AND ')}`).run(...params).changes;
}
