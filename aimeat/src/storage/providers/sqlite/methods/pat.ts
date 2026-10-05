/**
 * @file src/storage/providers/sqlite/methods/pat.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/pat.ts (patMethods), so a fix in one
 *   provider finds its twin by file name. Bodies moved verbatim from the files named in the version history;
 *   bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure patMethods
 * @usage Object.assign(SqliteStorage.prototype, patMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — mapPatRow, createPat, getPatByHash, listPats, revokePat, touchPat moved here from
 *     extensions-notify.ts so the file mirrors postgres-kysely/methods/pat.ts (secaudit 2026-10, M8).
 */
import type { SqliteStorage } from '../index.js';

export const patMethods = {

  // ══════════════════════════════════════════════════════════
  // ── Personal Access Tokens ──
  // ══════════════════════════════════════════════════════════

  mapPatRow(this: SqliteStorage, row: Record<string, unknown>): import('../../../../storage/repositories/pat.repository.js').PatRecord {
    return {
      id: row.id as string,
      tokenHash: row.tokenHash as string,
      label: row.label as string,
      owner: row.owner as string,
      scopes: row.scopes ? JSON.parse(row.scopes as string) : [],
      grantOwner: row.grantOwner === 1 || row.grantOwner === true,
      grantOperator: row.grantOperator === 1 || row.grantOperator === true,
      readOwnerData: row.readOwnerData === 1 || row.readOwnerData === true,
      gaii: row.gaii as string,
      createdAt: row.createdAt as string,
      expiresAt: (row.expiresAt as string | null) ?? null,
      lastUsedAt: (row.lastUsedAt as string | null) ?? null,
      revoked: row.revoked === 1 || row.revoked === true,
    };
  },

  async createPat(this: SqliteStorage, pat: import('../../../../storage/repositories/pat.repository.js').PatRecord): Promise<void> {
    this.db.prepare(
      `INSERT INTO personal_access_tokens
         (id, tokenHash, label, owner, scopes, grantOwner, grantOperator, readOwnerData, gaii, createdAt, expiresAt, lastUsedAt, revoked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(
      pat.id, pat.tokenHash, pat.label, pat.owner, JSON.stringify(pat.scopes ?? []),
      pat.grantOwner ? 1 : 0, pat.grantOperator ? 1 : 0, pat.readOwnerData ? 1 : 0,
      pat.gaii, pat.createdAt, pat.expiresAt ?? null, pat.lastUsedAt ?? null,
    );
  },

  async getPatByHash(this: SqliteStorage, tokenHash: string): Promise<import('../../../../storage/repositories/pat.repository.js').PatRecord | null> {
    const row = this.db.prepare(
      'SELECT * FROM personal_access_tokens WHERE tokenHash = ? AND revoked = 0 LIMIT 1'
    ).get(tokenHash) as Record<string, unknown> | undefined;
    return row ? this.mapPatRow(row) : null;
  },

  async listPats(this: SqliteStorage, owner: string): Promise<import('../../../../storage/repositories/pat.repository.js').PatRecord[]> {
    const rows = this.db.prepare(
      'SELECT * FROM personal_access_tokens WHERE owner = ? AND revoked = 0 ORDER BY createdAt DESC'
    ).all(owner) as Record<string, unknown>[];
    return rows.map((r) => this.mapPatRow(r));
  },

  async revokePat(this: SqliteStorage, id: string, owner: string): Promise<boolean> {
    const result = this.db.prepare(
      'UPDATE personal_access_tokens SET revoked = 1 WHERE id = ? AND owner = ? AND revoked = 0'
    ).run(id, owner);
    return result.changes > 0;
  },

  async touchPat(this: SqliteStorage, id: string, usedAtIso: string): Promise<void> {
    this.db.prepare('UPDATE personal_access_tokens SET lastUsedAt = ? WHERE id = ?').run(usedAtIso, id);
  },
};
