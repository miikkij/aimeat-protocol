/**
 * @file src/storage/providers/sqlite/repos/value.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite SQL for the value signals (repositories/value.repository.ts). The per-record
 *   upsert writes the maker on insert only and adds the counts; the daily upsert adds; the fold turns
 *   old day rows into week rows (Monday) and deletes them, in one transaction.
 * @structure getKeys · upsertKeys · deleteKeys · listKeys · upsertDaily · sumDaily · foldDaily ·
 *   pseudonymiseProducer
 * @usage import * as repo from '../repos/value.js';
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-n-hy-ty-n-kyy-kulu-hy-ty-ja-k-yt-n-rytmi, phase 1).
 */
import type Database from 'better-sqlite3';
import type {
  ValueKeyRow, ValueKeyDelta, ValueDailyDelta, ValueDailyFilter, ValueDailyGroup, ValueDailySum,
} from '../../../types/value.js';

const KEY_UPSERT = `
  INSERT INTO value_keys (ownerGaii, key, producer, producerLevel, producedAt, revisions, corrections,
    correctionBytes, lastCorrectedAt, readsByOthers, lastReadAt, lastBytes)
  VALUES (@ownerGaii, @key, @producer, @producerLevel, @producedAt, @revisions, @corrections,
    @correctionBytes, @lastCorrectedAt, @readsByOthers, @lastReadAt, coalesce(@lastBytes, 0))
  ON CONFLICT(ownerGaii, key) DO UPDATE SET
    revisions       = revisions + excluded.revisions,
    corrections     = corrections + excluded.corrections,
    correctionBytes = correctionBytes + excluded.correctionBytes,
    lastCorrectedAt = CASE WHEN excluded.lastCorrectedAt IS NULL THEN lastCorrectedAt
                           WHEN lastCorrectedAt IS NULL THEN excluded.lastCorrectedAt
                           ELSE max(lastCorrectedAt, excluded.lastCorrectedAt) END,
    readsByOthers   = readsByOthers + excluded.readsByOthers,
    lastReadAt      = CASE WHEN excluded.lastReadAt IS NULL THEN lastReadAt
                           WHEN lastReadAt IS NULL THEN excluded.lastReadAt
                           ELSE max(lastReadAt, excluded.lastReadAt) END,
    lastBytes       = CASE WHEN @lastBytes IS NULL THEN lastBytes ELSE @lastBytes END
`;

const DAILY_UPSERT = `
  INSERT INTO value_daily (day, grain, ownerGhii, orgId, wsId, producer, family, signal, count, bytes)
  VALUES (@day, 'day', @ownerGhii, @orgId, @wsId, @producer, @family, @signal, @count, @bytes)
  ON CONFLICT(day, grain, ownerGhii, orgId, wsId, producer, family, signal) DO UPDATE SET
    count = count + excluded.count,
    bytes = bytes + excluded.bytes
`;

/** The columns a caller may group by; anything else is refused rather than put into SQL. */
const GROUPABLE: ReadonlySet<ValueDailyGroup> = new Set(['day', 'signal', 'producer', 'family', 'ownerGhii', 'orgId', 'wsId']);

export function getKeys(db: Database.Database, pairs: Array<{ ownerGaii: string; key: string }>): ValueKeyRow[] {
  if (pairs.length === 0) return [];
  const stmt = db.prepare('SELECT * FROM value_keys WHERE ownerGaii = ? AND key = ?');
  const out: ValueKeyRow[] = [];
  for (const p of pairs.slice(0, 1000)) {
    const row = stmt.get(p.ownerGaii, p.key) as ValueKeyRow | undefined;
    if (row) out.push(row);
  }
  return out;
}

export function upsertKeys(db: Database.Database, rows: ValueKeyDelta[]): void {
  if (rows.length === 0) return;
  const stmt = db.prepare(KEY_UPSERT);
  db.transaction((batch: ValueKeyDelta[]) => { for (const r of batch) stmt.run(r); })(rows);
}

export function deleteKeys(db: Database.Database, pairs: Array<{ ownerGaii: string; key: string }>): void {
  if (pairs.length === 0) return;
  const stmt = db.prepare('DELETE FROM value_keys WHERE ownerGaii = ? AND key = ?');
  db.transaction((batch: Array<{ ownerGaii: string; key: string }>) => {
    for (const p of batch) stmt.run(p.ownerGaii, p.key);
  })(pairs);
}

export function listKeys(
  db: Database.Database,
  f: { ownerGaii: string; keyPrefix?: string; keys?: string[]; limit?: number },
): ValueKeyRow[] {
  const where: string[] = ['ownerGaii = ?'];
  const args: unknown[] = [f.ownerGaii];
  if (f.keys && f.keys.length > 0) {
    const keys = f.keys.slice(0, 1000);
    where.push(`key IN (${keys.map(() => '?').join(',')})`);
    args.push(...keys);
  } else if (f.keyPrefix) {
    where.push('key LIKE ? ESCAPE \'\\\'');
    args.push(`${escapeLike(f.keyPrefix)}%`);
  }
  args.push(Math.min(f.limit ?? 500, 5000));
  return db.prepare(
    `SELECT * FROM value_keys WHERE ${where.join(' AND ')} ORDER BY producedAt DESC LIMIT ?`,
  ).all(...args) as ValueKeyRow[];
}

