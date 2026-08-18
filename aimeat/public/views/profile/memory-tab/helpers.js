/**
 * @file public/views/profile/memory-tab/helpers.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Pure presentation helpers for the Memory tab — byte/relative-time formatting,
 *   hierarchical key grouping (group id / short token / shortened remainder), and the shared
 *   visibility option list. Extracted from memory-tab.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from public/views/profile/memory-tab.js (max-file-lines)
 */
import { t } from '/js/i18n.js';

/* Visibility is edited via an explicit select inside the EXPANDED detail (and in the
   edit modal) — the old per-row click-to-cycle pill meant one stray click in the list
   could publish a memory. The list rows show a static badge only. */
export const VIS_OPTIONS = ['private', 'owner', 'group', 'members', 'public'];

export function formatBytes(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

export function formatRelativeTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('profile.memory.timeJustNow');
  if (mins < 60) return t('profile.memory.timeMinsAgo').replace('{n}', mins);
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('profile.memory.timeHoursAgo').replace('{n}', hrs);
  const days = Math.floor(hrs / 24);
  if (days < 30) return t('profile.memory.timeDaysAgo').replace('{n}', days);
  return d.toLocaleDateString();
}

/* ── Key grouping helpers: keys are already hierarchical (agents.*, organism.<uuid>.*,
   notif.*) — render collapsible groups instead of a flat list of near-identical rows. */
export const shortTok = (tok) => (tok.length >= 18 ? tok.slice(0, 4) + '…' + tok.slice(-5) : tok);

export function groupOfKey(key) {
  if (key.startsWith('organism.')) {
    const uuid = key.split('.')[1] || '';
    return { id: 'organism.' + uuid, kind: 'organism', uuid };
  }
  const dot = key.indexOf('.');
  if (dot < 0) return { id: '_other', kind: 'other' };
  return { id: key.slice(0, dot), kind: 'plain' };
}

// Shortened remainder inside a group: strip the group prefix, drop the 'w.' workspace
// marker, middle-ellipsize uuid-ish tokens, split the leading container with '›'.
// The full key stays in the row's title attribute (and in the expanded detail).
export function displayRemainder(key, g) {
  let rest = g.kind === 'organism' ? key.slice(('organism.' + g.uuid + '.').length)
    : g.kind === 'plain' ? key.slice(g.id.length + 1)
      : key;
  if (rest.startsWith('w.')) rest = rest.slice(2);
  const toks = rest.split('.').map(shortTok);
  if (toks.length > 1 && toks[0].startsWith('ws-')) return toks[0] + ' › ' + toks.slice(1).join('.');
  if (toks.length > 1 && toks[toks.length - 1].includes('…')) return toks.slice(0, -1).join('.') + ' › ' + toks[toks.length - 1];
  return toks.join('.');
}
