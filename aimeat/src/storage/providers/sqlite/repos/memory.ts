import type Database from 'better-sqlite3';
import type { MemoryRecord } from '../../../interface.js';

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
