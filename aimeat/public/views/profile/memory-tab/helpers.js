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
import { ago } from '/js/format.js';

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

/**
 * How long ago, until it is long enough ago that a date reads better.
 *
 * A month is the decision this tab makes; the words are not. They used to come from four `{n}`-style
 * keys, which survive Finnish only because `pv` and `t` do not inflect, cannot produce "eilen", and
 * would be quietly wrong in any language whose noun changes with the number. CLDR holds those rules.
 */
export function formatRelativeTime(isoStr) {
  return ago(isoStr, { horizonDays: 30 });
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
