/**
 * @file src/storage/providers/sqlite/repos/flag.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite (better-sqlite3) repository functions for content-moderation flags: row
 *   (de)serialization plus CRUD/query helpers over the `flags` table.
 *
 * @structure
 *   - deserializeFlag: map DB rows to the FlagRecord shape
 *   - createFlag + flag query/update helpers: persist and manage moderation flags
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type Database from 'better-sqlite3';
import type { FlagRecord, FlagSummary } from '../../../interface.js';

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
