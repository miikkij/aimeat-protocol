/**
 * @file public-fetch.js
 * @description Shared SDK-libs core: a read of what is public on an open node, which also works on a
 *   node that shows its content to its own signed-in accounts only.
 *
 *   The libs read an app's config, its WebMCP manifest, a public record, the product feed and the
 *   like with a plain fetch and no credential, because on an open node anyone may read them. A
 *   signed-in-only node answers such a read 401 SIGN_IN_REQUIRED (middleware/content-access-gate.ts),
 *   so an app opened by a SIGNED-IN person lost its config and its tools (signed-in browser audit,
 *   2026-10-19). publicFetch() sends the read as before; when the node answers SIGN_IN_REQUIRED and
 *   the page has a session, it sends it again with the session, and from then on it sends the
 *   session first. On an open node nothing changes: the first answer is never that refusal.
 * @structure publicFetch(url, init)
 * @usage import { publicFetch } from '../_core/public-fetch.js'; const r = await publicFetch(NODE_URL + '/v1/commerce/feed');
 * @version-history
 *   v1.0.0 — 2026-10-19 — Initial.
 */

/** Learned from the node's own answer: it refuses a read without a session. */
let signedInOnly = false;

/** The page's session token, or null when nobody is signed in or aimeat-auth.js is absent. */
function sessionJwt() {
  const auth = typeof window !== 'undefined' && window.AIMEAT && window.AIMEAT.auth;
  const s = auth && typeof auth.getSession === 'function' ? auth.getSession() : null;
  return (s && s.jwt) || null;
}

/**
 * @param {RequestInit} init
 * @param {string} jwt
 * @returns {RequestInit}
 */
function withSession(init, jwt) {
  const headers = new Headers(init.headers);
  headers.set('Authorization', 'Bearer ' + jwt);
  return { ...init, headers };
}

/**
 * fetch() for a public read: the session goes along only where the node asks for one.
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
export async function publicFetch(url, init = {}) {
  const early = signedInOnly ? sessionJwt() : null;
  const r = await fetch(url, early ? withSession(init, early) : init);
  if (r.status !== 401 || early) return r;
  if (!(r.headers.get('content-type') || '').includes('json')) return r;
  const body = await r.clone().json();
  if (!body || !body.error || body.error.code !== 'SIGN_IN_REQUIRED') return r;
  signedInOnly = true;
  const jwt = sessionJwt();
  return jwt ? fetch(url, withSession(init, jwt)) : r;
}
