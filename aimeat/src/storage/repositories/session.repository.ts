/**
 * @file session.repository.ts
 * @description Storage contract for server-side session tracking. Covers both the
 *   legacy JWT-tracking sessions (created by /v1/auth/token and /v1/auth/refresh)
 *   and owner login sessions that carry a rotating, server-side refresh token.
 * @structure SessionRecord shape; SessionRepository interface (create/list/rotate/revoke/prune).
 * @usage Implemented by each storage provider (SQLite, MongoDB) and composed into the Storage interface.
 * @version-history
 * v1.2.0 - 2026-08-13 - Add revokeSessionsByGaii: end one principal's sessions without touching its
 *   siblings', which is what deleting an agent needs.
 * v1.1.0 - 2026-06-03 - Add owner refresh-token fields + createOwnerSession,
 *   getSessionByRefreshHash, rotateSessionRefresh, pruneExpiredSessions
 *   (owner session refresh tokens, plan 2026-06-03-owner-session-refresh-tokens).
 */

export interface SessionRecord {
  sessionId: string;
  gaii: string;
  owner: string;
  issuedAt: string;
  expiresAt: string;
  revoked: boolean;
  // ── Owner refresh-token fields ──
  // Null on legacy JWT-tracking sessions; populated only for owner login sessions
  // that carry a rotating refresh token. The server stores only token HASHES.
  // See docs/plans/2026-06-03-owner-session-refresh-tokens-plan.md
  refreshTokenHash?: string | null;   // SHA-256 of the current refresh token
  prevTokenHash?: string | null;      // SHA-256 of the previous token (rotation grace window)
  prevValidUntil?: string | null;     // ISO; the previous token is honored until this time
  lastUsedAt?: string | null;         // ISO; timestamp of the last refresh
  idleExpiresAt?: string | null;      // ISO; sliding idle window, bumped on each rotation
  absoluteExpiresAt?: string | null;  // ISO; hard cap, never extended
  deviceLabel?: string | null;        // human-readable label for the session list
  userAgent?: string | null;          // raw User-Agent at login (soft signal)
}

export interface SessionRepository {
  /** Create a legacy JWT-tracking session (no refresh token). */
  createSession(session: { sessionId: string; gaii: string; owner: string; issuedAt: string; expiresAt: string }): Promise<void>;

  /**
   * Create an owner login session that carries a rotating refresh token.
   * `expiresAt` on the row is set to `idleExpiresAt` so the session-list filter
   * reflects the refresh token's lifetime (not the short access-token lifetime).
   */
  createOwnerSession(session: {
    sessionId: string;
    gaii: string;
    owner: string;
    issuedAt: string;
    refreshTokenHash: string;
    idleExpiresAt: string;
    absoluteExpiresAt: string;
    lastUsedAt: string;
    deviceLabel?: string | null;
    userAgent?: string | null;
  }): Promise<void>;

  listActiveSessions(owner: string): Promise<SessionRecord[]>;

  /** Look up a session whose CURRENT or PREVIOUS refresh-token hash matches. */
  getSessionByRefreshHash(tokenHash: string): Promise<SessionRecord | null>;

  /** Rotate a session's refresh token and slide the idle window. */
  rotateSessionRefresh(sessionId: string, update: {
    refreshTokenHash: string;
    prevTokenHash: string | null;
    prevValidUntil: string | null;
    idleExpiresAt: string;
    expiresAt: string;
    lastUsedAt: string;
  }): Promise<void>;

  revokeSession(sessionId: string): Promise<boolean>;
  revokeAllSessions(owner: string): Promise<number>;
  /**
   * Revoke every live session belonging to ONE identity (an agent GAII, or a bare owner name).
   *
   * This is how a principal is signed out when its record goes away. An agent JWT lives 90 days and
   * can otherwise only be revoked by exact token hash, which the owner pressing Delete does not
   * have: they never see the string. Deleting the agent therefore left every credential it held
   * authenticating against a record that no longer existed.
   *
   * Scoped by `gaii` rather than by owner, because the sibling agents of the same person must keep
   * working; revokeAllSessions(owner) is the account-wide answer and a different question.
   */
  revokeSessionsByGaii(gaii: string): Promise<number>;
  isSessionRevoked(sessionId: string): Promise<boolean>;

  /** Delete revoked or fully-expired session rows. Returns the number removed. */
  pruneExpiredSessions(nowIso: string): Promise<number>;
}
