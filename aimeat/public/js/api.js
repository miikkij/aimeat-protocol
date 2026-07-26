/**
 * @file public/js/api.js
 * @description Session-aware fetch wrapper for AIMEAT /v1/* endpoints. Attaches (and refreshes) the
 *   JWT from the auth session, parses the AIMEAT response envelope, throws on `ok:false`, and retries
 *   429/5xx/network failures with exponential backoff and a per-call timeout/retry override.
 *
 * @structure
 *   - api(path, opts): core call — auth injection, timeout, 401-refresh, retry loop, envelope handling
 *   - apiGet/apiPost/apiPut/apiPatch/apiDelete: HTTP-method shorthands over api()
 *   - parseJwtPayload/sleep: internal helpers (unverified JWT expiry check, backoff delay)
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */

/**
 * Make an authenticated API call.
 * Automatically attaches JWT if a session exists.
 * Returns the parsed AIMEAT envelope: { ok, data, hints }
 * Throws on error responses (ok: false) with err.message from the server.
 */
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;

export async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };

  // Attach auth token — refresh if expired
  if (window.AIMEAT?.auth?.hasSession) {
    const session = window.AIMEAT.auth.getSession();
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
      headers['Authorization'] = 'Bearer ' + session.jwt;
    }
  }

  // Per-call timeout override (ms) — default 30s; long-running calls (e.g. AI completion on a
  // slow model) pass a larger value. Don't raise the global default — failed normal calls would hang.
  const timeoutMs = opts.timeoutMs || 30_000;
  // Per-call retry override — a long AI call passes 0 so a timeout doesn't re-run the slow request.
  const maxRetries = opts.retries != null ? opts.retries : MAX_RETRIES;

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(path, { ...opts, headers, signal: controller.signal });

      // On 401, try refreshing token once and retry
      if (resp.status === 401 && attempt === 0) {
        const session = window.AIMEAT?.auth?.getSession?.();
        if (session?.refresh) {
          try {
            await session.refresh();
            headers['Authorization'] = 'Bearer ' + session.jwt;
            continue;
          } catch (e) { console.warn('Token refresh failed:', e.message); }
        }
      }

      if (resp.status === 429 || (resp.status >= 500 && attempt < maxRetries)) {
        await sleep(RETRY_BASE_MS * Math.pow(2, attempt));
        continue;
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
      lastError = err;
      if (attempt < maxRetries) {
        await sleep(RETRY_BASE_MS * Math.pow(2, attempt));
        continue;
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }
  const err = new Error(lastError?.message || 'Request failed');
  err.code = 'NETWORK_ERROR';
  throw err;
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
