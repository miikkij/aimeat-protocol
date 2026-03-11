/**
 * AIMEAT API Module
 * Session-aware fetch wrapper for AIMEAT /v1/* endpoints.
 * Relies on aimeat-auth.js being loaded for session management.
 */

/**
 * Make an authenticated API call.
 * Automatically attaches JWT if a session exists.
 * Returns the parsed AIMEAT envelope: { ok, data, error, hints }
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
        } catch (_) { /* proceed with current token */ }
      }
      headers['Authorization'] = 'Bearer ' + session.jwt;
    }
  }

  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(path, { ...opts, headers });

      // On 401, try refreshing token once and retry
      if (resp.status === 401 && attempt === 0) {
        const session = window.AIMEAT?.auth?.getSession?.();
        if (session?.refresh) {
          try {
            await session.refresh();
            headers['Authorization'] = 'Bearer ' + session.jwt;
            continue;
          } catch (_) { /* refresh failed, return 401 */ }
        }
      }

      if (resp.status === 429 || (resp.status >= 500 && attempt < MAX_RETRIES)) {
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
      // Don't retry client errors (4xx) — only retry network/server errors
      if (err.status && err.status >= 400 && err.status < 500) throw err;
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_MS * Math.pow(2, attempt));
        continue;
      }
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

/** DELETE shorthand. */
export function apiDelete(path) {
  return api(path, { method: 'DELETE' });
}
