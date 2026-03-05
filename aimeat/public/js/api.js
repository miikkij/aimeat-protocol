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
export async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };

  // Attach auth token if available
  if (window.AIMEAT?.auth?.hasSession) {
    const session = window.AIMEAT.auth.getSession();
    if (session?.jwt) {
      headers['Authorization'] = 'Bearer ' + session.jwt;
    }
  }

  const resp = await fetch(path, { ...opts, headers });
  return resp.json();
}

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

/** DELETE shorthand. */
export function apiDelete(path) {
  return api(path, { method: 'DELETE' });
}
