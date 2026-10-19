/**
 * @file closed-node-fetch.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description On a node that shows its content to its own signed-in accounts only (js/site.js
 *   signedInOnly), every same-origin request the SPA makes carries the session.
 *
 *   WHY. Many views read what is public on an open node with a plain fetch and no credential: the
 *   app store and the front page (/v1/apps, /v1/public/node-totals, /v1/site/store-tiers), the help,
 *   glossary and transparency pages, the build story, the agents tab, the app guide, the knowledge
 *   viewer, appcat's data map. On a signed-in-only node the content access gate
 *   (middleware/content-access-gate.ts) refuses every such request with 401, so a SIGNED-IN person
 *   saw an empty store and empty pages (found 2026-10-19 by the signed-in browser audit,
 *   scripts/check-signed-in-browser.mjs). Here, once, the session goes on those requests; on an open
 *   node nothing changes.
 *
 *   WHAT IT TOUCHES. Same-origin requests only, so the session never reaches another origin, and not
 *   /v1/auth/*, whose rounds the auth lib runs with its own credential. A request that already names
 *   an Authorization header keeps it.
 * @structure carriesSession(url, origin) · withSession(fetchFn, jwtOf, origin) · install (side effect)
 * @usage import '/js/closed-node-fetch.js';   // spa.html's main module, before any view loads
 * @version-history
 *   v1.0.0 — 2026-10-19 — Initial.
 */
import { signedInOnly } from '/js/site.js';
import { getSession } from '/js/services/auth.js';

/**
 * Whether a request to `url` gets the session: same origin, and not one of the auth lib's own rounds.
 * @param {string} url
 * @param {string} origin
 * @returns {boolean}
 */
export function carriesSession(url, origin) {
  // An address that does not parse goes out as it was, without the session.
  if (!URL.canParse(url, origin)) return false;
  const u = new URL(url, origin);
  return u.origin === origin && !u.pathname.startsWith('/v1/auth/');
}

/**
 * A fetch that adds `Authorization: Bearer <jwt>` to the requests carriesSession() names, while a
 * session exists.
 * @param {typeof fetch} fetchFn
 * @param {() => string|null|undefined} jwtOf
 * @param {string} origin
 * @returns {typeof fetch}
 */
export function withSession(fetchFn, jwtOf, origin) {
  return function sessionFetch(input, init) {
    const jwt = jwtOf();
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input?.url);
    if (!jwt || !url || !carriesSession(url, origin)) return fetchFn(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (headers.has('Authorization')) return fetchFn(input, init);
    headers.set('Authorization', `Bearer ${jwt}`);
    return fetchFn(input, { ...init, headers });
  };
}

if (typeof window !== 'undefined' && signedInOnly() && !window.__aimeatSessionFetch) {
  window.__aimeatSessionFetch = true;
  window.fetch = withSession(window.fetch.bind(window), () => getSession()?.jwt, window.location.origin);
}
