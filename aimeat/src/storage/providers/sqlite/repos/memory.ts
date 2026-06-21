import type Database from 'better-sqlite3';
import type { MemoryRecord } from '../../../interface.js';
import type { MemoryTextHit, MemoryTextSearchOpts } from '../../../repositories/memory.repository.js';

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
  return record;
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
  if (existing) {
    record.version = existing.version + 1;
    db.prepare(
      `UPDATE memory SET value = ?, visibility = ?, tags = ?, ttlHours = ?, version = ?,
       createdAt = ?, updatedAt = ?, flagCount = ?, allowedOrigins = ? WHERE ownerGaii = ? AND key = ?`
    ).run(
      JSON.stringify(record.value), record.visibility,
      JSON.stringify(record.tags), record.ttlHours,
      record.version, record.createdAt, record.updatedAt,
      record.flagCount ?? 0,
      record.allowedOrigins ? JSON.stringify(record.allowedOrigins) : null,
      record.ownerGaii, record.key,
    );
  } else {
    db.prepare(
      `INSERT INTO memory (ownerGaii, key, value, visibility, tags, ttlHours, version, createdAt, updatedAt, flagCount, allowedOrigins)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.ownerGaii, record.key,
      JSON.stringify(record.value), record.visibility,
      JSON.stringify(record.tags), record.ttlHours,
      record.version, record.createdAt, record.updatedAt,
      record.flagCount ?? 0,
      record.allowedOrigins ? JSON.stringify(record.allowedOrigins) : null,
    );
  }
  return record;
}

export function countMemory(db: Database.Database, ownerGaiis: string[], opts?: { prefix?: string; visibility?: string }): number {
  if (ownerGaiis.length === 0) return 0;
  const placeholders = ownerGaiis.map(() => '?').join(',');
  let sql = `SELECT COUNT(DISTINCT key) AS c FROM memory WHERE ownerGaii IN (${placeholders})`;
  const params: unknown[] = [...ownerGaiis];
  if (opts?.prefix) { sql += ' AND key LIKE ?'; params.push(opts.prefix + '%'); }
  if (opts?.visibility) { sql += ' AND visibility = ?'; params.push(opts.visibility); }
  // NB: does not subtract not-yet-pruned TTL-expired rows (a stat-display approximation); the
  // value-loading list path prunes those lazily. Negligible for a "N Muistit" counter.
  const row = db.prepare(sql).get(...params) as { c: number };
  return row.c;
}

export function listMemory(db: Database.Database, ownerGaii: string, opts?: { prefix?: string; visibility?: string; tags?: string[]; maxFlags?: number }): MemoryRecord[] {
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

export function listAllMemory(db: Database.Database, opts?: { prefix?: string; ownerPrefix?: string; visibility?: string; limit?: number; offset?: number }): { items: MemoryRecord[]; total: number } {
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

export function searchMemory(db: Database.Database, ownerGaii: string, query: string, opts?: { visibility?: string; maxFlags?: number }): MemoryRecord[] {
  const q = query.toLowerCase();
  let sql = 'SELECT * FROM memory WHERE ownerGaii = ?';
  const params: unknown[] = [ownerGaii];

  if (opts?.visibility) {
    sql += ' AND visibility = ?';
    params.push(opts.visibility);
  }

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
    }
  }
  return results;
}

export function searchTextMemory(db: Database.Database, query: string, opts?: MemoryTextSearchOpts): MemoryTextHit[] {
  const match = toFtsMatch(query);
  if (!match) return [];

  const where: string[] = ['memory_fts MATCH ?'];
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

  // bm25(): lower is more relevant → ORDER BY ASC, fetch extra to survive TTL/flag filtering.
  const limit = opts?.limit ?? 50;
  const sql = `
    SELECT m.*, bm25(memory_fts) AS _rank
    FROM memory_fts
    JOIN memory m ON m.rowid = memory_fts.rowid
    WHERE ${where.join(' AND ')}
    ORDER BY _rank
    LIMIT ?`;
  const rows = db.prepare(sql).all(...params, limit * 2) as Record<string, unknown>[];

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
