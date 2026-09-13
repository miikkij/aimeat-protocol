/**
 * @file auth/http.js
 * @description The two fetch helpers every part of aimeat-auth calls: one for this node's API, one
 *   for the same with a bearer token. They hold no session state and read nothing but the node's
 *   address, which is why they can sit at the bottom of the import graph.
 *
 *   PURE EXTRACTION from session.js on 2026-09-04. They lived there because everything else did,
 *   and that made a cycle the moment a module needed BOTH the helpers and a place in session.js's
 *   own API: passkey.js imports api/authApi, and session.js imports passkey.js to expose
 *   signInWithPasskey. Moving the two functions to a leaf breaks it. session.js still re-exports
 *   them, so every existing `import { api } from './session.js'` is untouched.
 *
 * @structure api(path, opts) · authApi(path, jwt, opts) · sessionHeaders(given, jwt, body)
 * @usage import { api } from './http.js';
 * @version-history
 *   v1.1.0 — 2026-09-13 — sessionHeaders: the one header merge behind every session's fetch, by name
 *     rather than by object key, so a caller's lower-case content-type no longer doubles the header
 *     and empties req.body, a Headers instance is kept, and a FormData body keeps its own type.
 *   v1.0.0 — 2026-09-04 — Extracted verbatim from auth/session.js.
 */
import { NODE_URL } from './config.js';

export async function api(path, opts = {}) {
  const url = NODE_URL + path;
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  const resp = await fetch(url, { ...opts, headers });
  const data = await resp.json();
  if (!data.ok) {
    // Preserve the machine-readable code + details on the thrown Error so callers can branch
    // (e.g. EMAIL_NOT_VERIFIED → open the email-completion flow) instead of matching on text.
    const err = /** @type {Error & { code?: string, details?: unknown }} */ (new Error(data.error?.message || 'API error'));
    err.code = data.error?.code;
    err.details = data.error?.details;
    throw err;
  }
  return data;
}

export async function authApi(path, jwt, opts = {}) {
  return api(path, { ...opts, headers: { ...opts.headers, 'Authorization': 'Bearer ' + jwt } });
}

/**
 * The headers for a request made through a session's own fetch, merged the way the browser merges
 * them: by name, whatever the casing.
 *
 * They used to be an object spread, `{ 'Content-Type': …, Authorization: …, ...opts.headers }`, and
 * that shape broke three ways. A caller's `content-type` in lower case became a SECOND key, which
 * the browser joined into `application/json, application/json`; express.json() does not recognise
 * that type, so the route saw an empty body and failed as if the payload were wrong (appdev pitfall
 * session-fetch-no-own-content-type). A Headers instance spread to `{}` and was dropped whole. And a
 * FormData or Blob body went out labelled as JSON, which takes the multipart boundary away.
 *
 * What stays the same: a caller's own Authorization or Content-Type wins, as it did for the exact
 * spelling, and a request with a string body or no body still carries `application/json`.
 *
 * @param {any} given The caller's headers: a plain object in any casing, a Headers, or entries.
 * @param {string} jwt
 * @param {unknown} body
 * @returns {Headers}
 */
export function sessionHeaders(given, jwt, body) {
  const headers = new Headers(given || undefined);
  if (!headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + jwt);
  if (!headers.has('Content-Type') && (body == null || typeof body === 'string')) {
    headers.set('Content-Type', 'application/json');
  }
  return headers;
}
