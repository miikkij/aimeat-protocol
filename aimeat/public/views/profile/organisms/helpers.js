/**
 * @file helpers.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared pure helpers for the organisms tab modules — locale-aware date
 *   formatting, relative-time labels, avatar monograms, and the whole-organism ZIP export.
 *   Extracted from organisms-tab.js (no behaviour change) so every organism module shares
 *   one copy instead of re-implementing them.
 * @structure fmtDate, relTime, orgInitials, exportOrganismZip
 * @usage import { fmtDate, relTime, orgInitials, exportOrganismZip } from '/views/profile/organisms/helpers.js';
 * @version-history
 *   v1.0.1 — 2026-07-10 — exportOrganismZip surfaces the server's error message (e.g. the access
 *     denial reason) in the toast instead of a bare "Export failed".
 *   v1.0.0 — 2026-06-19 — Extracted from organisms-tab.js during the module split.
 */
import { date as fmtDate, ago } from '/js/format.js';
import { swallowed } from '/js/swallowed.js';
import { authHeaders } from '/js/services/auth.js';

/** Date-only, in the reader's own format and clock. → /js/format.js */
export { fmtDate };

/**
 * Relative time for list metadata, falling back to the date itself past a week.
 *
 * The week is the decision this list makes; the words are not. They came from a `{n} min ago` key
 * family, which survives Finnish only because `min`, `h` and `d` do not inflect, cannot produce
 * "eilen", and is quietly wrong in any language whose noun changes with the number.
 * @param {string} s ISO date string
 * @returns {string} */
export function relTime(s) {
  return ago(s, { horizonDays: 7 });
}

/** Two-letter monogram for the list/home avatar (initials of the first two words, else first two chars).
 * @param {string} name
 * @returns {string} */
export function orgInitials(name) {
  const s = String(name || '?').trim();
  const words = s.split(/\s+/).filter(Boolean);
  const ini = words.length >= 2 ? words[0][0] + words[1][0] : s.slice(0, 2);
  return ini.charAt(0).toUpperCase() + (ini.charAt(1) || '').toLowerCase();
}

/** Download a whole-organism ZIP backup (used from the list "…" menu and the home header).
 * @param {{ id: string, name?: string }} org
 * @param {(msg: string) => void} showToast
 * @returns {Promise<void>} */
export async function exportOrganismZip(org, showToast) {
  try {
    const res = await fetch(`/v1/organisms/${encodeURIComponent(org.id)}/export`, { headers: authHeaders() });
    if (!res.ok) {
      // Surface the server's reason (e.g. an access denial) instead of a bare "Export failed".
      const detail = await res.json().then(j => j?.error?.message).catch(err => { swallowed('helpers: exportOrganismZip', err); return null; });
      throw new Error(detail || 'Export failed');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `organism-${String(org.name || org.id).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40)}.zip`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  } catch (e) { showToast((e && e.message) || 'Export failed'); }
}
