/**
 * @file src/storage/providers/sqlite/methods/oauth.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/oauth.ts (oauthMethods), so a fix in
 *   one provider finds its twin by file name. Bodies moved verbatim from the files named in the version
 *   history; bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure oauthMethods
 * @usage Object.assign(SqliteStorage.prototype, oauthMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — createOAuthClient, getOAuthClient, createOAuthRefreshToken, getOAuthRefreshToken,
 *     deleteOAuthRefreshToken, deleteOAuthRefreshTokensByGaii, createOAuthApproval, getOAuthApproval moved
 *     here from federation-oauth.ts so the file mirrors postgres-kysely/methods/oauth.ts (secaudit 2026-10,
 *     M8).
 */
import type { OAuthClientRecord, OAuthRefreshTokenRecord, OAuthApprovalRecord } from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

export const oauthMethods = {

  // ══════════════════════════════════════════════════════════
  // ── OAuth 2.1 Persistent State ──
  // ══════════════════════════════════════════════════════════

  // ── Clients ──

  async createOAuthClient(this: SqliteStorage, client: OAuthClientRecord): Promise<void> {
    this.db.prepare(
      `INSERT INTO oauth_clients (clientId, clientSecret, clientName, redirectUris, createdAt)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      client.clientId, client.clientSecret, client.clientName,
      JSON.stringify(client.redirectUris), client.createdAt,
    );
  },

  async getOAuthClient(this: SqliteStorage, clientId: string): Promise<OAuthClientRecord | null> {
    const row = this.db.prepare('SELECT * FROM oauth_clients WHERE clientId = ?').get(clientId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      clientId: row.clientId as string,
      clientSecret: row.clientSecret as string,
      clientName: row.clientName as string,
      redirectUris: JSON.parse(row.redirectUris as string),
      createdAt: row.createdAt as string,
    };
  },

  // ── Refresh Tokens ──

  async createOAuthRefreshToken(this: SqliteStorage, token: OAuthRefreshTokenRecord): Promise<void> {
    this.db.prepare(
      `INSERT INTO oauth_refresh_tokens (tokenHash, clientId, gaii, owner, roles, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      token.tokenHash, token.clientId, token.gaii, token.owner,
      JSON.stringify(token.roles), token.createdAt,
    );
  },

  async getOAuthRefreshToken(this: SqliteStorage, tokenHash: string): Promise<OAuthRefreshTokenRecord | null> {
    const row = this.db.prepare('SELECT * FROM oauth_refresh_tokens WHERE tokenHash = ?').get(tokenHash) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      tokenHash: row.tokenHash as string,
      clientId: row.clientId as string,
      gaii: row.gaii as string,
      owner: row.owner as string,
      roles: JSON.parse(row.roles as string),
      createdAt: row.createdAt as string,
    };
  },

  async deleteOAuthRefreshToken(this: SqliteStorage, tokenHash: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM oauth_refresh_tokens WHERE tokenHash = ?').run(tokenHash);
    return result.changes > 0;
  },

  async deleteOAuthRefreshTokensByGaii(this: SqliteStorage, gaii: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM oauth_refresh_tokens WHERE gaii = ?').run(gaii);
    return result.changes;
  },

  // ── Approvals ──

  async createOAuthApproval(this: SqliteStorage, approval: OAuthApprovalRecord): Promise<void> {
    this.db.prepare(
      `INSERT OR REPLACE INTO oauth_approvals (clientId, gaii, owner, scope, approvedAt)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      approval.clientId, approval.gaii, approval.owner,
      approval.scope, approval.approvedAt,
    );
  },

  async getOAuthApproval(this: SqliteStorage, clientId: string, gaii: string): Promise<OAuthApprovalRecord | null> {
    const row = this.db.prepare('SELECT * FROM oauth_approvals WHERE clientId = ? AND gaii = ?').get(clientId, gaii) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      clientId: row.clientId as string,
      gaii: row.gaii as string,
      owner: row.owner as string,
      scope: row.scope as string,
      approvedAt: row.approvedAt as string,
    };
  },
};
