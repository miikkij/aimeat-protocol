/**
 * @file favorites.js
 * @description Server-backed favourites for the catalog. A per-owner PRIVATE memory doc
 *   (`app-catalog.favorites` = { version, updatedAt, refs: ["owner/filename", …] }) read/written
 *   via /v1/memory with the owner token, so favourites follow the account across devices. Any app
 *   (own or community) can be favourited; the Library pins a "⭐ Favourites" group on top. Holds the
 *   in-memory Set + the star-button HTML helper; the grid/group rendering lives in render/server-io.
 * @usage import { loadFavorites, toggleFavorite, isFavorite, getFavoriteRefs, favStarHtml } from './favorites.js'
 * @version-history
 *   v1.0.0 — 2026-07-20 — initial (Phase 2b server-backed favourites).
 */
import { loadConfig } from './config.js';
import { getCortexOwnerToken } from './cortex.js';
import { t } from './i18n.js';
import { jsArg } from './util.js';

const KEY = 'app-catalog.favorites';
let favSet = new Set();

function base() { return (loadConfig().aimeatUrl || '').replace(/\/+$/, ''); }

export function isFavorite(ref) { return favSet.has(ref); }
export function getFavoriteRefs() { return Array.from(favSet); }
export function hasFavorites() { return favSet.size > 0; }

// Load the owner's favourites doc. Requires a signed-in owner (favourites are per-account); logged
// out → empty set. Never throws — a missing doc (404) just means no favourites yet.
export function loadFavorites() {
  var token = getCortexOwnerToken();
  var b = base();
  if (!token || !b) { favSet = new Set(); return Promise.resolve(); }
  return fetch(b + '/v1/memory/' + encodeURIComponent(KEY) + '?soft=1', { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      var refs = (j && j.data && j.data.value && Array.isArray(j.data.value.refs)) ? j.data.value.refs : [];
      favSet = new Set(refs.filter(function (x) { return typeof x === 'string'; }));
    })
    .catch(function () { /* leave the set as-is on a transient error */ });
}

function persist() {
  var token = getCortexOwnerToken();
  var b = base();
  if (!token || !b) return Promise.resolve();
  return fetch(b + '/v1/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({
      key: KEY,
      value: { version: 1, updatedAt: new Date().toISOString(), refs: Array.from(favSet) },
      visibility: 'private',
    }),
  }).catch(function () { /* best-effort persist */ });
}

// Toggle a favourite (ref = "owner/filename"). Updates the set optimistically, persists, and
// resolves so the caller can re-render. Returns the new state (true = now a favourite).
export function toggleFavorite(ref) {
  var now;
  if (favSet.has(ref)) { favSet.delete(ref); now = false; } else { favSet.add(ref); now = true; }
  return persist().then(function () { return now; });
}

// The ⭐/☆ toggle button for a card. `ref` is "owner/filename". Stops propagation so a click on the
// star never opens the card's detail view.
export function favStarHtml(ref) {
  var on = favSet.has(ref);
  var title = on ? (t('fav.remove') || 'Remove from favourites') : (t('fav.add') || 'Add to favourites');
  return '<button class="fav-toggle' + (on ? ' on' : '') + '"'
    + ' onclick="event.stopPropagation(); window._launcher.toggleFavorite(\'' + jsArg(ref) + '\')"'
    + ' title="' + title + '">' + (on ? '⭐' : '☆') + '</button>';
}
