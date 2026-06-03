/**
 * @file owner-session.ts
 * @description Owner (human) login sessions backed by rotating, server-side refresh
 *   tokens delivered as an httpOnly cookie. Decouples session continuity from the
 *   owner keypair so logging in on one device never invalidates another. Provides the
 *   cookie helpers, session establishment (login), and the refresh-with-rotation +
 *   reuse-detection logic used by POST /v1/auth/refresh.
 * @structure REFRESH_COOKIE constant; cookie helpers (read/set/clear/secure);
 *   establishOwnerSession() for login; refreshOwnerSession() for rotation.
 * @usage import { establishOwnerSession, refreshOwnerSession, clearRefreshCookie } from '../services/owner-session.js'
 * @version-history
 * v1.0.0 - 2026-06-03 - Initial implementation (plan 2026-06-03-owner-session-refresh-tokens).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { issueJWT } from '../auth/jwt.js';

/** Name of the httpOnly refresh-token cookie. Scoped to /v1/auth on the wire. */
export const REFRESH_COOKIE = 'aimeat_rt';
const COOKIE_PATH = '/v1/auth';
const DAY_MS = 86_400_000;

/** SHA-256 hex of a raw token — only the hash is ever stored. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Whether the cookie should carry the Secure flag (https or proxied https). */
function cookieSecure(req: Request): boolean {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

/** Read the raw refresh token from the request's Cookie header (no cookie-parser dep). */
export function readRefreshCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === REFRESH_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/** Set the httpOnly refresh cookie. maxAge defaults to the absolute cap. */
export function setRefreshCookie(req: Request, res: Response, config: AimeatConfig, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(req),
    sameSite: 'strict',
    path: COOKIE_PATH,
    maxAge: config.refreshAbsoluteDays * DAY_MS,
  });
}

/** Clear the refresh cookie (logout / revocation / invalid token). */
export function clearRefreshCookie(req: Request, res: Response): void {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: cookieSecure(req),
    sameSite: 'strict',
    path: COOKIE_PATH,
  });
}

/** Best-effort human label for the session list, derived from the User-Agent. */
function deviceLabelFromUA(ua: string | undefined): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod|iOS/.test(ua) ? 'iOS'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  return os ? `${browser} on ${os}` : browser;
}

/** Re-read the owner's current roles so refreshed tokens never carry stale privileges. */
async function freshOwnerRoles(storage: Storage, owner: string): Promise<string[]> {
  const ownerRecord = await storage.getOwner(owner);
  return ownerRecord?.roles ?? ['owner'];
}

export interface EstablishedSession {
  token: string;
  sessionId: string;
  expiresIn: number;
}

/**
 * Create an owner login session: mint a refresh token (cookie) + a short-lived access
 * JWT bound to the session, and persist the session row. Called on successful login.
 */
export async function establishOwnerSession(
  storage: Storage,
  config: AimeatConfig,
  req: Request,
  res: Response,
  identity: { owner: string; roles: string[] },
): Promise<EstablishedSession> {
  const sessionId = randomUUID();
  const rawToken = randomBytes(32).toString('hex');
  const now = Date.now();
  const issuedAt = new Date(now).toISOString();
  const idleExpiresAt = new Date(now + config.refreshIdleDays * DAY_MS).toISOString();
  const absoluteExpiresAt = new Date(now + config.refreshAbsoluteDays * DAY_MS).toISOString();

  await storage.createOwnerSession({
    sessionId,
    gaii: identity.owner, // owner sessions are keyed to the bare owner name (no agent GAII)
    owner: identity.owner,
    issuedAt,
    refreshTokenHash: hashToken(rawToken),
    idleExpiresAt,
    absoluteExpiresAt,
    lastUsedAt: issuedAt,
    deviceLabel: deviceLabelFromUA(req.headers['user-agent']),
    userAgent: (req.headers['user-agent'] ?? null) as string | null,
  });

  setRefreshCookie(req, res, config, rawToken);

  const token = await issueJWT(
    { sub: identity.owner, owner: identity.owner, node: config.nodeId, roles: identity.roles },
    config.accessTtlSeconds,
    sessionId,
  );

  return { token, sessionId, expiresIn: config.accessTtlSeconds };
}

