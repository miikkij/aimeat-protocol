/**
 * @file helpers.js
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
import { t, getLocale } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';

/** Date-only, formatted in the APP locale (browser locale may differ — fi must show 10.6.2026, not 6/10/2026).
 * @param {string} s ISO date string
 * @returns {string} */
export function fmtDate(s) {
  return new Date(s).toLocaleDateString(getLocale() === 'fi' ? 'fi-FI' : undefined);
}

/** Relative time for list metadata ("2 h ago" / "2 h sitten"); falls back to a locale date past 7 days.
 * @param {string} s ISO date string
 * @returns {string} */
export function relTime(s) {
  const ts = new Date(s).getTime();
  if (!Number.isFinite(ts)) return '';
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 60) return (t('organisms.relMin') || '{n} min ago').replace('{n}', String(mins));
  const hours = Math.round(mins / 60);
  if (hours < 24) return (t('organisms.relHours') || '{n} h ago').replace('{n}', String(hours));
  const days = Math.round(hours / 24);
  if (days <= 7) return (t('organisms.relDays') || '{n} d ago').replace('{n}', String(days));
  return fmtDate(s);
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
    const jwt = window.AIMEAT?.auth?.getSession?.()?.jwt || '';
    const res = await fetch(`/v1/organisms/${encodeURIComponent(org.id)}/export`, { headers: { Authorization: 'Bearer ' + jwt } });
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
