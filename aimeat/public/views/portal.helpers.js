/**
 * @file public/views/portal.helpers.js
 * @description Portal auth/session + time helpers. Extracted from portal.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from views/portal.js (max-file-lines)
 */

/* ══════════════════════════════════════════════
   AUTH HELPERS
   ══════════════════════════════════════════════ */
export function hasAuth() {
  return typeof AIMEAT !== 'undefined' && AIMEAT.auth && typeof AIMEAT.auth.getSession === 'function';
}
export function getCurrentSession() {
  if (!hasAuth()) return null;
  const s = AIMEAT.auth.getSession();
  return (s && (s.jwt || s.valid)) ? s : null;
}
export function sessionDisplayName(s) {
  return s ? (s.owner || s.ghii || 'user') : '';
}

/* ══════════════════════════════════════════════
   TIME HELPER
   ══════════════════════════════════════════════ */
export function timeAgo(iso) {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return sec + 's';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + 'm';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h';
  return Math.floor(hr / 24) + 'd';
}
