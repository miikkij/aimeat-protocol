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
 * @structure browserCanBind · issueRoundBinding · newRoundBinding · setRoundBinding · readRoundBinding · clearRoundBinding
 * @usage const bind = browserCanBind(req, caller.inPerson) ? issueRoundBinding(req, res, state, path, ttl) : null;
 * @version-history
 *   2026-10-27 — setRoundBinding, readRoundBinding and clearRoundBinding take `host`: the `__Host-` cookie,
 *     Secure with Path=/, which a same-site app, portfolio or company page cannot write; the sign-in
 *     rounds use it on https (secaudit2026oct26, login-round-binding-cookie-settable-from-same-site-author-origin).
 *   2026-10-25 — setRoundBinding and clearRoundBinding take `sameSite` ('lax' by default; 'none', always
 *     Secure, for the SAML ACS form post), for the sign-in rounds (./login-round-binding.ts;
 *     secaudit2026oct22, oidc-saml-login-round-not-browser-bound).
 *   v1.1.0 — 2026-10-10 — newRoundBinding and setRoundBinding split the value from the cookie, so the
 *     approve route sets the cookie only after the round is bound (secaudit 2026-10-10 I6).
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, chapter 2).
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { bindingHash } from '../services/oauth-round-secrets.js';
import { logger } from '../utils/logger.js';

const COOKIE_PREFIX = 'aimeat_oauth_';

/**
 * The cookie that binds this one round. Derived from the state, so it names one round only. `host`
 * names the `__Host-` cookie (Secure, Path=/, no Domain), which a same-site page of another host
 * cannot write (the sign-in rounds on https; ./login-round-binding.ts).
 */
function cookieName(state: string, host = false): string {
  return `${host ? '__Host-' : ''}${COOKIE_PREFIX}${createHash('sha256').update(state).digest('hex').slice(0, 16)}`;
}

/** Whether this request came over https, directly or through the node's proxy. */
export function cookieSecure(req: Request): boolean {
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
  const binding = newRoundBinding();
  setRoundBinding(req, res, state, callbackPath, ttlMs, binding.value);
  return binding.hash;
}

/**
 * A fresh binding value and the hash the round stores, with no cookie set yet. For a caller that
 * must store the hash first and set the cookie only when the store succeeded (POST
 * /v1/oauth-rounds/:state/approve; secaudit 2026-10-10 I6).
 */
export function newRoundBinding(): { value: string; hash: string } {
  const value = randomBytes(32).toString('base64url');
  return { value, hash: bindingHash(value) };
}

/**
 * Set the binding cookie for `state` to `value`, scoped to `callbackPath` for `ttlMs`. `sameSite`
 * 'none' is for a callback the provider reaches with a cross-site form POST (the SAML ACS), which a
 * Lax cookie does not ride; browsers take None only with Secure, so it always carries Secure.
 */
export function setRoundBinding(
  req: Request, res: Response, state: string, callbackPath: string, ttlMs: number, value: string,
  sameSite: 'lax' | 'none' = 'lax', host = false,
): void {
  res.cookie(cookieName(state, host), value, {
    httpOnly: true, secure: host || sameSite === 'none' || cookieSecure(req), sameSite, path: host ? '/' : callbackPath, maxAge: ttlMs,
  });
}

/** The binding value this request carries for `state` (the `__Host-` cookie when `host`), or ''. */
export function readRoundBinding(req: Request, state: string, host = false): string {
  const header = req.headers.cookie;
  if (!header) return '';
  const name = cookieName(state, host);
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
export function clearRoundBinding(
  req: Request, res: Response, state: string, callbackPath: string, sameSite: 'lax' | 'none' = 'lax', host = false,
): void {
  if (host) {
    res.clearCookie(cookieName(state, true), { httpOnly: true, secure: true, sameSite, path: '/' });
    return;
  }
  res.clearCookie(cookieName(state), { httpOnly: true, secure: sameSite === 'none' || cookieSecure(req), sameSite, path: callbackPath });
}
