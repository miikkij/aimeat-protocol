/**
 * @file promote.js
 * @description Promoted apps for the catalog. A per-owner PUBLIC memory doc (`app-catalog.promoted`
 *   = { version, updatedAt, items: [{ ref: "owner/filename", text: { en, fi } }] }) read/written via
 *   /v1/memory with the owner token. PUBLIC so others can read it (GET /v1/memory/:gaii/:key) — it
 *   powers a "Promoted apps" section on the owner's public profile/portfolio. Promote is for the
 *   owner's OWN published apps (showcasing your work), with per-language promotion copy.
 * @usage import { loadPromoted, setPromotion, isPromoted, getPromotion } from './promote.js'
 * @version-history
 *   v1.0.0 — 2026-07-20 — initial (Phase 2c promote).
 */
import { loadConfig } from './config.js';
import { getCortexOwnerToken } from './cortex.js';

const KEY = 'app-catalog.promoted';
// ref -> { en, fi }
let promoted = {};

function base() { return (loadConfig().aimeatUrl || '').replace(/\/+$/, ''); }

export function isPromoted(ref) { return Object.prototype.hasOwnProperty.call(promoted, ref); }
export function getPromotion(ref) { return promoted[ref] || null; }
export function getPromotedItems() {
  return Object.keys(promoted).map(function (ref) { return { ref: ref, text: promoted[ref] || {} }; });
}

// Load the owner's promoted doc (owner token). Logged out → empty. Never throws (404 = none yet).
export function loadPromoted() {
  var token = getCortexOwnerToken();
  var b = base();
  if (!token || !b) { promoted = {}; return Promise.resolve(); }
  return fetch(b + '/v1/memory/' + encodeURIComponent(KEY), { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      var items = (j && j.data && j.data.value && Array.isArray(j.data.value.items)) ? j.data.value.items : [];
      var map = {};
      items.forEach(function (it) {
        if (it && typeof it.ref === 'string' && it.text && typeof it.text === 'object') map[it.ref] = { en: it.text.en || '', fi: it.text.fi || '' };
      });
      promoted = map;
    })
    .catch(function () { /* leave as-is on a transient error */ });
}

function persist() {
  var token = getCortexOwnerToken();
  var b = base();
  if (!token || !b) return Promise.resolve();
  var items = getPromotedItems();
  return fetch(b + '/v1/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({
      key: KEY,
      value: { version: 1, updatedAt: new Date().toISOString(), items: items },
      visibility: 'public',
    }),
  }).catch(function () { /* best-effort */ });
}

// Set (or clear) the promotion for an app. text = { en, fi }; when both are blank the app is
// un-promoted. Persists the public doc and resolves to the new promoted state (true = promoted).
export function setPromotion(ref, text) {
  var en = (text && text.en ? String(text.en).trim() : '');
  var fi = (text && text.fi ? String(text.fi).trim() : '');
  var now;
  if (!en && !fi) { delete promoted[ref]; now = false; }
  else { promoted[ref] = { en: en, fi: fi }; now = true; }
  return persist().then(function () { return now; });
}
