/**
 * @file src/storage/providers/sqlite/methods/otk.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/otk.ts (otkMethods), so a fix in one
 *   provider finds its twin by file name. Bodies moved verbatim from the files named in the version history;
 *   bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure otkMethods
 * @usage Object.assign(SqliteStorage.prototype, otkMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — createOtk, getOtk, consumeOtk, deserializeOtk moved here from work.ts so the file
 *     mirrors postgres-kysely/methods/otk.ts (secaudit 2026-10, M8).
 */
import type { OtkRecord } from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

export const otkMethods = {

  // ══════════════════════════════════════════════════════════
  // ── OTK (One-Time Keys) ──
  // ══════════════════════════════════════════════════════════

  async createOtk(this: SqliteStorage, otk: OtkRecord): Promise<OtkRecord> {
    this.db.prepare(
      `INSERT INTO otks (key, ownerGaii, action, params, expiresAt, initial, used, usedAt, sessionId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      otk.key, otk.ownerGaii, otk.action,
      JSON.stringify(otk.params), otk.expiresAt,
      otk.initial ? 1 : 0, otk.used ? 1 : 0,
      otk.usedAt, otk.sessionId, otk.createdAt,
    );
    return otk;
  },

  async getOtk(this: SqliteStorage, key: string): Promise<OtkRecord | null> {
    const row = this.db.prepare('SELECT * FROM otks WHERE key = ?').get(key) as Record<string, unknown> | undefined;
    return row ? this.deserializeOtk(row) : null;
  },

  async consumeOtk(this: SqliteStorage, key: string, graceMs: number = 60_000): Promise<OtkRecord | null> {
    const otk = await this.getOtk(key);
    if (!otk) return null;

    // Initial OTK: timer hasn't started yet -- activate on first use
    if (otk.initial && !otk.used) {
      otk.used = true;
      otk.usedAt = new Date().toISOString();
      otk.expiresAt = new Date(Date.now() + graceMs).toISOString();
      this.db.prepare('UPDATE otks SET used = 1, usedAt = ?, expiresAt = ? WHERE key = ?').run(otk.usedAt, otk.expiresAt, key);
      return otk;
    }

    if (new Date(otk.expiresAt) < new Date()) {
      this.db.prepare('DELETE FROM otks WHERE key = ?').run(key);
      return null;
    }

    // Configurable post-use window: allow re-use within graceMs of first use
    if (otk.used && otk.usedAt) {
      const usedAt = new Date(otk.usedAt).getTime();
      if (Date.now() - usedAt > graceMs) {
        this.db.prepare('DELETE FROM otks WHERE key = ?').run(key);
        return null;
      }
      return otk; // still within grace window
    }

    otk.used = true;
    otk.usedAt = new Date().toISOString();
    this.db.prepare('UPDATE otks SET used = 1, usedAt = ? WHERE key = ?').run(otk.usedAt, key);
    return otk;
  },

  deserializeOtk(this: SqliteStorage, row: Record<string, unknown>): OtkRecord {
    return {
      key: row.key as string,
      ownerGaii: row.ownerGaii as string,
      action: row.action as string,
      params: JSON.parse(row.params as string),
      expiresAt: row.expiresAt as string,
      initial: (row.initial as number) === 1,
      used: (row.used as number) === 1,
      usedAt: (row.usedAt as string) ?? null,
      sessionId: (row.sessionId as string) ?? null,
      createdAt: row.createdAt as string,
    };
  },
};
