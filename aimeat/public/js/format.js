/**
 * @file format.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Canonical display formatters shared across the frontend (number,
 *   date/time, uptime, bytes). Previously these lived only in admin/shared.js and
 *   ~29 profile views hand-inlined `.toLocaleString()` — this is the single home so
 *   formatting stays consistent and new views import instead of reinventing.
 * @structure num, dt, day, fmtUp, fmtBytes
 * @usage import { num, dt } from '/js/format.js';
 *   num(1234)            → "1,234"      (grouped the way the page's language groups)
 *   dt('2026-01-02T…')   → date and time in the page's language
 *   day('2026-01-02T…')  → the date alone, for a line that does not need a clock
 *   fmtUp(90061)         → "1d 1h 1m"   (uptime seconds → human)
 *   fmtBytes(2048)       → "2.0 KB"
 * @version-history
 *   v1.1.0 — 2026-09-12 — The page's language decides the format, not the browser's. `toLocaleString()`
 *     with no argument follows the browser, so a Finnish page printed "9/12/2026, 2:25:42 PM" to a
 *     reader who had just switched it to Finnish, in a sentence that was otherwise Finnish
 *     ("3 jotka sandbox asensi 9/12/2026"). Found by reading the MSM and Cortex pages on the FI
 *     setting. `day()` arrives here too, because two pages had written their own.
 *   v1.0.0 — 2026-06-02 — Component unification (#12): promote admin's num/dt/fmtUp/
 *     fmtBytes to a shared module; admin/shared.js now re-exports from here.
 */
import { getLocale } from '/js/i18n.js';

/** Format a number the way the page's language groups them; non-numbers pass through (nullish → em dash). */
export function num(n) {
  return typeof n === 'number' ? n.toLocaleString(getLocale()) : String(n ?? '—');
}

/** Format an ISO stamp as a date and time in the page's language (nullish → em dash). */
export function dt(s) {
  return s ? new Date(s).toLocaleString(getLocale()) : '—';
}

/** The date alone, in the page's language, for a line that has no use for the clock. */
export function day(s) {
  return s ? new Date(s).toLocaleDateString(getLocale()) : '—';
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
