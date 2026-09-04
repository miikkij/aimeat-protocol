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
 * @structure api(path, opts) · authApi(path, jwt, opts)
 * @usage import { api } from './http.js';
 * @version-history
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
