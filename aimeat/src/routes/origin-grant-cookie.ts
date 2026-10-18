/**
 * @file src/routes/origin-grant-cookie.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The access grant on a session-less origin moves from the address to a cookie (plan
 *   doc-mvcn6c7e4e5q, V2 and V3.10).
 *
 *   An app that needs a sign-in or an access code, a welcome page and a company page with restricted
 *   access are opened on their own origin with `?access=<grant>` (services/app-access-token.ts, one
 *   hour). Served as-is, the grant stayed in the address bar: a person who copied or bookmarked the
 *   address handed the next person an hour of access with no sign-in. So the origin accepts the query
 *   grant on the first request only. It verifies the grant, sets it as a cookie and answers 302 to the
 *   same address without `access`. Every later request on that origin carries the cookie, and the
 *   origin verifies it exactly as it verifies the query grant (same signature, `typ`, app or page,
 *   expiry).
 *
 *   The cookie: host-only (no Domain attribute, so no other origin of the app family receives it),
 *   HttpOnly, Secure when the node's base URL is https, SameSite=Lax, Max-Age the grant's remaining
 *   lifetime. Path `/` on an app's or a page's own origin; on the shared app host (`apps.<apex>/<owner>/<file>`,
 *   served there only when no per-app subdomain can be assigned) the path names the one app. A cookie
 *   that does not verify is cleared, and the request continues as one with no grant.
 * @structure APP_ACCESS_COOKIE · PAGE_ACCESS_COOKIE · originGrant() · moveGrantToCookie()
 * @usage
 *   const g = await originGrant(req, res, config, { cookie: APP_ACCESS_COOKIE, path: '/', verify: t => appAccessGranted(t, owner, file) });
 *   if (g === 'answered') return;          // the 302 to the clean address went out
 *   if (g === 'refused') return notFound(); // no usable grant in the query or the cookie
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial.
 */
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import { grantExpiresAt } from '../services/app-access-token.js';
import { logger } from '../utils/logger.js';

/** The cookie that carries an app-access grant on the app's own origin. */
export const APP_ACCESS_COOKIE = 'aimeat_app_access';
/** The cookie that carries a page-access grant on a welcome-page or company origin. */
export const PAGE_ACCESS_COOKIE = 'aimeat_page_access';

/** One kind of grant on one origin: the cookie name, its path, and the check the query grant gets. */
export interface OriginGrantSpec {
  cookie: string;
  path: string;
  verify: (token: unknown) => Promise<boolean>;
}

/**
 * - `granted`: the request carries a valid grant in the cookie (or, with `moveToCookie: false`, in
 *   the query); serve it.
 * - `answered`: a 302 to the address without `access` went out; the caller stops.
 * - `refused`: no valid grant in the query or the cookie; the caller answers as for no grant.
 */
export type OriginGrantOutcome = 'granted' | 'answered' | 'refused';

function cookieOptions(config: AimeatConfig, path: string) {
  // No `domain`: a host-only cookie reaches only the origin that set it, never a sibling app origin.
  return { httpOnly: true, secure: config.baseUrl.startsWith('https:'), sameSite: 'lax' as const, path };
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1 || part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      // A malformed cookie is no grant; the caller clears it like any other that fails to verify.
      logger.warn('origin grant: a grant cookie could not be decoded and is treated as absent', { cookie: name });
      return '';
    }
  }
  return null;
}

/**
 * The request's own path and query with every `access` parameter removed. Only the path and the
 * query are kept, and leading slashes collapse to one, so the Location is always a path on this
 * origin and never a protocol-relative address to another host.
 */
function addressWithoutAccess(req: Request): string {
  const url = new URL(req.originalUrl, 'http://origin.invalid');
  url.searchParams.delete('access');
  const path = '/' + url.pathname.replace(/^\/+/, '');
  return `${path}${url.search}`;
}

/**
 * Set `grant` (already verified by the caller) as the origin's grant cookie and answer 302 to the
 * request's address without `access`. no-store, as for every other step of an unlock: a cached copy
 * of the hop would replay a grant that has since expired.
 */
export function moveGrantToCookie(req: Request, res: Response, config: AimeatConfig, spec: Pick<OriginGrantSpec, 'cookie' | 'path'>, grant: string): void {
  const exp = grantExpiresAt(grant);
  const remainingMs = exp === null ? 0 : exp * 1000 - Date.now();
  if (remainingMs > 0) res.cookie(spec.cookie, grant, { ...cookieOptions(config, spec.path), maxAge: remainingMs });
  res.setHeader('Cache-Control', 'no-store');
  res.redirect(302, addressWithoutAccess(req));
}

/**
 * The origin's whole grant check. A valid query grant is moved to the cookie (302, `answered`)
 * unless `moveToCookie` is false, when the caller forwards the query itself. Without one, a valid
 * cookie grants; a request that still carries a stale `access` beside a valid cookie is sent to the
 * clean address too. A cookie that fails to verify is cleared.
 */
export async function originGrant(
  req: Request, res: Response, config: AimeatConfig, spec: OriginGrantSpec, opts: { moveToCookie?: boolean } = {},
): Promise<OriginGrantOutcome> {
  const query = req.query.access;
  if (query !== undefined && await spec.verify(query)) {
    if (opts.moveToCookie === false) return 'granted';
    moveGrantToCookie(req, res, config, spec, query as string);
    return 'answered';
  }
  const cookie = readCookie(req, spec.cookie);
  if (cookie === null) return 'refused';
  if (!(await spec.verify(cookie))) {
    res.clearCookie(spec.cookie, cookieOptions(config, spec.path));
    return 'refused';
  }
  if (query !== undefined && opts.moveToCookie !== false) {
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, addressWithoutAccess(req));
    return 'answered';
  }
  return 'granted';
}