export function upsertDaily(db: Database.Database, rows: ValueDailyDelta[]): void {
  if (rows.length === 0) return;
  const stmt = db.prepare(DAILY_UPSERT);
  db.transaction((batch: ValueDailyDelta[]) => { for (const r of batch) stmt.run(r); })(rows);
}

export function sumDaily(db: Database.Database, f: ValueDailyFilter, groupBy: ValueDailyGroup[]): ValueDailySum[] {
  const cols = groupBy.filter(g => GROUPABLE.has(g));
  const where: string[] = [];
  const args: unknown[] = [];
  if (f.ownerGhii) { where.push('ownerGhii = ?'); args.push(f.ownerGhii); }
  if (f.orgId) { where.push('orgId = ?'); args.push(f.orgId); }
  if (f.wsId) { where.push('wsId = ?'); args.push(f.wsId); }
  if (f.producer) { where.push('producer = ?'); args.push(f.producer); }
  if (f.from) { where.push('day >= ?'); args.push(f.from); }
  if (f.to) { where.push('day <= ?'); args.push(f.to); }
  const select = [...cols, 'SUM(count) AS count', 'SUM(bytes) AS bytes', 'COUNT(DISTINCT ownerGhii) AS owners'].join(', ');
  const sql = `SELECT ${select} FROM value_daily`
    + (where.length ? ` WHERE ${where.join(' AND ')}` : '')
    + (cols.length ? ` GROUP BY ${cols.join(', ')} ORDER BY ${cols.join(', ')}` : '');
  return (db.prepare(sql).all(...args) as Array<Record<string, unknown>>).map(r => ({
    ...r, count: Number(r.count ?? 0), bytes: Number(r.bytes ?? 0), owners: Number(r.owners ?? 0),
  })) as ValueDailySum[];
}

/**
 * Day rows before `beforeDay` become week rows keyed by their week's Monday. `weekday 0` moves a date
 * to the next Sunday (a Sunday stays), and six days back is that week's Monday.
 */
export function foldDaily(db: Database.Database, beforeDay: string): number {
  return db.transaction((cutoff: string): number => {
    db.prepare(`
      INSERT INTO value_daily (day, grain, ownerGhii, orgId, wsId, producer, family, signal, count, bytes)
      SELECT date(day, 'weekday 0', '-6 days'), 'week', ownerGhii, orgId, wsId, producer, family, signal,
             SUM(count), SUM(bytes)
      FROM value_daily WHERE grain = 'day' AND day < ?
      GROUP BY date(day, 'weekday 0', '-6 days'), ownerGhii, orgId, wsId, producer, family, signal
      ON CONFLICT(day, grain, ownerGhii, orgId, wsId, producer, family, signal) DO UPDATE SET
        count = count + excluded.count,
        bytes = bytes + excluded.bytes
    `).run(cutoff);
    return db.prepare(`DELETE FROM value_daily WHERE grain = 'day' AND day < ?`).run(cutoff).changes;
  })(beforeDay);
}

/**
 * The erased person's agents as the maker of another person's records keep their counts under a
 * stable marker: the counts are the other person's record. Same marker as the write tally.
 */
export function pseudonymiseProducer(db: Database.Database, ownerGhii: string, marker: string): number {
  const asAgent = `%#${ownerGhii}`;
  let n = 0;
  n += db.prepare('UPDATE value_keys SET producer = ? WHERE ownerGaii <> ? AND ownerGaii NOT LIKE ? AND (producer = ? OR producer LIKE ?)')
    .run(marker, ownerGhii, asAgent, ownerGhii, asAgent).changes;
  // A day row may already exist under the marker: the moved counts are added to it, not lost on the key.
  const where = 'WHERE ownerGhii <> ? AND (producer = ? OR producer LIKE ?)';
  const moved = db.prepare(`SELECT * FROM value_daily ${where}`).all(ownerGhii, ownerGhii, asAgent) as Array<Record<string, unknown>>;
  if (moved.length > 0) {
    db.prepare(`DELETE FROM value_daily ${where}`).run(ownerGhii, ownerGhii, asAgent);
    const add = db.prepare(`
      INSERT INTO value_daily (day, grain, ownerGhii, orgId, wsId, producer, family, signal, count, bytes)
      VALUES (@day, @grain, @ownerGhii, @orgId, @wsId, @producer, @family, @signal, @count, @bytes)
      ON CONFLICT(day, grain, ownerGhii, orgId, wsId, producer, family, signal) DO UPDATE SET
        count = count + excluded.count, bytes = bytes + excluded.bytes
    `);
    for (const r of moved) add.run({ ...r, producer: marker });
    n += moved.length;
  }
  return n;
}

/** LIKE has its own wildcards; a key holding `%` or `_` must not become a prefix match for more. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, m => `\\${m}`);
}
