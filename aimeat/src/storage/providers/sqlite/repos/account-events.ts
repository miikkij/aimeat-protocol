/**
 * @file src/storage/providers/sqlite/repos/account-events.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite implementation of the per-owner event window and its archive.
 * @structure append / list / listArchive / countArchive / trim
 * @version-history
 *   v1.0.0 — 2026-08-17 — Initial.
 */
import type Database from 'better-sqlite3';
import { logger } from '../../../../utils/logger.js';
import type {
  AccountEventRecord,
  AccountEventFilter,
  AccountEventTrimResult,
  AccountEventKind,
} from '../../../interface.js';

type Row = Record<string, unknown>;

/** SQLite stores JSON as TEXT. A malformed blob costs one row its detail, never the whole read. */
function parseData(v: unknown): Record<string, string> {
  if (typeof v !== 'string' || !v) return {};
  try {
    const p = JSON.parse(v) as unknown;
    return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, string>) : {};
  } catch (err) {
    logger.warn('account-events: unparseable data column, returning empty', { error: String(err) });
    return {};
  }
}

function toEvent(r: Row): AccountEventRecord {
  return {
    id: r.id as string,
    ownerGhii: r.ownerGhii as string,
    at: r.at as string,
    kind: r.kind as AccountEventKind,
    actorGaii: (r.actorGaii as string) ?? '',
    data: parseData(r.data),
    link: (r.link as string) ?? '',
    subject: (r.subject as string) ?? '',
  };
}

const bounded = (n: number | undefined, fallback: number): number =>
  Math.min(Math.max(n ?? fallback, 1), 500);

/** The same WHERE for the window and for the archive: they answer one question about two ages. */
function where(filter: AccountEventFilter): { sql: string; params: unknown[] } {
  const clauses = ['ownerGhii = ?'];
  const params: unknown[] = [filter.ownerGhii];
  if (filter.kind) { clauses.push('kind = ?'); params.push(filter.kind); }
  if (filter.from) { clauses.push('at >= ?'); params.push(filter.from); }
  if (filter.to) { clauses.push('at <= ?'); params.push(filter.to); }
  return { sql: clauses.join(' AND '), params };
}

export function appendAccountEvent(db: Database.Database, e: AccountEventRecord): void {
  db.prepare(
    `INSERT INTO account_events (id, ownerGhii, at, kind, actorGaii, data, link, subject)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(e.id, e.ownerGhii, e.at, e.kind, e.actorGaii, JSON.stringify(e.data), e.link, e.subject);
}

export function listAccountEvents(db: Database.Database, filter: AccountEventFilter): AccountEventRecord[] {
  const w = where(filter);
  const rows = db.prepare(
    `SELECT * FROM account_events WHERE ${w.sql} ORDER BY at DESC LIMIT ? OFFSET ?`
  ).all(...w.params, bounded(filter.limit, 100), Math.max(filter.offset ?? 0, 0)) as Row[];
  return rows.map(toEvent);
}

export function listAccountEventArchive(db: Database.Database, filter: AccountEventFilter): AccountEventRecord[] {
  const w = where(filter);
  const rows = db.prepare(
    `SELECT * FROM account_events_archive WHERE ${w.sql} ORDER BY at DESC LIMIT ? OFFSET ?`
  ).all(...w.params, bounded(filter.limit, 100), Math.max(filter.offset ?? 0, 0)) as Row[];
  return rows.map(toEvent);
}

export function countAccountEventArchive(db: Database.Database, ownerGhii: string): number {
  const row = db.prepare('SELECT count(*) AS n FROM account_events_archive WHERE ownerGhii = ?')
    .get(ownerGhii) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

/** Move everything past the newest `keep` into the archive, atomically. Nothing is deleted. */
export function trimAccountEvents(
  db: Database.Database, ownerGhii: string, keep: number,
): AccountEventTrimResult {
  const COLS = 'id, ownerGhii, at, kind, actorGaii, data, link, subject';
  const run = db.transaction(() => {
    const ids = (db.prepare(
      'SELECT id FROM account_events WHERE ownerGhii = ? ORDER BY at DESC LIMIT 500 OFFSET ?'
    ).all(ownerGhii, Math.max(keep, 0)) as Array<{ id: string }>).map(r => r.id);
    if (!ids.length) return { archived: 0 };

    const holes = ids.map(() => '?').join(',');
    // Columns named rather than copied positionally, so a later ALTER on the hot table cannot
    // silently shift values into the wrong archive columns.
    db.prepare(
      `INSERT OR IGNORE INTO account_events_archive (${COLS}, archivedAt)
       SELECT ${COLS}, ? FROM account_events WHERE id IN (${holes})`
    ).run(new Date().toISOString(), ...ids);
    db.prepare(`DELETE FROM account_events WHERE id IN (${holes})`).run(...ids);
    return { archived: ids.length };
  });
  return run();
}
