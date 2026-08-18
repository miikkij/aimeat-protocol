/**
 * @file recents.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description "Continue" list backing store — the last opened things (workspaces, apps,
 *   organisms, …) across types, so the profile home can offer one-click returns with real
 *   display names. Device-local by design (localStorage): what you opened HERE.
 * @structure
 *   - recordRecent(item) — upsert by type+id to the front, capped at 12
 *   - listRecents(n)     — newest first
 * @usage
 *   import { recordRecent, listRecents } from '/js/recents.js';
 *   recordRecent({ type: 'workspace', id: orgId + '/' + wsId, label: wsName, sub: orgName, data: { orgId, wsId } });
 * @version-history
 *   v1.0.0 — 2026-06-10 — Initial: localStorage-backed cross-type recents for the home dashboard.
 */

const KEY = 'aimeat.recents';
const CAP = 12;

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  // eslint-disable-next-line aimeat/no-silent-catch -- a browser API refusing here IS the answer
  } catch { return []; }
}

/** Record a visit. item: { type, id, label, sub?, data? } — type+id is the identity. */
export function recordRecent(item) {
  if (!item || !item.type || !item.id || !item.label) return;
  try {
    const list = readAll().filter(x => !(x.type === item.type && x.id === item.id));
    list.unshift({ type: item.type, id: item.id, label: item.label, sub: item.sub || '', data: item.data || {}, at: new Date().toISOString() });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, CAP)));
  // eslint-disable-next-line aimeat/no-silent-catch -- recents are a convenience — never break the caller
  } catch { /* recents are a convenience — never break the caller */ }
}

/** Newest-first recents, capped at n. */
export function listRecents(n = 5) {
  return readAll().slice(0, n);
}
