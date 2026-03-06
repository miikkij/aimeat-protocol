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

/** Listen for auth state changes. Returns unsubscribe function. */
export function onAuthChange(callback) {
  const handler = () => callback(getSession());
  window.addEventListener('aimeat-auth-change', handler);
  return () => window.removeEventListener('aimeat-auth-change', handler);
}
