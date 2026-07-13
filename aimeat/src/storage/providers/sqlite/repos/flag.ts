/**
 * @file src/storage/providers/sqlite/repos/flag.ts
 * @description SQLite (better-sqlite3) repository functions for content-moderation flags and
 *   AI-generated match records — row (de)serialization plus CRUD/query helpers over the `flags` and
 *   `matches` tables.
 *
 * @structure
 *   - deserializeFlag/deserializeMatch: map DB rows to FlagRecord/MatchRecord shapes
 *   - createFlag + flag query/update helpers: persist and manage moderation flags
 *   - match helpers: persist and query match suggestions between profiles
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type Database from 'better-sqlite3';
import type { FlagRecord, FlagSummary, MatchRecord } from '../../../interface.js';

// ── Flag Helpers ──

function deserializeFlag(row: Record<string, unknown>): FlagRecord {
  const record: FlagRecord = {
    id: row.id as string,
    targetType: row.targetType as FlagRecord['targetType'],
    targetId: row.targetId as string,
    flaggedBy: row.flaggedBy as string,
    reason: row.reason as FlagRecord['reason'],
    status: row.status as FlagRecord['status'],
    createdAt: row.createdAt as string,
  };
  if (row.description) record.description = row.description as string;
  if (row.reviewedBy) record.reviewedBy = row.reviewedBy as string;
  if (row.reviewedAt) record.reviewedAt = row.reviewedAt as string;
  return record;
}

// ── Match Helpers ──

function deserializeMatch(row: Record<string, unknown>): MatchRecord {
  return {
    id: row.id as string,
    profileA: row.profileA as string,
    profileB: row.profileB as string,
    score: row.score as number,
    breakdown: JSON.parse(row.breakdown as string),
    status: row.status as MatchRecord['status'],
    notifiedAt: (row.notifiedAt as string) ?? null,
    respondedAt: (row.respondedAt as string) ?? null,
    expiresAt: row.expiresAt as string,
    createdAt: row.createdAt as string,
  };
}

// ── Flags ──

export function createFlag(db: Database.Database, record: FlagRecord): FlagRecord {
  db.prepare(
    `INSERT INTO flags (id, targetType, targetId, flaggedBy, reason, description, status, reviewedBy, reviewedAt, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id, record.targetType, record.targetId, record.flaggedBy,
    record.reason, record.description ?? null, record.status,
    record.reviewedBy ?? null, record.reviewedAt ?? null, record.createdAt,
  );
  return record;
}

export function getFlag(db: Database.Database, id: string): FlagRecord | null {
  const row = db.prepare('SELECT * FROM flags WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? deserializeFlag(row) : null;
}

export function getFlagsByTarget(db: Database.Database, targetType: string, targetId: string): FlagRecord[] {
  const rows = db.prepare('SELECT * FROM flags WHERE targetType = ? AND targetId = ?').all(targetType, targetId) as Record<string, unknown>[];
  return rows.map(r => deserializeFlag(r));
}

export function getFlagByUser(db: Database.Database, targetType: string, targetId: string, flaggedBy: string): FlagRecord | null {
  const row = db.prepare('SELECT * FROM flags WHERE targetType = ? AND targetId = ? AND flaggedBy = ?').get(targetType, targetId, flaggedBy) as Record<string, unknown> | undefined;
  return row ? deserializeFlag(row) : null;
}

export function getFlagSummary(db: Database.Database, targetType: string, targetId: string): FlagSummary | null {
  const rows = db.prepare('SELECT * FROM flags WHERE targetType = ? AND targetId = ?').all(targetType, targetId) as Record<string, unknown>[];
  if (rows.length === 0) return null;

  const byReason: Record<string, number> = {};
  let latestFlag = '';
  for (const r of rows) {
    const reason = r.reason as string;
    byReason[reason] = (byReason[reason] ?? 0) + 1;
    if ((r.createdAt as string) > latestFlag) latestFlag = r.createdAt as string;
  }

  return {
    targetType,
    targetId,
    totalFlags: rows.length,
    byReason,
    latestFlag,
  };
}

export function updateFlag(db: Database.Database, id: string, updates: Partial<FlagRecord>): FlagRecord | null {
  const existing = getFlag(db, id);
  if (!existing) return null;
  const updated = { ...existing, ...updates };
  db.prepare(
    `UPDATE flags SET targetType = ?, targetId = ?, flaggedBy = ?, reason = ?,
     description = ?, status = ?, reviewedBy = ?, reviewedAt = ?, createdAt = ? WHERE id = ?`
  ).run(
    updated.targetType, updated.targetId, updated.flaggedBy, updated.reason,
    updated.description ?? null, updated.status,
    updated.reviewedBy ?? null, updated.reviewedAt ?? null, updated.createdAt, id,
  );
  return updated;
}

export function listFlags(db: Database.Database, opts?: { status?: string; targetType?: string; page?: number; perPage?: number }): FlagRecord[] {
  const page = opts?.page ?? 1;
  const perPage = opts?.perPage ?? 20;
  let sql = 'SELECT * FROM flags WHERE 1=1';
  const params: unknown[] = [];

  if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
  if (opts?.targetType) { sql += ' AND targetType = ?'; params.push(opts.targetType); }

  sql += ' ORDER BY createdAt DESC';
  sql += ' LIMIT ? OFFSET ?';
  params.push(perPage, (page - 1) * perPage);

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(r => deserializeFlag(r));
}

// ── Matches ──

export function createMatch(db: Database.Database, record: MatchRecord): MatchRecord {
  db.prepare(
    `INSERT INTO matches (id, profileA, profileB, score, breakdown, status, notifiedAt, respondedAt, expiresAt, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id, record.profileA, record.profileB, record.score,
    JSON.stringify(record.breakdown), record.status,
    record.notifiedAt, record.respondedAt,
    record.expiresAt, record.createdAt,
  );
  return record;
}

export function getMatch(db: Database.Database, id: string): MatchRecord | null {
  const row = db.prepare('SELECT * FROM matches WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? deserializeMatch(row) : null;
}

export function getMatchByPair(db: Database.Database, profileA: string, profileB: string): MatchRecord | null {
  const row = db.prepare(
    'SELECT * FROM matches WHERE (profileA = ? AND profileB = ?) OR (profileA = ? AND profileB = ?)'
  ).get(profileA, profileB, profileB, profileA) as Record<string, unknown> | undefined;
  return row ? deserializeMatch(row) : null;
}

export function listMatchesByProfile(db: Database.Database, profile: string, opts?: { status?: string; page?: number; perPage?: number }): MatchRecord[] {
  const page = opts?.page ?? 1;
  const perPage = opts?.perPage ?? 10;
  let sql = 'SELECT * FROM matches WHERE (profileA = ? OR profileB = ?)';
  const params: unknown[] = [profile, profile];

  if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }

  sql += ' ORDER BY createdAt DESC LIMIT ? OFFSET ?';
  params.push(perPage, (page - 1) * perPage);

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(r => deserializeMatch(r));
}

export function updateMatch(db: Database.Database, id: string, updates: Partial<MatchRecord>): MatchRecord | null {
  const existing = getMatch(db, id);
  if (!existing) return null;
  const updated = { ...existing, ...updates };
  db.prepare(
    `UPDATE matches SET profileA = ?, profileB = ?, score = ?, breakdown = ?,
     status = ?, notifiedAt = ?, respondedAt = ?, expiresAt = ?, createdAt = ? WHERE id = ?`
  ).run(
    updated.profileA, updated.profileB, updated.score,
    JSON.stringify(updated.breakdown), updated.status,
    updated.notifiedAt, updated.respondedAt,
    updated.expiresAt, updated.createdAt, id,
  );
  return updated;
}

export function deleteExpiredMatches(db: Database.Database): number {
  const now = new Date().toISOString();
  const result = db.prepare(
    `DELETE FROM matches WHERE expiresAt < ? AND status != 'accepted'`
  ).run(now);
  return result.changes;
}

export function listAllMatches(db: Database.Database, limit = 10000): MatchRecord[] {
  const rows = db.prepare('SELECT * FROM matches ORDER BY createdAt DESC LIMIT ?').all(Math.min(limit, 10000)) as Record<string, unknown>[];
  return rows.map(r => deserializeMatch(r));
}
