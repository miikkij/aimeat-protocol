/**
 * @file repos/memory.ts
 * @description SQLite (better-sqlite3) memory repository helpers: get/set/list/search memory rows and
 *   the FTS5 full-text path. Includes the trackable-memory versioning: when a key marked `trackable`
 *   is overwritten, its previous value is archived to the `memory_history` table (append-only) before
 *   the update, and listMemoryHistory() reads it back newest-first. NOTE: SqliteStorage (../index.ts)
 *   carries its own inline copies of the core memory methods; this module is the parallel repo layer —
 *   keep the two in sync when changing memory behaviour.
 * @structure getMemory/setMemory/listMemory/listAllMemory/deleteMemory/searchMemory/searchTextMemory/listMemoryHistory
 * @usage import { setMemory, listMemoryHistory } from './repos/memory.js';
 * @version-history
 *   v1.1.0 — 2026-06-22 — Trackable-memory versioning: archive prior versions to memory_history (Osa D1).
 */
import type Database from 'better-sqlite3';
import type { ArchiveFilter, MemoryRecord } from '../../../interface.js';
import type { MemoryTextHit, MemoryTextSearchOpts, MemoryVersionRecord } from '../../../repositories/memory.repository.js';

/** SQL fragment (with leading ` AND`) restricting the `memory.archived` column by filter. Default
 *  `exclude` → active rows only. Shared by every bulk read so archived content stays out of the
 *  working set unless a caller explicitly asks for `include`/`only`. */
export function archivedSql(archived?: ArchiveFilter): string {
  if (archived === 'include') return '';
  if (archived === 'only') return ' AND archived = 1';
  return ' AND archived = 0';
}

/**
 * Turn a free-text query into an FTS5 MATCH expression: extract unicode word/number tokens,
 * prefix-match each (`tok*`) and OR them together for recall (bm25 still ranks multi-token hits
 * highest). Tokens are pure alphanumerics so no FTS5 escaping is needed. Returns null when the
 * query has no usable tokens (caller returns no hits).
 */
function toFtsMatch(raw: string): string | null {
  const tokens = raw.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (!tokens || tokens.length === 0) return null;
  return tokens.map(t => `${t}*`).join(' OR ');
}

function deserializeMemory(row: Record<string, unknown>): MemoryRecord {
  const record: MemoryRecord = {
    key: row.key as string,
    ownerGaii: row.ownerGaii as string,
    value: JSON.parse(row.value as string),
    visibility: row.visibility as MemoryRecord['visibility'],
    tags: JSON.parse(row.tags as string) as string[],
    ttlHours: row.ttlHours as number | null,
    version: row.version as number,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
  if (row.flagCount !== null && row.flagCount !== undefined) {
    record.flagCount = row.flagCount as number;
  }
  if (row.allowedOrigins) record.allowedOrigins = JSON.parse(row.allowedOrigins as string);
  if (row.trackable) record.trackable = true;
  if (row.archived) record.archived = true;
  if (row.archivedAt) record.archivedAt = row.archivedAt as string;
  if (row.archivedBy) record.archivedBy = row.archivedBy as string;
  if (row.archivedRoot) record.archivedRoot = row.archivedRoot as string;
  return record;
}

/** Read an optional `_actor` / `_event` annotation off a record value (the convention the structure
 *  timeline uses to attribute a version) — best-effort, so archived history rows carry who/why. */
function annotationOf(value: unknown, field: '_actor' | '_event'): string | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const v = (value as Record<string, unknown>)[field];
    if (typeof v === 'string' && v) return v;
  }
  return null;
}

/** Archive the PREVIOUS version of a trackable key before it is overwritten. Append-only; INSERT OR
 *  IGNORE guards against re-archiving the same (owner,key,version). */
