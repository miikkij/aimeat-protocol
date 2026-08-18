/**
 * @file repos/memory.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The SQLite memory helpers that do NOT fit as prototype methods: the shared archive-filter
 *   SQL fragment, the DB-side byte/row aggregates behind the quota + stats, and the FTS5 full-text
 *   search path. Every export here is called from methods/owner.ts or methods/owner-memory-scope.ts.
 *
 *   THIS IS NOT A PARALLEL MEMORY IMPLEMENTATION, and the header used to say it was. Until
 *   2026-08-01 the module also carried get/set/list/listAll/delete/search/history copies of the core
 *   memory methods, with a note telling the reader to "keep the two in sync". Nothing imported them —
 *   the live CRUD is methods/owner.ts — and predictably the two did NOT stay in sync: the copies here
 *   never learned `workspaceRef` or `groupId`. A duplicate that nothing calls cannot be kept honest by
 *   a comment, so the copies were deleted rather than repaired. If you need memory CRUD, it lives in
 *   methods/owner.ts; do not reintroduce a second one here.
 * @structure archivedSql · sumMemoryBytes / sumMemoryBytesForOwners / countMemory ·
 *   searchTextMemory (+ its private FTS helpers) · archive/unarchive/countArchivedByKeyPrefix
 * @usage import { searchTextMemory, archivedSql } from './repos/memory.js';
 * @version-history
 *   v2.0.0 — 2026-08-01 — Removed nine dead exports (getMemory, setMemory, listMemory, listAllMemory,
 *     deleteMemory, deleteAllMemory, listMemoryHistory, incrementMemoryFlagCount, searchMemory) and the
 *     two private helpers only they used (annotationOf, appendHistory). No importer existed for any of
 *     them. deserializeMemory + isMemoryExpired STAY — searchTextMemory calls both.
 *   v1.1.0 — 2026-06-22 — Trackable-memory versioning: archive prior versions to memory_history (Osa D1).
 */
import type Database from 'better-sqlite3';
import type { ArchiveFilter, MemoryRecord } from '../../../interface.js';
import type { MemoryTextHit, MemoryTextSearchOpts } from '../../../repositories/memory.repository.js';

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
  if (row.aiProvenanceId) record.aiProvenanceId = row.aiProvenanceId as string;
  return record;
}

function isMemoryExpired(record: MemoryRecord): boolean {
  if (!record.ttlHours) return false;
  const createdMs = new Date(record.createdAt).getTime();
  return Date.now() > createdMs + record.ttlHours * 3_600_000;
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
