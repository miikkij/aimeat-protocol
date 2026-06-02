/**
 * @file format.js
 * @description Canonical display formatters shared across the frontend (number,
 *   date/time, uptime, bytes). Previously these lived only in admin/shared.js and
 *   ~29 profile views hand-inlined `.toLocaleString()` — this is the single home so
 *   formatting stays consistent and new views import instead of reinventing.
 * @structure num, dt, fmtUp, fmtBytes
 * @usage import { num, dt } from '/js/format.js';
 *   num(1234)            → "1,234"      (locale grouped; non-numbers passed through)
 *   dt('2026-01-02T…')   → locale date-time string
 *   fmtUp(90061)         → "1d 1h 1m"   (uptime seconds → human)
 *   fmtBytes(2048)       → "2.0 KB"
 * @version-history
 *   v1.0.0 — 2026-06-02 — Component unification (#12): promote admin's num/dt/fmtUp/
 *     fmtBytes to a shared module; admin/shared.js now re-exports from here.
 */

/** Format a number with locale grouping; non-numbers pass through (nullish → em dash). */
export function num(n) {
  return typeof n === 'number' ? n.toLocaleString() : String(n ?? '—');
}

/** Format an ISO date string as a locale date-time (nullish → em dash). */
export function dt(s) {
  return s ? new Date(s).toLocaleString() : '—';
}

/** Format uptime seconds as a human-readable "Nd Nh Nm" (sub-minute → "<1m"). */
export function fmtUp(s) {
  const d = Math.floor(s / 86400);
  const hr = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return (d ? d + 'd ' : '') + (hr ? hr + 'h ' : '') + (m ? m + 'm' : '<1m');
}

/** Format a byte count as B / KB / MB. */
export function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}