function appendHistory(db: Database.Database, prev: MemoryRecord): void {
  db.prepare(
    `INSERT OR IGNORE INTO memory_history (ownerGaii, key, version, value, actor, event, recordedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    prev.ownerGaii, prev.key, prev.version,
    JSON.stringify(prev.value),
    annotationOf(prev.value, '_actor'), annotationOf(prev.value, '_event'),
    prev.updatedAt,
  );
}

function isMemoryExpired(record: MemoryRecord): boolean {
  if (!record.ttlHours) return false;
  const createdMs = new Date(record.createdAt).getTime();
  return Date.now() > createdMs + record.ttlHours * 3_600_000;
}

export function getMemory(db: Database.Database, ownerGaii: string, key: string): MemoryRecord | null {
  const row = db.prepare('SELECT * FROM memory WHERE ownerGaii = ? AND key = ?').get(ownerGaii, key) as Record<string, unknown> | undefined;
  if (!row) return null;
  const record = deserializeMemory(row);
  if (isMemoryExpired(record)) {
    db.prepare('DELETE FROM memory WHERE ownerGaii = ? AND key = ?').run(ownerGaii, key);
    return null;
  }
  return record;
}

export function setMemory(db: Database.Database, record: MemoryRecord): MemoryRecord {
  const existing = getMemory(db, record.ownerGaii, record.key);
  // Trackable is a property of the key: inherit the existing setting if the writer didn't specify, so
  // a generic rewrite never silently turns tracking off. Archiving is gated on the EXISTING (previous)
  // record being trackable — that's the version we keep.
  const trackable = record.trackable ?? existing?.trackable ?? false;
  record.trackable = trackable || undefined;
  const valueStr = JSON.stringify(record.value);
  const byteSize = Buffer.byteLength(valueStr, 'utf8');   // cached for the O(1) total-size quota sum
  if (existing) {
    if (existing.trackable) appendHistory(db, existing);   // keep the previous version before overwrite
    record.version = existing.version + 1;
    db.prepare(
      `UPDATE memory SET value = ?, visibility = ?, tags = ?, ttlHours = ?, version = ?,
       createdAt = ?, updatedAt = ?, flagCount = ?, allowedOrigins = ?, trackable = ?, byteSize = ? WHERE ownerGaii = ? AND key = ?`
    ).run(
      valueStr, record.visibility,
      JSON.stringify(record.tags), record.ttlHours,
      record.version, record.createdAt, record.updatedAt,
      record.flagCount ?? 0,
      record.allowedOrigins ? JSON.stringify(record.allowedOrigins) : null,
      trackable ? 1 : 0, byteSize,
      record.ownerGaii, record.key,
    );
  } else {
    db.prepare(
      `INSERT INTO memory (ownerGaii, key, value, visibility, tags, ttlHours, version, createdAt, updatedAt, flagCount, allowedOrigins, trackable, byteSize)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.ownerGaii, record.key,
      valueStr, record.visibility,
      JSON.stringify(record.tags), record.ttlHours,
      record.version, record.createdAt, record.updatedAt,
      record.flagCount ?? 0,
      record.allowedOrigins ? JSON.stringify(record.allowedOrigins) : null,
      trackable ? 1 : 0, byteSize,
    );
  }
  return record;
}

/** Sum the byte size of one owner's memory values, computed entirely in SQLite (no rows/values
 *  transferred to JS). Backs the memory total-size quota — replaces a load-all + re-serialise. */
export function sumMemoryBytes(db: Database.Database, ownerGaii: string): number {
  const row = db.prepare('SELECT COALESCE(SUM(byteSize), 0) AS s FROM memory WHERE ownerGaii = ?').get(ownerGaii) as { s: number };
  return row.s;
}

/** Sum value bytes across MANY owner identities in one SQL SUM — the owner-scope total-usage figure
 *  (replaces one sumMemoryBytes call per identity). */
export function sumMemoryBytesForOwners(db: Database.Database, ownerGaiis: string[]): number {
  if (ownerGaiis.length === 0) return 0;
  const placeholders = ownerGaiis.map(() => '?').join(',');
  const row = db.prepare(`SELECT COALESCE(SUM(byteSize), 0) AS s FROM memory WHERE ownerGaii IN (${placeholders})`).get(...ownerGaiis) as { s: number };
  return row.s;
}

/** Archived prior versions of a trackable key, newest version first. Empty for non-trackable keys. */
export function listMemoryHistory(db: Database.Database, ownerGaii: string, key: string, opts?: { limit?: number }): MemoryVersionRecord[] {
  const limit = opts?.limit ?? 200;
  const rows = db.prepare(
    'SELECT * FROM memory_history WHERE ownerGaii = ? AND key = ? ORDER BY version DESC LIMIT ?'
  ).all(ownerGaii, key, limit) as Record<string, unknown>[];
  return rows.map(r => ({
    ownerGaii: r.ownerGaii as string,
    key: r.key as string,
    version: r.version as number,
    value: JSON.parse(r.value as string),
    actor: (r.actor as string | null) ?? null,
    event: (r.event as string | null) ?? null,
    recordedAt: r.recordedAt as string,
  }));
}

