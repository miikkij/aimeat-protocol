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

  // Attach auth token if available
  if (window.AIMEAT?.auth?.hasSession) {
    const session = window.AIMEAT.auth.getSession();
    if (session?.jwt) {
      headers['Authorization'] = 'Bearer ' + session.jwt;
    }
  }

  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(path, { ...opts, headers });
      if (resp.status === 429 || (resp.status >= 500 && attempt < MAX_RETRIES)) {
        await sleep(RETRY_BASE_MS * Math.pow(2, attempt));
        continue;
      }
      return resp.json();
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_MS * Math.pow(2, attempt));
        continue;
      }
    }
  }
  return { ok: false, error: { code: 'NETWORK_ERROR', message: lastError?.message || 'Request failed' } };
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
