/**
 * @file src/middleware/oauth-round-cookie.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The browser half of binding an outside sign-in round to the browser that finishes it
 *   (secrets audit 2026-10-09, chapter 2; the stored half is services/oauth-round-secrets.ts).
 *
 *   ONE COOKIE PER ROUND, httpOnly, SameSite=Lax, path = the callback's path, lifetime = the
 *   round's. Lax is the setting that works: the provider's redirect back is a cross-site top-level
 *   GET, which Lax sends and Strict does not. The name carries a hash of the state, so one browser
 *   can run two rounds at once and each callback reads its own.
 *
 *   WHO GETS ONE AT THE START. Only the owner in person on a page of this node: such a fetch
 *   carries `Sec-Fetch-Site: same-origin`, which browsers set and a page script cannot change. Any
 *   other start is left unbound and handed the confirmation page instead. A client that fakes the
 *   header only changes which address it is given: the cookie then sits in that client, and the
 *   person who approves at the provider in their own browser is still refused.
 * @structure browserCanBind · issueRoundBinding · readRoundBinding · clearRoundBinding
 * @usage const bind = browserCanBind(req, caller.inPerson) ? issueRoundBinding(req, res, state, path, ttl) : null;
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, chapter 2).
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { bindingHash } from '../services/oauth-round-secrets.js';
import { logger } from '../utils/logger.js';

const COOKIE_PREFIX = 'aimeat_oauth_';

/** The cookie that binds this one round. Derived from the state, so it names one round only. */
function cookieName(state: string): string {
  return `${COOKIE_PREFIX}${createHash('sha256').update(state).digest('hex').slice(0, 16)}`;
}

function cookieSecure(req: Request): boolean {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

/** True when this request is a page of this node in the owner's own browser. */
export function browserCanBind(req: Request, ownerInPerson: boolean): boolean {
  return ownerInPerson && req.headers['sec-fetch-site'] === 'same-origin';
}

/**
 * Give this browser a fresh binding for `state`, scoped to `callbackPath` for `ttlMs`, and return
 * the hash the round stores.
 */
export function issueRoundBinding(
  req: Request, res: Response, state: string, callbackPath: string, ttlMs: number,
): string {
  const value = randomBytes(32).toString('base64url');
  res.cookie(cookieName(state), value, {
    httpOnly: true, secure: cookieSecure(req), sameSite: 'lax', path: callbackPath, maxAge: ttlMs,
  });
  return bindingHash(value);
}

/** The binding value this request carries for `state`, or '' when it carries none. */
export function readRoundBinding(req: Request, state: string): string {
  const header = req.headers.cookie;
  if (!header) return '';
  const name = cookieName(state);
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1 || part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      // A malformed cookie binds nothing; the callback then refuses as for a missing one.
      logger.warn('oauth-round: a round cookie could not be decoded and was ignored');
      return '';
    }
  }
  return '';
}

/** Remove the round's cookie: the round is finished or refused either way. */
export function clearRoundBinding(req: Request, res: Response, state: string, callbackPath: string): void {
  res.clearCookie(cookieName(state), { httpOnly: true, secure: cookieSecure(req), sameSite: 'lax', path: callbackPath });
}