export function countMemory(db: Database.Database, ownerGaiis: string[], opts?: { prefix?: string; visibility?: string; archived?: ArchiveFilter }): number {
  if (ownerGaiis.length === 0) return 0;
  const placeholders = ownerGaiis.map(() => '?').join(',');
  let sql = `SELECT COUNT(DISTINCT key) AS c FROM memory WHERE ownerGaii IN (${placeholders})`;
  const params: unknown[] = [...ownerGaiis];
  if (opts?.prefix) { sql += ' AND key LIKE ?'; params.push(opts.prefix + '%'); }
  if (opts?.visibility) { sql += ' AND visibility = ?'; params.push(opts.visibility); }
  sql += archivedSql(opts?.archived);
  // NB: does not subtract not-yet-pruned TTL-expired rows (a stat-display approximation); the
  // value-loading list path prunes those lazily. Negligible for a "N Muistit" counter.
  const row = db.prepare(sql).get(...params) as { c: number };
  return row.c;
}

export function listMemory(db: Database.Database, ownerGaii: string, opts?: { prefix?: string; visibility?: string; tags?: string[]; maxFlags?: number; archived?: ArchiveFilter }): MemoryRecord[] {
  let sql = 'SELECT * FROM memory WHERE ownerGaii = ?';
  const params: unknown[] = [ownerGaii];

  if (opts?.prefix) {
    sql += ' AND key LIKE ?';
    params.push(opts.prefix + '%');
  }
  if (opts?.visibility) {
    sql += ' AND visibility = ?';
    params.push(opts.visibility);
  }
  sql += archivedSql(opts?.archived);

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  const results: MemoryRecord[] = [];
  for (const row of rows) {
    const record = deserializeMemory(row);
    if (isMemoryExpired(record)) {
      db.prepare('DELETE FROM memory WHERE ownerGaii = ? AND key = ?').run(record.ownerGaii, record.key);
      continue;
    }
    if (opts?.tags?.length) {
      const hasTags = opts.tags.every(t => record.tags.includes(t));
      if (!hasTags) continue;
    }
    if (opts?.maxFlags !== undefined && (record.flagCount ?? 0) > opts.maxFlags) continue;
    results.push(record);
  }
  return results;
}

export function listAllMemory(db: Database.Database, opts?: { prefix?: string; ownerPrefix?: string; visibility?: string; limit?: number; offset?: number; archived?: ArchiveFilter; excludeVersionRows?: boolean }): { items: MemoryRecord[]; total: number } {
  let whereClauses = '';
  const params: unknown[] = [];

  if (opts?.ownerPrefix) {
    whereClauses += ' AND ownerGaii LIKE ?';
    params.push(opts.ownerPrefix + '%');
  }
  if (opts?.prefix) {
    whereClauses += ' AND key LIKE ?';
    params.push(opts.prefix + '%');
  }
  if (opts?.visibility) {
    whereClauses += ' AND visibility = ?';
    params.push(opts.visibility);
  }
  // Drop `.version.N` workspace history rows in SQL (hot read paths always discard them).
  if (opts?.excludeVersionRows) {
    whereClauses += " AND key NOT LIKE '%.version.%'";
  }
  whereClauses += archivedSql(opts?.archived);

  const whereStr = whereClauses ? ' WHERE ' + whereClauses.slice(5) : '';

  // Count total
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM memory' + whereStr).get(...params) as { cnt: number };
  const total = countRow.cnt;

  // Fetch page
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  const rows = db.prepare('SELECT * FROM memory' + whereStr + ' ORDER BY updatedAt DESC LIMIT ? OFFSET ?').all(...params, limit, offset) as Record<string, unknown>[];

  const items: MemoryRecord[] = [];
  for (const row of rows) {
    const record = deserializeMemory(row);
    if (isMemoryExpired(record)) {
      db.prepare('DELETE FROM memory WHERE ownerGaii = ? AND key = ?').run(record.ownerGaii, record.key);
      continue;
    }
    items.push(record);
  }
  return { items, total };
}

