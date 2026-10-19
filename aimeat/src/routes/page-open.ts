/**
 * @file src/routes/page-open.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Opening a welcome page or a company front page that needs a sign-in (plan
 *   doc-mvcn6c7e4e5q, V3.10). The same flow an app has (routes/apps/open.ts, routes/subdomain-app-gate.ts):
 *
 *   - pageOriginRefused(): the page origin (`<user>.portfolio.<apex>`, `<slug>.co.<apex>`) holds no
 *     session, so a page whose `access` needs a sign-in is served there only against a page grant
 *     (services/app-access-token.ts pageAccessGranted), taken from the query once and from the
 *     origin's grant cookie after that (routes/origin-grant-cookie.ts). A browser without one goes to /v1/app-open,
 *     the SPA page that holds the session; every other caller gets the origin's uniform 404.
 *   - answerPageOpen(): POST /v1/portfolio/:username/open (routes/portfolio.ts) and
 *     POST /v1/companies/:id/open (routes/companies.ts) check that the signed-in person may open the
 *     page and answer `{ url, expires_in }`: the page origin with a one-hour grant naming this page.
 *
 *   Neither imports the route file that calls it, so the two routers share this without an import cycle.
 * @structure pageOriginRefused · answerPageOpen
 * @usage
 *   if (await pageOriginRefused(req, res, config, { kind: 'portfolio', owner: sub }, access, notFound)) return;
 *   await answerPageOpen(req, res, config, storage, { ref, access, ownerName, url });
 * @version-history
 *   v1.2.0 — 2026-10-19 — The page grant carries the sign-in session it came from, so it stops opening
 *     the page when the person signs out (services/app-access-token.ts).
 *   v1.1.0 — 2026-10-18 — SECURITY: the page origin accepts `?access=` once, sets it as the host-only
 *     `aimeat_page_access` cookie and answers 302 to the address without it, so a copied address
 *     carries no grant; later requests are granted by the cookie (routes/origin-grant-cookie.ts). The
 *     grant answerPageOpen mints names the signed-in person as `viewer`.
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V3.10).
 */
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { isNodeAccount } from '../services/audience.js';
import { isSameAccount } from '../utils/same-account.js';
import { pageNeedsSignIn, mayOpenPage, pageOpenPath } from '../services/page-access.js';
import {
  APP_ACCESS_TTL_SECONDS, generatePageAccessToken, pageAccessGranted, type PageRef,
} from '../services/app-access-token.js';
import { resolveIdentity } from '../utils/gaii.js';
import { originGrant, PAGE_ACCESS_COOKIE } from './origin-grant-cookie.js';

/**
 * The page origin's gate. Answers true when it has already answered the request: a browser
 * navigation without a usable grant is sent to the open page, anything else gets `notFound()`.
 * A page open to anyone, or a request carrying a grant for exactly this page, passes (false).
 */
export async function pageOriginRefused(
  req: Request, res: Response, config: AimeatConfig, ref: PageRef, access: unknown, notFound: () => void,
): Promise<boolean> {
  if (!pageNeedsSignIn(config, access)) return false;
  // The query grant is accepted once and moved to a host-only cookie, with a 302 to the address
  // without it (routes/origin-grant-cookie.ts); later requests are granted by the cookie.
  const grant = await originGrant(req, res, config, { cookie: PAGE_ACCESS_COOKIE, path: '/', verify: t => pageAccessGranted(t, ref) });
  if (grant === 'granted') return false;
  if (grant === 'answered') return true;
  if ((req.headers.accept ?? '').includes('text/html')) {
    // no-store: this address is a step in opening the page, and a cached copy would send the next
    // visit somewhere it no longer belongs.
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, `${config.baseUrl}${pageOpenPath(ref)}`);
    return true;
  }
  notFound();
  return true;
}

/**
 * The open route's answer, after the route found the page. The page's owner always passes; anyone
 * else passes the page's `access` (services/page-access.ts mayOpenPage). `url` is the page origin's
 * address, or null when the node serves the page on no origin of its own: then `apexUrl`, a page the
 * SPA reads with the person's session, is answered without a grant, and without it the answer is 404.
 */
export async function answerPageOpen(
  req: Request, res: Response, config: AimeatConfig, storage: Storage,
  page: { ref: PageRef; access: unknown; ownerName: string; url: string | null; apexUrl?: string },
): Promise<void> {
  const isOwner = isNodeAccount(req.auth) && isSameAccount(req.auth!.owner, page.ownerName);
  if (!isOwner && !(await mayOpenPage(storage, config, page.access, req.auth))) {
    res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'This page opens for the people its owner chose, and you are not among them.'));
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  if (!page.url) {
    if (!page.apexUrl) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'This page has no address on this node.'));
      return;
    }
    res.json(success(config.nodeId, { url: page.apexUrl, expires_in: null }));
    return;
  }
  // The grant names the person it was handed to (`viewer`); the page origin still authorizes on the page alone.
  const grant = await generatePageAccessToken(page.ref, APP_ACCESS_TTL_SECONDS, resolveIdentity(req.auth!, config.nodeId), req.auth!.sessionId);
  const sep = page.url.includes('?') ? '&' : '?';
  res.json(success(config.nodeId, { url: `${page.url}${sep}access=${encodeURIComponent(grant)}`, expires_in: APP_ACCESS_TTL_SECONDS }));
}
