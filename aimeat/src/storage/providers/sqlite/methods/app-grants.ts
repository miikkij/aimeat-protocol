/**
 * @file src/storage/providers/sqlite/methods/app-grants.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/app-grants.ts (appGrantMethods), so a
 *   fix in one provider finds its twin by file name. Bodies moved verbatim from the files named in the
 *   version history; bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure appGrantMethods
 * @usage Object.assign(SqliteStorage.prototype, appGrantMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — createAppGrant, getAppGrant, getAppGrantByRefreshHash, getAppGrantByOwnerAndApp,
 *     listAppGrantsByOwner, listAppGrants, updateAppGrant, deserializeAppGrant moved here from apps.ts so the
 *     file mirrors postgres-kysely/methods/app-grants.ts (secaudit 2026-10, M8).
 */
import type { AppGrantRecord } from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

export const appGrantMethods = {

  // ── App grants (owner-issued app authorizations → agent tokens) ──

  async createAppGrant(this: SqliteStorage, grant: AppGrantRecord): Promise<AppGrantRecord> {
    this.db.prepare(
      `INSERT INTO app_grants (grantId, app, appName, appOrigin, owner, gaii, scopes, spendCapMorsels, spentMorsels, ownerAddedScopes, refreshTokenHash, createdAt, lastUsedAt, revoked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      grant.grantId, grant.app, grant.appName, grant.appOrigin, grant.owner, grant.gaii,
      JSON.stringify(grant.scopes), grant.spendCapMorsels ?? null, grant.spentMorsels ?? 0,
      JSON.stringify(grant.ownerAddedScopes ?? []),
      grant.refreshTokenHash, grant.createdAt, grant.lastUsedAt,
      grant.revoked ? 1 : 0,
    );
    return grant;
  },

  async getAppGrant(this: SqliteStorage, grantId: string): Promise<AppGrantRecord | null> {
    const row = this.db.prepare('SELECT * FROM app_grants WHERE grantId = ?')
      .get(grantId) as Record<string, unknown> | undefined;
    return row ? this.deserializeAppGrant(row) : null;
  },

  async getAppGrantByRefreshHash(this: SqliteStorage, tokenHash: string): Promise<AppGrantRecord | null> {
    const row = this.db.prepare('SELECT * FROM app_grants WHERE refreshTokenHash = ?')
      .get(tokenHash) as Record<string, unknown> | undefined;
    return row ? this.deserializeAppGrant(row) : null;
  },

  async getAppGrantByOwnerAndApp(this: SqliteStorage, owner: string, app: string): Promise<AppGrantRecord | null> {
    // Ordered + LIMIT 1 rather than a bare get: the partial unique index guarantees at most one live
    // row, but a DB that predates the index (pre-dedupe boot) must still resolve deterministically to
    // the freshest grant instead of an arbitrary leftover.
    const row = this.db.prepare(
      'SELECT * FROM app_grants WHERE owner = ? AND app = ? AND revoked = 0 ORDER BY lastUsedAt DESC, createdAt DESC LIMIT 1'
    ).get(owner, app) as Record<string, unknown> | undefined;
    return row ? this.deserializeAppGrant(row) : null;
  },

  async listAppGrantsByOwner(this: SqliteStorage, owner: string): Promise<AppGrantRecord[]> {
    const rows = this.db.prepare('SELECT * FROM app_grants WHERE owner = ? ORDER BY createdAt DESC')
      .all(owner) as Record<string, unknown>[];
    return rows.map(r => this.deserializeAppGrant(r));
  },

  async listAppGrants(this: SqliteStorage): Promise<AppGrantRecord[]> {
    const rows = this.db.prepare('SELECT * FROM app_grants WHERE revoked = 0 ORDER BY createdAt DESC')
      .all() as Record<string, unknown>[];
    return rows.map(r => this.deserializeAppGrant(r));
  },

  async updateAppGrant(this: SqliteStorage, 
    grantId: string,
    updates: Partial<Pick<AppGrantRecord, 'refreshTokenHash' | 'lastUsedAt' | 'revoked' | 'scopes' | 'spendCapMorsels' | 'spentMorsels' | 'scopesFixedAt' | 'ownerAddedScopes'>>,
  ): Promise<AppGrantRecord | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (updates.ownerAddedScopes !== undefined) { sets.push('ownerAddedScopes = ?'); params.push(JSON.stringify(updates.ownerAddedScopes)); }
    if (updates.refreshTokenHash !== undefined) { sets.push('refreshTokenHash = ?'); params.push(updates.refreshTokenHash); }
    if (updates.lastUsedAt !== undefined) { sets.push('lastUsedAt = ?'); params.push(updates.lastUsedAt); }
    if (updates.revoked !== undefined) { sets.push('revoked = ?'); params.push(updates.revoked ? 1 : 0); }
    if (updates.scopes !== undefined) { sets.push('scopes = ?'); params.push(JSON.stringify(updates.scopes)); }
    if (updates.spendCapMorsels !== undefined) { sets.push('spendCapMorsels = ?'); params.push(updates.spendCapMorsels); }
    if (updates.spentMorsels !== undefined) { sets.push('spentMorsels = ?'); params.push(updates.spentMorsels); }
    if (updates.scopesFixedAt !== undefined) { sets.push('scopesFixedAt = ?'); params.push(updates.scopesFixedAt); }
    if (sets.length === 0) return this.getAppGrant(grantId);
    params.push(grantId);
    const result = this.db.prepare(`UPDATE app_grants SET ${sets.join(', ')} WHERE grantId = ?`)
      .run(...params);
    if (result.changes === 0) return null;
    return this.getAppGrant(grantId);
  },

  deserializeAppGrant(this: SqliteStorage, row: Record<string, unknown>): AppGrantRecord {
    return {
      grantId: row.grantId as string,
      spendCapMorsels: (row.spendCapMorsels as number | null) ?? null,
      spentMorsels: (row.spentMorsels as number | null) ?? 0,
      scopesFixedAt: (row.scopesFixedAt as string | null) ?? null,
      ownerAddedScopes: row.ownerAddedScopes ? JSON.parse(row.ownerAddedScopes as string) as string[] : [],
      app: row.app as string,
      appName: row.appName as string,
      appOrigin: row.appOrigin as string,
      owner: row.owner as string,
      gaii: row.gaii as string,
      scopes: JSON.parse(row.scopes as string) as string[],
      refreshTokenHash: (row.refreshTokenHash as string | null) ?? null,
      createdAt: row.createdAt as string,
      lastUsedAt: (row.lastUsedAt as string | null) ?? null,
      revoked: (row.revoked as number) === 1,
    };
  },
};
