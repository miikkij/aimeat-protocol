/**
 * @file public/js/api.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Session-aware fetch wrapper for AIMEAT /v1/* endpoints. Attaches (and refreshes) the
 *   JWT from the auth session, parses the AIMEAT response envelope, throws on `ok:false`, and retries
 *   failed reads with exponential backoff. Writes are never automatically retried after an
 *   ambiguous failure; POST/PUT carry a per-call idempotency key.
 *
 * @structure
 *   - api(path, opts): core call — auth injection, timeout, 401-refresh, retry loop, envelope handling
 *   - apiGet/apiPost/apiPut/apiPatch/apiDelete: HTTP-method shorthands over api()
 *   - parseJwtPayload/sleep: internal helpers (unverified JWT expiry check, backoff delay)
 *
 * @version-history
 *   v1.3.0 -- 2026-09-16 -- Read-only transport retries, POST/PUT request keys, and credential
 *     refresh independent of the retry budget. Preserve the original server error.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 *   v1.1.0 — 2026-08-07 — Reads the session through /js/services/auth.js (single session source)
 *   v1.2.0 — 2026-08-17 — apiGetText for text/plain endpoints (/v1/metrics): non-JSON success
 *     bodies return as a string; JSON error envelopes still parse and throw
 */
import { getSession } from '/js/services/auth.js';

/**
 * Make an authenticated API call.
 * Automatically attaches JWT if a session exists.
 * Returns the parsed AIMEAT envelope: { ok, data, hints }
 * Throws on error responses (ok: false) with err.message from the server.
 */
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;

export async function api(path, opts = {}) {
  const headers = new Headers(opts.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const method = (opts.method || 'GET').toUpperCase();
  if ((method === 'POST' || method === 'PUT') && !headers.has('Idempotency-Key')) {
    headers.set('Idempotency-Key', requestKey());
  }

  // Attach auth token — refresh if expired
  const session = getSession();
  if (session?.jwt) {
    // If session has refresh() and token looks expired, refresh first
    if (typeof session.refresh === 'function') {
      try {
        const payload = parseJwtPayload(session.jwt);
        if (payload?.exp && Date.now() / 1000 > payload.exp - 60) {
          await session.refresh();
        }
      } catch (e) { console.warn('JWT parse/refresh failed, proceeding:', e.message); }
    }
    headers.set('Authorization', 'Bearer ' + session.jwt);
  }

  // Per-call timeout override (ms) — default 30s; long-running calls (e.g. AI completion on a
  // slow model) pass a larger value. Don't raise the global default — failed normal calls would hang.
  const timeoutMs = opts.timeoutMs || 30_000;
  // A timeout, network error or 5xx does not prove a write failed. The server's replay cache is
  // process-local, so even a key cannot make automatic write retries safe across a restart.
  const readOnly = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
  const maxRetries = readOnly ? (opts.retries != null ? opts.retries : MAX_RETRIES) : 0;

  let refreshed = false;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let resp = await fetch(path, { ...opts, method, headers, signal: controller.signal });

      // On 401, try refreshing token once and retry
      if (resp.status === 401 && !refreshed) {
        const live = getSession();
        if (live?.refresh) {
          refreshed = true;
          let renewed = false;
          try {
            await live.refresh();
            headers.set('Authorization', 'Bearer ' + live.jwt);
            renewed = true;
          } catch (e) { console.warn('Token refresh failed:', e.message); }
          if (renewed && !controller.signal.aborted) {
            resp = await fetch(path, { ...opts, method, headers, signal: controller.signal });
          }
        }
      }

      if ((resp.status === 429 || resp.status >= 500) && attempt < maxRetries) {
        await sleep(RETRY_BASE_MS * Math.pow(2, attempt));
        continue;
      }
      // Raw-text mode: a non-JSON success body (e.g. Prometheus text at /v1/metrics)
      // returns as a string; a JSON body falls through to envelope handling so error
      // responses still parse and throw with their code and message.
      if (opts.rawText) {
        const ct = resp.headers.get('content-type') || '';
        if (!ct.includes('json')) return await resp.text();
      }
      const json = await resp.json();
      if (json && json.ok === false && json.error) {
        const err = new Error(json.error.message || json.error.code || 'Request failed');
        err.code = json.error.code;
        err.status = resp.status;
        err.response = json;
        throw err;
      }
      return json;
    } catch (err) {
      if (err.name === 'AbortError') {
        if (attempt === maxRetries) throw new Error('Request timed out after ' + Math.round(timeoutMs / 1000) + 's', { cause: err });
        continue;
      }
      // Don't retry client errors (4xx) — only retry network/server errors
      if (err.status && err.status >= 400 && err.status < 500) throw err;
      if (attempt < maxRetries) {
        await sleep(RETRY_BASE_MS * Math.pow(2, attempt));
        continue;
      }
      if (!err.status && !err.code) err.code = 'NETWORK_ERROR';
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw new Error('Request failed');
}

/** UUID v4 also works on an HTTP LAN node, where randomUUID is not exposed by the browser. */
function requestKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Parse JWT payload without verification (for expiry check only) */
function parseJwtPayload(jwt) {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  // eslint-disable-next-line aimeat/no-silent-catch -- a browser API refusing here IS the answer
  } catch { return null; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** GET shorthand. */
export function apiGet(path) {
  return api(path, { method: 'GET' });
}

/** GET shorthand for text/plain endpoints — resolves to the raw body string. */
export function apiGetText(path) {
  return api(path, { method: 'GET', rawText: true });
}

/** POST shorthand. */
export function apiPost(path, body) {
  return api(path, { method: 'POST', body: JSON.stringify(body) });
}

/** PUT shorthand. */
export function apiPut(path, body) {
  return api(path, { method: 'PUT', body: JSON.stringify(body) });
}

/** PATCH shorthand. */
export function apiPatch(path, body) {
  return api(path, { method: 'PATCH', body: JSON.stringify(body) });
}

/** DELETE shorthand. Forwards an optional request body (e.g. `{ target }`). */
export function apiDelete(path, body) {
  return api(path, body === undefined
    ? { method: 'DELETE' }
    : { method: 'DELETE', body: JSON.stringify(body) });
}