export type RefreshResult =
  | { ok: true; token: string; expiresIn: number; rotated: boolean }
  | { ok: false; status: number; code: string; message: string };

/**
 * Validate the refresh cookie, rotate it (one-time use with a grace window), detect
 * reuse, and issue a new access token. Sets/clears the cookie on `res` as needed.
 */
export async function refreshOwnerSession(
  storage: Storage,
  config: AimeatConfig,
  req: Request,
  res: Response,
): Promise<RefreshResult> {
  const rawToken = readRefreshCookie(req);
  if (!rawToken) {
    return { ok: false, status: 401, code: 'AUTH_REQUIRED', message: 'No refresh token' };
  }
  // CSRF guard: cross-site requests cannot set this custom header without a CORS preflight.
  if (req.headers['x-aimeat-refresh'] !== '1') {
    return { ok: false, status: 400, code: 'CSRF_REQUIRED', message: 'Missing X-AIMEAT-Refresh header' };
  }

  const presentedHash = hashToken(rawToken);
  const session = await storage.getSessionByRefreshHash(presentedHash);
  if (!session) {
    clearRefreshCookie(req, res);
    return { ok: false, status: 401, code: 'INVALID_GRANT', message: 'Invalid refresh token' };
  }
  if (session.revoked) {
    clearRefreshCookie(req, res);
    return { ok: false, status: 401, code: 'SESSION_REVOKED', message: 'Session has been revoked' };
  }

  const now = Date.now();
  const idle = session.idleExpiresAt ? Date.parse(session.idleExpiresAt) : 0;
  const absolute = session.absoluteExpiresAt ? Date.parse(session.absoluteExpiresAt) : 0;
  if ((idle && now >= idle) || (absolute && now >= absolute)) {
    await storage.revokeSession(session.sessionId);
    clearRefreshCookie(req, res);
    return { ok: false, status: 401, code: 'SESSION_EXPIRED', message: 'Session expired — please log in again' };
  }

  // Reuse detection: the presented token matched the PREVIOUS hash.
  if (session.prevTokenHash && presentedHash === session.prevTokenHash) {
    const graceUntil = session.prevValidUntil ? Date.parse(session.prevValidUntil) : 0;
    if (!(graceUntil && now < graceUntil)) {
      // Previous token replayed after the grace window → treat as theft, revoke the family.
      await storage.revokeSession(session.sessionId);
      clearRefreshCookie(req, res);
      return { ok: false, status: 401, code: 'SESSION_REVOKED', message: 'Refresh token reuse detected' };
    }
    // Within grace: an in-flight request carrying the just-rotated-away cookie. A sibling
    // request already rotated and set the new cookie, so DON'T rotate again — just issue a
    // fresh access token bound to the session.
    const roles = await freshOwnerRoles(storage, session.owner);
    const token = await issueJWT(
      { sub: session.gaii, owner: session.owner, node: config.nodeId, roles },
      config.accessTtlSeconds,
      session.sessionId,
    );
    return { ok: true, token, expiresIn: config.accessTtlSeconds, rotated: false };
  }

  // Normal path: presented token == current. Rotate one-time-use and slide the idle window.
  const roles = await freshOwnerRoles(storage, session.owner);
  const newRawToken = randomBytes(32).toString('hex');
  const newIdle = new Date(absolute ? Math.min(now + config.refreshIdleDays * DAY_MS, absolute) : now + config.refreshIdleDays * DAY_MS).toISOString();
  await storage.rotateSessionRefresh(session.sessionId, {
    refreshTokenHash: hashToken(newRawToken),
    prevTokenHash: session.refreshTokenHash ?? null,
    prevValidUntil: new Date(now + config.refreshGraceMs).toISOString(),
    idleExpiresAt: newIdle,
    expiresAt: newIdle,
    lastUsedAt: new Date(now).toISOString(),
  });
  setRefreshCookie(req, res, config, newRawToken);

  const token = await issueJWT(
    { sub: session.gaii, owner: session.owner, node: config.nodeId, roles },
    config.accessTtlSeconds,
    session.sessionId,
  );
  return { ok: true, token, expiresIn: config.accessTtlSeconds, rotated: true };
}
