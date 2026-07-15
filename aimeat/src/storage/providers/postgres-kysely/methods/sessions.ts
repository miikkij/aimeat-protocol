/**
 * @file src/storage/providers/postgres-kysely/methods/sessions.ts
 * @description Session domain for the Postgres+Kysely backend (Session table): JWT-tracking sessions,
 *   owner refresh-token sessions (rotating hashes, idle+absolute windows), and revocation. Translated
 *   1:1 from the Prisma implementation. Backs POST /v1/auth/token and the owner refresh flow.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: session domain on Postgres+Kysely.
 */
import type { Selectable } from 'kysely';
import type { SessionRecord } from '../../../repositories/session.repository.js';
import type { Session } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';

const iso = (d: Date | string | null | undefined): string | null =>
  d == null ? null : (d instanceof Date ? d.toISOString() : String(d));

function mapSession(s: Selectable<Session>): SessionRecord {
  return {
    sessionId: s.sessionId, gaii: s.gaii, owner: s.owner,
    issuedAt: iso(s.issuedAt) as string, expiresAt: iso(s.expiresAt) as string, revoked: s.revoked,
    refreshTokenHash: s.refreshTokenHash ?? null, prevTokenHash: s.prevTokenHash ?? null,
    prevValidUntil: iso(s.prevValidUntil), lastUsedAt: iso(s.lastUsedAt),
    idleExpiresAt: iso(s.idleExpiresAt), absoluteExpiresAt: iso(s.absoluteExpiresAt),
    deviceLabel: s.deviceLabel ?? null, userAgent: s.userAgent ?? null,
  };
}

export const sessionMethods = {
  async createSession(this: PostgresKyselyStorage, session: { sessionId: string; gaii: string; owner: string; issuedAt: string; expiresAt: string }): Promise<void> {
    await this.db.insertInto('Session').values({
      sessionId: session.sessionId, gaii: session.gaii, owner: session.owner,
      issuedAt: new Date(session.issuedAt), expiresAt: new Date(session.expiresAt), revoked: false,
    }).execute();
  },

  async createOwnerSession(this: PostgresKyselyStorage, session: {
    sessionId: string; gaii: string; owner: string; issuedAt: string;
    refreshTokenHash: string; idleExpiresAt: string; absoluteExpiresAt: string;
    lastUsedAt: string; deviceLabel?: string | null; userAgent?: string | null;
  }): Promise<void> {
    await this.db.insertInto('Session').values({
      sessionId: session.sessionId, gaii: session.gaii, owner: session.owner,
      issuedAt: new Date(session.issuedAt), expiresAt: new Date(session.idleExpiresAt), revoked: false,
      refreshTokenHash: session.refreshTokenHash, idleExpiresAt: new Date(session.idleExpiresAt),
      absoluteExpiresAt: new Date(session.absoluteExpiresAt), lastUsedAt: new Date(session.lastUsedAt),
      deviceLabel: session.deviceLabel ?? null, userAgent: session.userAgent ?? null,
    }).execute();
  },

  async listActiveSessions(this: PostgresKyselyStorage, owner: string): Promise<SessionRecord[]> {
    const rows = await this.db.selectFrom('Session').selectAll().where('owner', '=', owner).where('revoked', '=', false).orderBy('issuedAt', 'desc').execute();
    return rows.map(mapSession);
  },

  async getSessionByRefreshHash(this: PostgresKyselyStorage, tokenHash: string): Promise<SessionRecord | null> {
    const s = await this.db.selectFrom('Session').selectAll()
      .where(eb => eb.or([eb('refreshTokenHash', '=', tokenHash), eb('prevTokenHash', '=', tokenHash)])).executeTakeFirst();
    return s ? mapSession(s) : null;
  },

  async rotateSessionRefresh(this: PostgresKyselyStorage, sessionId: string, update: {
    refreshTokenHash: string; prevTokenHash: string | null; prevValidUntil: string | null;
    idleExpiresAt: string; expiresAt: string; lastUsedAt: string;
  }): Promise<void> {
    await this.db.updateTable('Session').set({
      refreshTokenHash: update.refreshTokenHash, prevTokenHash: update.prevTokenHash,
      prevValidUntil: update.prevValidUntil ? new Date(update.prevValidUntil) : null,
      idleExpiresAt: new Date(update.idleExpiresAt), expiresAt: new Date(update.expiresAt), lastUsedAt: new Date(update.lastUsedAt),
    }).where('sessionId', '=', sessionId).execute();
  },

  async revokeSession(this: PostgresKyselyStorage, sessionId: string): Promise<boolean> {
    const s = await this.db.selectFrom('Session').select('revoked').where('sessionId', '=', sessionId).executeTakeFirst();
    if (!s || s.revoked) return false;
    await this.db.updateTable('Session').set({ revoked: true }).where('sessionId', '=', sessionId).execute();
    return true;
  },

  async revokeAllSessions(this: PostgresKyselyStorage, owner: string): Promise<number> {
    const r = await this.db.updateTable('Session').set({ revoked: true }).where('owner', '=', owner).where('revoked', '=', false).executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0);
  },

  async isSessionRevoked(this: PostgresKyselyStorage, sessionId: string): Promise<boolean> {
    const s = await this.db.selectFrom('Session').select('revoked').where('sessionId', '=', sessionId).executeTakeFirst();
    return s ? s.revoked : false;
  },

  async pruneExpiredSessions(this: PostgresKyselyStorage, nowIso: string): Promise<number> {
    const now = new Date(nowIso);
    const r = await this.db.deleteFrom('Session')
      .where(eb => eb.or([eb('expiresAt', '<', now), eb('absoluteExpiresAt', '<', now)])).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
};
