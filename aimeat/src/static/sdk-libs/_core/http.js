/**
 * @file http.js
 * @description Shared SDK-libs core — the envelope-aware fetch helpers every library rolled its
 *   own copy of. `api()` performs a JSON fetch against the resolved node URL, unwraps the AIMEAT
 *   response envelope, and — critically — preserves the machine-readable `err.code` / `err.details`
 *   on the thrown Error (the sign-in modal branches on `EMAIL_NOT_VERIFIED` etc. rather than
 *   matching on message text). `authApi()` adds a bearer token. Behavior is identical to the
 *   `api()` / `authApi()` that lived inline in auth-lib-part1.
 * @structure api(path, opts) · authApi(path, jwt, opts)
 * @usage import { api, authApi } from '../_core/http.js';
 * @version-history
 *   v1.0.0 — 2026-07-19 — Initial: extracted from the per-lib inline fetch helpers (SDK-libs migration Phase 0).
 */
import { NODE_URL } from './config.js';

/**
 * An Error carrying the envelope's machine-readable code + details.
 * @typedef {Error & { code?: string, details?: unknown }} ApiError
 */

/**
 * Fetch `path` on the node, parse the JSON envelope, throw on `!ok` (preserving code/details).
 * @param {string} path                 Path beginning with `/` (joined onto NODE_URL).
 * @param {RequestInit} [opts]          Standard fetch options; JSON content-type is added.
 * @returns {Promise<any>}              The full parsed envelope (`{ ok, data, error, … }`).
 */
export async function api(path, opts = {}) {
  const url = NODE_URL + path;
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  const resp = await fetch(url, { ...opts, headers });
  const data = await resp.json();
  if (!data.ok) {
    // Preserve the machine-readable code + details on the thrown Error so callers can branch
    // (e.g. EMAIL_NOT_VERIFIED → open the email-completion flow) instead of matching on text.
    const err = /** @type {ApiError} */ (new Error(data.error?.message || 'API error'));
    err.code = data.error?.code;
    err.details = data.error?.details;
    throw err;
  }
  return data;
}

/**
 * As {@link api}, with an `Authorization: Bearer <jwt>` header.
 * @param {string} path
 * @param {string} jwt
 * @param {RequestInit} [opts]
 * @returns {Promise<any>}
 */
export async function authApi(path, jwt, opts = {}) {
  return api(path, { ...opts, headers: { ...opts.headers, 'Authorization': 'Bearer ' + jwt } });
}
