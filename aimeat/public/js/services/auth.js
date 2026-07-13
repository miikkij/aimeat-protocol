/**
 * @file public/js/services/auth.js
 * @description Centralized frontend auth/session service wrapping window.AIMEAT.auth —
 *   provides session lookups, profile read/update, password change, and auth-change subscription.
 *
 * @structure
 *   - getSession/hasSession/getOwner/getGhii/getNodeUrl: read the active session
 *   - getProfile/updateProfile: fetch and PUT the current user's GHII profile
 *   - changePassword: POST a password change for the logged-in owner
 *   - onAuthChange: subscribe to aimeat-auth-change events, returns unsubscribe
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */

/**
 * AIMEAT Auth Service
 * Centralized session/auth access — replaces direct window.AIMEAT.auth usage.
 */

/** Get current auth session, or null if not logged in. */
export function getSession() {
  const a = window.AIMEAT?.auth;
  if (!a || typeof a.getSession !== 'function') return null;
  const s = a.getSession();
  return (s && s.jwt) ? s : null;
}

/** Check if a session is active. */
export function hasSession() {
  return getSession() !== null;
}

/** Get owner name from session. */
export function getOwner() {
  return getSession()?.owner || null;
}

/** Get GHII from session. */
export function getGhii() {
  const s = getSession();
  return s?.ghii || (s?.owner ? s.owner + '@unknown' : null);
}

/** Get the node URL (current origin). */
export function getNodeUrl() {
  return typeof window !== 'undefined' ? window.location.origin : '';
}

/** Fetch the current user's own profile (includes private fields like email). */
export async function getProfile() {
  const s = getSession();
  if (!s) return null;
  return s.fetch('/v1/ghii/me');
}

/** Update the current user's profile via PUT /v1/ghii. */
export async function updateProfile(fields) {
  const s = getSession();
  if (!s) throw new Error('Not logged in');
  return s.fetch('/v1/ghii', { method: 'PUT', body: JSON.stringify(fields) });
}

/** Change the current user's password via POST /v1/ghii/password/change. */
export async function changePassword(currentPassword, newPassword) {
  const s = getSession();
  if (!s) throw new Error('Not logged in');
  return s.fetch('/v1/ghii/password/change', {
    method: 'POST',
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
}

/** Listen for auth state changes. Returns unsubscribe function. */
export function onAuthChange(callback) {
  const handler = () => callback(getSession());
  window.addEventListener('aimeat-auth-change', handler);
  return () => window.removeEventListener('aimeat-auth-change', handler);
}
