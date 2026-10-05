/**
 * @file src/storage/providers/sqlite/methods/moderation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/moderation.ts (moderationMethods), so
 *   a fix in one provider finds its twin by file name. Bodies moved verbatim from the files named in the
 *   version history; bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure moderationMethods
 * @usage Object.assign(SqliteStorage.prototype, moderationMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — createFlag, getFlag, getFlagsByTarget, getFlagByUser, getFlagSummary, updateFlag,
 *     listFlags, deserializeFlag moved here from governance.ts; createAppeal, getAppeal, getAppealByFlagId,
 *     listAppeals, updateAppeal, deserializeAppeal moved here from community.ts so the file mirrors
 *     postgres-kysely/methods/moderation.ts (secaudit 2026-10, M8).
 */
import type { FlagRecord, FlagSummary, AppealRecord } from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

export const moderationMethods = {

  // ══════════════════════════════════════════════════════════
  // ── Flags (Moderation) ──
  // ══════════════════════════════════════════════════════════

  async createFlag(this: SqliteStorage, record: FlagRecord): Promise<FlagRecord> {
    this.db.prepare(
      `INSERT INTO flags (id, targetType, targetId, flaggedBy, reason, description, status, reviewedBy, reviewedAt, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.targetType, record.targetId, record.flaggedBy,
      record.reason, record.description ?? null, record.status,
      record.reviewedBy ?? null, record.reviewedAt ?? null, record.createdAt,
    );
    return record;
  },

  async getFlag(this: SqliteStorage, id: string): Promise<FlagRecord | null> {
    const row = this.db.prepare('SELECT * FROM flags WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeFlag(row) : null;
  },

  async getFlagsByTarget(this: SqliteStorage, targetType: string, targetId: string): Promise<FlagRecord[]> {
    const rows = this.db.prepare('SELECT * FROM flags WHERE targetType = ? AND targetId = ?').all(targetType, targetId) as Record<string, unknown>[];
    return rows.map(r => this.deserializeFlag(r));
  },

  async getFlagByUser(this: SqliteStorage, targetType: string, targetId: string, flaggedBy: string): Promise<FlagRecord | null> {
    const row = this.db.prepare('SELECT * FROM flags WHERE targetType = ? AND targetId = ? AND flaggedBy = ?').get(targetType, targetId, flaggedBy) as Record<string, unknown> | undefined;
    return row ? this.deserializeFlag(row) : null;
  },

  async getFlagSummary(this: SqliteStorage, targetType: string, targetId: string): Promise<FlagSummary | null> {
    const rows = this.db.prepare('SELECT * FROM flags WHERE targetType = ? AND targetId = ?').all(targetType, targetId) as Record<string, unknown>[];
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
  },

  async updateFlag(this: SqliteStorage, id: string, updates: Partial<FlagRecord>): Promise<FlagRecord | null> {
    const existing = await this.getFlag(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE flags SET targetType = ?, targetId = ?, flaggedBy = ?, reason = ?,
       description = ?, status = ?, reviewedBy = ?, reviewedAt = ?, createdAt = ? WHERE id = ?`
    ).run(
      updated.targetType, updated.targetId, updated.flaggedBy, updated.reason,
      updated.description ?? null, updated.status,
      updated.reviewedBy ?? null, updated.reviewedAt ?? null, updated.createdAt, id,
    );
    return updated;
  },

  async listFlags(this: SqliteStorage, opts?: { status?: string; targetType?: string; page?: number; perPage?: number }): Promise<FlagRecord[]> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 20;
    let sql = 'SELECT * FROM flags WHERE 1=1';
    const params: unknown[] = [];

    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
    if (opts?.targetType) { sql += ' AND targetType = ?'; params.push(opts.targetType); }

    sql += ' ORDER BY createdAt DESC';
    sql += ' LIMIT ? OFFSET ?';
    params.push(perPage, (page - 1) * perPage);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeFlag(r));
  },

  deserializeFlag(this: SqliteStorage, row: Record<string, unknown>): FlagRecord {
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
  },

  // ══════════════════════════════════════════════════════════
  // ── Appeals ──
  // ══════════════════════════════════════════════════════════

  async createAppeal(this: SqliteStorage, record: AppealRecord): Promise<AppealRecord> {
    this.db.prepare(
      `INSERT INTO appeals (id, flagId, appealedBy, reason, status, reviewedBy, reviewNote, createdAt, reviewedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.flagId, record.appealedBy, record.reason,
      record.status, record.reviewedBy ?? null,
      record.reviewNote ?? null, record.createdAt, record.reviewedAt ?? null,
    );
    return record;
  },

  async getAppeal(this: SqliteStorage, id: string): Promise<AppealRecord | null> {
    const row = this.db.prepare('SELECT * FROM appeals WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeAppeal(row) : null;
  },

  async getAppealByFlagId(this: SqliteStorage, flagId: string): Promise<AppealRecord | null> {
    const row = this.db.prepare('SELECT * FROM appeals WHERE flagId = ?').get(flagId) as Record<string, unknown> | undefined;
    return row ? this.deserializeAppeal(row) : null;
  },

  async listAppeals(this: SqliteStorage, opts?: { status?: string; page?: number; perPage?: number }): Promise<AppealRecord[]> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 20;
    let sql = 'SELECT * FROM appeals WHERE 1=1';
    const params: unknown[] = [];

    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }

    sql += ' ORDER BY createdAt DESC LIMIT ? OFFSET ?';
    params.push(perPage, (page - 1) * perPage);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeAppeal(r));
  },

  async updateAppeal(this: SqliteStorage, id: string, updates: Partial<AppealRecord>): Promise<AppealRecord | null> {
    const existing = await this.getAppeal(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, id: existing.id };
    this.db.prepare(
      `UPDATE appeals SET flagId = ?, appealedBy = ?, reason = ?, status = ?,
       reviewedBy = ?, reviewNote = ?, createdAt = ?, reviewedAt = ? WHERE id = ?`
    ).run(
      updated.flagId, updated.appealedBy, updated.reason, updated.status,
      updated.reviewedBy ?? null, updated.reviewNote ?? null,
      updated.createdAt, updated.reviewedAt ?? null, id,
    );
    return updated;
  },

  deserializeAppeal(this: SqliteStorage, row: Record<string, unknown>): AppealRecord {
    const record: AppealRecord = {
      id: row.id as string,
      flagId: row.flagId as string,
      appealedBy: row.appealedBy as string,
      reason: row.reason as string,
      status: row.status as AppealRecord['status'],
      createdAt: row.createdAt as string,
    };
    if (row.reviewedBy) record.reviewedBy = row.reviewedBy as string;
    if (row.reviewNote) record.reviewNote = row.reviewNote as string;
    if (row.reviewedAt) record.reviewedAt = row.reviewedAt as string;
    return record;
  },
};