export function deleteMemory(db: Database.Database, ownerGaii: string, key: string): boolean {
  const result = db.prepare('DELETE FROM memory WHERE ownerGaii = ? AND key = ?').run(ownerGaii, key);
  return result.changes > 0;
}

export function deleteAllMemory(db: Database.Database, ownerGaii: string): number {
  const result = db.prepare('DELETE FROM memory WHERE ownerGaii = ?').run(ownerGaii);
  return result.changes;
}

export function incrementMemoryFlagCount(db: Database.Database, ownerGaii: string, key: string): void {
  db.prepare(
    'UPDATE memory SET flagCount = COALESCE(flagCount, 0) + 1 WHERE ownerGaii = ? AND key = ?'
  ).run(ownerGaii, key);
}

export function searchMemory(db: Database.Database, ownerGaii: string, query: string, opts?: { visibility?: string; maxFlags?: number; prefix?: string; archived?: ArchiveFilter; limit?: number }): MemoryRecord[] {
  const q = query.toLowerCase();
  let sql = 'SELECT * FROM memory WHERE ownerGaii = ?';
  const params: unknown[] = [ownerGaii];

  if (opts?.visibility) {
    sql += ' AND visibility = ?';
    params.push(opts.visibility);
  }

  if (opts?.prefix) {
    sql += ' AND key LIKE ?';
    params.push(opts.prefix + '%');
  }
  sql += archivedSql(opts?.archived);

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  const results: MemoryRecord[] = [];
  for (const row of rows) {
    const record = deserializeMemory(row);
    if (isMemoryExpired(record)) {
      db.prepare('DELETE FROM memory WHERE ownerGaii = ? AND key = ?').run(record.ownerGaii, record.key);
      continue;
    }
    if (opts?.maxFlags !== undefined && (record.flagCount ?? 0) > opts.maxFlags) continue;
    const valStr = typeof record.value === 'string' ? record.value : JSON.stringify(record.value);
    if (
      record.key.toLowerCase().includes(q) ||
      valStr.toLowerCase().includes(q) ||
      record.tags.some(t => t.toLowerCase().includes(q))
    ) {
      results.push(record);
      if (opts?.limit !== undefined && results.length >= opts.limit) break;   // additive result cap (post-filter)
    }
  }
  return results;
}

/** One FTS branch: search a single `*_fts` table joined back to memory. Default `exclude` runs over
 *  `memory_fts` (active rows only); `only` over `memory_archive_fts`. Returns raw rows + bm25 rank. */
function searchOneFts(db: Database.Database, ftsTable: string, match: string, opts?: MemoryTextSearchOpts): Record<string, unknown>[] {
  const where: string[] = [`${ftsTable} MATCH ?`];
  const params: unknown[] = [match];

  if (opts?.ownerGaiis?.length) {
    where.push(`m.ownerGaii IN (${opts.ownerGaiis.map(() => '?').join(', ')})`);
    params.push(...opts.ownerGaiis);
  }
  if (opts?.keyPrefix) {
    where.push('m.key LIKE ?');
    params.push(opts.keyPrefix + '%');
  }
  if (opts?.visibility) {
    where.push('m.visibility = ?');
    params.push(opts.visibility);
  }

  const limit = opts?.limit ?? 50;
  // bm25(): lower is more relevant → ORDER BY ASC, fetch extra to survive TTL/flag filtering.
  const sql = `
    SELECT m.*, bm25(${ftsTable}) AS _rank
    FROM ${ftsTable}
    JOIN memory m ON m.rowid = ${ftsTable}.rowid
    WHERE ${where.join(' AND ')}
    ORDER BY _rank
    LIMIT ?`;
  return db.prepare(sql).all(...params, limit * 2) as Record<string, unknown>[];
}

