/**
 * @file auth/i18n.js
 * @description aimeat-auth sign-in-modal language helpers (SDK-libs migration Phase 3). The modal can
 *   be shown standalone (e.g. a custom portal page) where the canonical header + its language switcher
 *   is absent, so it owns its own EN/FI switch and loads translations itself, using the same
 *   'aimeat-lang' localStorage key + cookie the header uses so the choice stays in sync with the SPA.
 *   loadModalI18n fetches en.json (base) + <lang>.json (overrides) from the node and returns just the
 *   modal.* strings with the 'modal.' prefix stripped. Extracted from auth-lib-part2.ts.
 * @structure MODAL_LANG_KEY · currentModalLang() · flattenModalI18n() · loadModalI18n(lang).
 * @usage import { currentModalLang, loadModalI18n } from './i18n.js';
 * @version-history
 *   v1.0.0 — 2026-07-19 — Extracted from src/routes/libs/auth-lib-part2.ts (SDK-libs migration Phase 3).
 */
import { NODE_URL } from './config.js';

export var MODAL_LANG_KEY = 'aimeat-lang';

export function currentModalLang() {
  try {
    var u = new URLSearchParams(location.search).get('lang');
    if (u === 'en' || u === 'fi') return u;
    var s = localStorage.getItem(MODAL_LANG_KEY);
    if (s === 'en' || s === 'fi') return s;
  } catch { /* storage blocked */ }
  return (navigator.language || 'en').slice(0, 2).toLowerCase() === 'fi' ? 'fi' : 'en';
}

export function flattenModalI18n(obj, prefix, out) {
  out = out || {}; prefix = prefix || '';
  for (var k in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
    var key = prefix ? prefix + '.' + k : k;
    var v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) flattenModalI18n(v, key, out);
    else out[key] = v;
  }
  return out;
}

// Fetch en.json (base) + <lang>.json (overrides) from the node and return just the modal.* strings
// with the 'modal.' prefix stripped — the shape the modal (and every mountLoginButton caller) expects
// for opts.i18n.
export async function loadModalI18n(lang) {
  var v = Date.now();
  var t = {};
  try {
    var enRes = await fetch(NODE_URL + '/locales/en.json?v=' + v);
    if (enRes.ok) t = flattenModalI18n(await enRes.json());
  } catch { /* offline / missing locales — fall through to fallbacks */ }
  if (lang !== 'en') {
    try {
      var locRes = await fetch(NODE_URL + '/locales/' + lang + '.json?v=' + v);
      if (locRes.ok) {
        var loc = flattenModalI18n(await locRes.json());
        for (var lk in loc) if (Object.prototype.hasOwnProperty.call(loc, lk)) t[lk] = loc[lk];
      }
    } catch { /* locale missing — English fallback stands */ }
  }
  var out = {};
  for (var k in t) {
    if (Object.prototype.hasOwnProperty.call(t, k) && k.indexOf('modal.') === 0) out[k.slice(6)] = t[k];
  }
  return out;
}
