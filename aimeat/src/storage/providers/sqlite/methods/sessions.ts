/**
 * @file src/storage/providers/sqlite/methods/sessions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/sessions.ts (sessionMethods), so a
 *   fix in one provider finds its twin by file name. Bodies moved verbatim from the files named in the
 *   version history; bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure sessionMethods
 * @usage Object.assign(SqliteStorage.prototype, sessionMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — 10 methods (mapSessionRow, createSession, createOwnerSession, …) moved here from
 *     extensions-notify.ts so the file mirrors postgres-kysely/methods/sessions.ts (secaudit 2026-10, M8).
 */
import type { SqliteStorage } from '../index.js';

export const sessionMethods = {

  // ══════════════════════════════════════════════════════════
  // ── Sessions (P3-7: Server-Side Session Tracking) ──
  // ══════════════════════════════════════════════════════════

  mapSessionRow(this: SqliteStorage, row: Record<string, unknown>): import('../../../../storage/repositories/session.repository.js').SessionRecord {
    return {
      sessionId: row.sessionId as string,
      gaii: row.gaii as string,
      owner: row.owner as string,
      issuedAt: row.issuedAt as string,
      expiresAt: row.expiresAt as string,
      revoked: row.revoked === 1 || row.revoked === true,
      refreshTokenHash: (row.refreshTokenHash as string | null) ?? null,
      prevTokenHash: (row.prevTokenHash as string | null) ?? null,
      prevValidUntil: (row.prevValidUntil as string | null) ?? null,
      lastUsedAt: (row.lastUsedAt as string | null) ?? null,
      idleExpiresAt: (row.idleExpiresAt as string | null) ?? null,
      absoluteExpiresAt: (row.absoluteExpiresAt as string | null) ?? null,
      deviceLabel: (row.deviceLabel as string | null) ?? null,
      userAgent: (row.userAgent as string | null) ?? null,
    };
  },

  async createSession(this: SqliteStorage, session: { sessionId: string; gaii: string; owner: string; issuedAt: string; expiresAt: string }): Promise<void> {
    this.db.prepare(
      'INSERT INTO sessions (sessionId, gaii, owner, issuedAt, expiresAt, revoked) VALUES (?, ?, ?, ?, ?, 0)'
    ).run(session.sessionId, session.gaii, session.owner, session.issuedAt, session.expiresAt);
  },

  async createOwnerSession(this: SqliteStorage, session: {
    sessionId: string; gaii: string; owner: string; issuedAt: string;
    refreshTokenHash: string; idleExpiresAt: string; absoluteExpiresAt: string;
    lastUsedAt: string; deviceLabel?: string | null; userAgent?: string | null;
  }): Promise<void> {
    // expiresAt mirrors the idle window so listActiveSessions reflects refresh-token life.
    this.db.prepare(
      `INSERT INTO sessions
         (sessionId, gaii, owner, issuedAt, expiresAt, revoked,
          refreshTokenHash, idleExpiresAt, absoluteExpiresAt, lastUsedAt, deviceLabel, userAgent)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`
    ).run(
      session.sessionId, session.gaii, session.owner, session.issuedAt, session.idleExpiresAt,
      session.refreshTokenHash, session.idleExpiresAt, session.absoluteExpiresAt, session.lastUsedAt,
      session.deviceLabel ?? null, session.userAgent ?? null,
    );
  },

  async listActiveSessions(this: SqliteStorage, owner: string): Promise<import('../../../../storage/repositories/session.repository.js').SessionRecord[]> {
    const rows = this.db.prepare(
      'SELECT * FROM sessions WHERE owner = ? AND revoked = 0 ORDER BY issuedAt DESC'
    ).all(owner) as Record<string, unknown>[];
    return rows.map((r) => this.mapSessionRow(r));
  },

  async getSessionByRefreshHash(this: SqliteStorage, tokenHash: string): Promise<import('../../../../storage/repositories/session.repository.js').SessionRecord | null> {
    const row = this.db.prepare(
      'SELECT * FROM sessions WHERE refreshTokenHash = ? OR prevTokenHash = ? LIMIT 1'
    ).get(tokenHash, tokenHash) as Record<string, unknown> | undefined;
    return row ? this.mapSessionRow(row) : null;
  },

  async rotateSessionRefresh(this: SqliteStorage, sessionId: string, update: {
    refreshTokenHash: string; prevTokenHash: string | null; prevValidUntil: string | null;
    idleExpiresAt: string; expiresAt: string; lastUsedAt: string;
  }): Promise<void> {
    this.db.prepare(
      `UPDATE sessions SET refreshTokenHash = ?, prevTokenHash = ?, prevValidUntil = ?,
         idleExpiresAt = ?, expiresAt = ?, lastUsedAt = ? WHERE sessionId = ?`
    ).run(
      update.refreshTokenHash, update.prevTokenHash, update.prevValidUntil,
      update.idleExpiresAt, update.expiresAt, update.lastUsedAt, sessionId,
    );
  },

  async revokeSession(this: SqliteStorage, sessionId: string): Promise<boolean> {
    const result = this.db.prepare('UPDATE sessions SET revoked = 1 WHERE sessionId = ? AND revoked = 0').run(sessionId);
    return result.changes > 0;
  },

  async revokeAllSessions(this: SqliteStorage, owner: string): Promise<number> {
    const result = this.db.prepare('UPDATE sessions SET revoked = 1 WHERE owner = ? AND revoked = 0').run(owner);
    return result.changes;
  },

  async revokeSessionsByGaii(this: SqliteStorage, gaii: string): Promise<number> {
    const result = this.db.prepare('UPDATE sessions SET revoked = 1 WHERE gaii = ? AND revoked = 0').run(gaii);
    return result.changes;
  },

  async isSessionRevoked(this: SqliteStorage, sessionId: string): Promise<boolean> {
    const row = this.db.prepare('SELECT revoked FROM sessions WHERE sessionId = ?').get(sessionId) as { revoked: number } | undefined;
    if (!row) return false; // session not tracked = not revoked
    return row.revoked === 1;
  },
};