export function searchTextMemory(db: Database.Database, query: string, opts?: MemoryTextSearchOpts): MemoryTextHit[] {
  const match = toFtsMatch(query);
  if (!match) return [];

  // Route by archive filter. `exclude` (default) → live index only (archived content never scanned);
  // `only` → archive index; `include` → both, merged best-first by bm25 rank.
  const archived = opts?.archived;
  let rows: Record<string, unknown>[];
  if (archived === 'only') {
    rows = searchOneFts(db, 'memory_archive_fts', match, opts);
  } else if (archived === 'include') {
    rows = [...searchOneFts(db, 'memory_fts', match, opts), ...searchOneFts(db, 'memory_archive_fts', match, opts)]
      .sort((a, b) => (a._rank as number) - (b._rank as number));
  } else {
    rows = searchOneFts(db, 'memory_fts', match, opts);
  }

  const limit = opts?.limit ?? 50;
  const hits: MemoryTextHit[] = [];
  for (const row of rows) {
    if (hits.length >= limit) break;
    const record = deserializeMemory(row);
    if (isMemoryExpired(record)) {
      db.prepare('DELETE FROM memory WHERE ownerGaii = ? AND key = ?').run(record.ownerGaii, record.key);
      continue;
    }
    if (opts?.maxFlags !== undefined && (record.flagCount ?? 0) > opts.maxFlags) continue;
    hits.push({ record, score: -(row._rank as number) });
  }
  return hits;
}

/** ARCHIVE — flag active rows under a key as archived. `match`: `exact` one key; `prefix` everything
 *  under `key%` (containers, whose prefix ends in `.`); `subtree` an instance (`key` itself + its
 *  `key.*` children — bare/.draft/.latest/.version.N — without matching a sibling `keyX`). */
export function archiveMemoryByKey(db: Database.Database, keyOrPrefix: string, opts: { archivedRoot: string; archivedBy: string; archivedAt: string; match?: 'exact' | 'prefix' | 'subtree' }): number {
  const match = opts.match ?? 'prefix';
  let keyClause: string;
  const keyParams: unknown[] = [];
  if (match === 'exact') { keyClause = 'key = ?'; keyParams.push(keyOrPrefix); }
  else if (match === 'subtree') { keyClause = '(key = ? OR key LIKE ?)'; keyParams.push(keyOrPrefix, keyOrPrefix + '.%'); }
  else { keyClause = 'key LIKE ?'; keyParams.push(keyOrPrefix + '%'); }
  const res = db.prepare(
    `UPDATE memory SET archived = 1, archivedAt = ?, archivedBy = ?, archivedRoot = ?
     WHERE ${keyClause} AND archived = 0`
  ).run(opts.archivedAt, opts.archivedBy, opts.archivedRoot, ...keyParams);
  return res.changes;
}

/** UNARCHIVE — clear the archive flag on every row whose archivedRoot matches (smart restore). */
export function unarchiveMemoryByRoot(db: Database.Database, archivedRoot: string): number {
  const res = db.prepare(
    `UPDATE memory SET archived = 0, archivedAt = NULL, archivedBy = NULL, archivedRoot = NULL
     WHERE archived = 1 AND archivedRoot = ?`
  ).run(archivedRoot);
  return res.changes;
}

/** UNARCHIVE BY KEY — clear archive on every archived row under a key (root-independent). See repository. */
export function unarchiveMemoryByKey(db: Database.Database, keyOrPrefix: string, opts?: { match?: 'exact' | 'prefix' | 'subtree' }): number {
  const match = opts?.match ?? 'subtree';
  let keyClause: string;
  const keyParams: unknown[] = [];
  if (match === 'exact') { keyClause = 'key = ?'; keyParams.push(keyOrPrefix); }
  else if (match === 'subtree') { keyClause = '(key = ? OR key LIKE ?)'; keyParams.push(keyOrPrefix, keyOrPrefix + '.%'); }
  else { keyClause = 'key LIKE ?'; keyParams.push(keyOrPrefix + '%'); }
  const res = db.prepare(
    `UPDATE memory SET archived = 0, archivedAt = NULL, archivedBy = NULL, archivedRoot = NULL
     WHERE archived = 1 AND ${keyClause}`
  ).run(...keyParams);
  return res.changes;
}

/** Count active vs archived memory rows under a key prefix. */
export function countArchivedByKeyPrefix(db: Database.Database, keyPrefix: string): { active: number; archived: number } {
  const row = db.prepare(
    `SELECT
       SUM(CASE WHEN archived = 0 THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN archived = 1 THEN 1 ELSE 0 END) AS archived
     FROM memory WHERE key LIKE ?`
  ).get(keyPrefix + '%') as { active: number | null; archived: number | null };
  return { active: row.active ?? 0, archived: row.archived ?? 0 };
}
