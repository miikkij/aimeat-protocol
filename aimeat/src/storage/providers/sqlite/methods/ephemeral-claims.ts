/**
 * @file src/storage/providers/sqlite/methods/ephemeral-claims.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description EphemeralClaimRepository on SQLite (table ephemeral_claim, schema-ephemeral-claim.ts).
 *   Every write is one statement, so a take, a spend and a counter change are atomic as they are on
 *   PostgreSQL. Times are epoch milliseconds from the caller (repository contract).
 * @structure ephemeralClaimMethods
 * @usage Object.assign(SqliteStorage.prototype, ephemeralClaimMethods) in ../index.ts
 * @version-history
 *   2026-11-08 — releaseEphemeralCounter (secaudit2026nov08 round 14).
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, high-availability stage 2).
 */
import type { SqliteStorage } from '../index.js';
import type { EphemeralClaimRow, EphemeralCount } from '../../../repositories/ephemeral-claim.repository.js';

export const ephemeralClaimMethods = {
  async putEphemeralClaim(this: SqliteStorage, kind: string, id: string, payload: string, expiresAt: number): Promise<void> {
    this.db.prepare(
      `INSERT INTO ephemeral_claim (kind, id, payload, count, expiresAt) VALUES (?, ?, ?, 0, ?)
       ON CONFLICT(kind, id) DO UPDATE SET payload = excluded.payload, count = 0, expiresAt = excluded.expiresAt`,
    ).run(kind, id, payload, expiresAt);
  },

  async getEphemeralClaim(this: SqliteStorage, kind: string, id: string): Promise<EphemeralClaimRow | null> {
    const row = this.db.prepare('SELECT payload, expiresAt FROM ephemeral_claim WHERE kind = ? AND id = ?')
      .get(kind, id) as { payload: string; expiresAt: number } | undefined;
    return row ? { payload: row.payload, expiresAt: Number(row.expiresAt) } : null;
  },

  async takeEphemeralClaim(this: SqliteStorage, kind: string, id: string): Promise<EphemeralClaimRow | null> {
    const row = this.db.prepare('DELETE FROM ephemeral_claim WHERE kind = ? AND id = ? RETURNING payload, expiresAt')
      .get(kind, id) as { payload: string; expiresAt: number } | undefined;
    return row ? { payload: row.payload, expiresAt: Number(row.expiresAt) } : null;
  },

  async deleteEphemeralClaim(this: SqliteStorage, kind: string, id: string): Promise<boolean> {
    return this.db.prepare('DELETE FROM ephemeral_claim WHERE kind = ? AND id = ?').run(kind, id).changes > 0;
  },

  async spendEphemeralClaim(this: SqliteStorage, kind: string, id: string, expiresAt: number, now: number): Promise<boolean> {
    const row = this.db.prepare(
      `INSERT INTO ephemeral_claim (kind, id, payload, count, expiresAt) VALUES (?, ?, '', 0, ?)
       ON CONFLICT(kind, id) DO UPDATE SET payload = '', count = 0, expiresAt = excluded.expiresAt
         WHERE ephemeral_claim.expiresAt <= ?
       RETURNING id`,
    ).get(kind, id, expiresAt, now);
    return row !== undefined;
  },

  async countEphemeralClaims(this: SqliteStorage, kind: string, now: number): Promise<number> {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM ephemeral_claim WHERE kind = ? AND expiresAt > ?')
      .get(kind, now) as { n: number };
    return Number(row.n);
  },

  async bumpEphemeralCounter(this: SqliteStorage, kind: string, id: string, opts: {
    now: number; windowMs: number; staleBefore: number; sliding: boolean;
  }): Promise<EphemeralCount> {
    const end = opts.now + opts.windowMs;
    // Every expression in SET reads the row as it was before this statement.
    const row = this.db.prepare(
      `INSERT INTO ephemeral_claim (kind, id, payload, count, expiresAt) VALUES (?, ?, '', 1, ?)
       ON CONFLICT(kind, id) DO UPDATE SET
         count = CASE WHEN ephemeral_claim.expiresAt < ? THEN 1 ELSE ephemeral_claim.count + 1 END,
         expiresAt = CASE WHEN ephemeral_claim.expiresAt < ? OR ? = 1 THEN ? ELSE ephemeral_claim.expiresAt END
       RETURNING count, expiresAt`,
    ).get(kind, id, end, opts.staleBefore, opts.staleBefore, opts.sliding ? 1 : 0, end) as { count: number; expiresAt: number };
    return { count: Number(row.count), expiresAt: Number(row.expiresAt) };
  },

  async releaseEphemeralCounter(this: SqliteStorage, kind: string, id: string, now: number): Promise<void> {
    this.db.prepare('UPDATE ephemeral_claim SET count = count - 1 WHERE kind = ? AND id = ? AND count > 0 AND expiresAt > ?')
      .run(kind, id, now);
  },

  async readEphemeralCounter(this: SqliteStorage, kind: string, id: string): Promise<EphemeralCount | null> {
    const row = this.db.prepare('SELECT count, expiresAt FROM ephemeral_claim WHERE kind = ? AND id = ?')
      .get(kind, id) as { count: number; expiresAt: number } | undefined;
    return row ? { count: Number(row.count), expiresAt: Number(row.expiresAt) } : null;
  },

  async sweepEphemeralClaims(this: SqliteStorage, now: number): Promise<number> {
    return this.db.prepare('DELETE FROM ephemeral_claim WHERE expiresAt < ?').run(now).changes;
  },
};
