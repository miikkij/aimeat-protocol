/**
 * @file portfolio-standalone/index.js
 * @description The portfolio-standalone bridge shim (SDK-libs migration Phase 1) — injected into
 *   portfolios served standalone on the portfolio origin (<username>.portfolio.<apex>). Recreates the
 *   viewer's postMessage bridge locally so the exact same portfolio HTML works at top level (where
 *   window.parent === window, so the portfolio's own parent.postMessage lands back here and this shim
 *   answers it). Auth comes from the aimeat-auth SDK's H-2 silent SSO (an app-grant token bound to
 *   THIS origin, scope memory:read). Componentized ESM source esbuild bundles to the IIFE served,
 *   unchanged, at /v1/libs/portfolio-standalone.js (note: NOT aimeat-prefixed, and does NOT attach to
 *   window.AIMEAT). Ported verbatim from lib-portfolio-standalone.ts; the baked ${config.baseUrl} apex
 *   is now APEX_URL from _core/config.
 * @structure imports APEX_URL (config); post()/announce(); the message listener (aimeat-portfolio-fetch);
 *   boot() silent-SSO announce. No namespace attach — this is a standalone bridge, not an AIMEAT.* surface.
 * @usage Served at GET /v1/libs/portfolio-standalone.js; injected (with aimeat-auth.js + a memory:read
 *   scopes meta) by the portfolio-origin serve route in subdomains.ts.
 * @version-history
 *   v1.0.0 — 2026-07-19 — Migrated from src/routes/lib-portfolio-standalone.ts (SDK-libs migration Phase 1).
 */
import { APEX_URL } from '../_core/config.js';

var APEX = APEX_URL;
var jwt = null;

function post(msg) {
  try { window.postMessage(msg, window.location.origin); } catch { /* opaque origin — cannot happen here */ }
}
function announce(loggedIn) {
  post({ type: 'aimeat-portfolio-auth', loggedIn: !!loggedIn });
}

// Answer the portfolio's bridge fetches with the visitor's grant token. At top
// level window.parent === window, so parent.postMessage lands on this window.
window.addEventListener('message', function (e) {
  if (e.source !== window) return;
  var d = e.data;
  if (!d || d.type !== 'aimeat-portfolio-fetch') return;
  var reply = function (ok, value) {
    post({
      type: 'aimeat-portfolio-fetch-result',
      id: d.id == null ? null : d.id,
      ok: !!ok,
      gaii: typeof d.gaii === 'string' ? d.gaii : null,
      key: typeof d.key === 'string' ? d.key : null,
      value: value == null ? null : value,
    });
  };
  if (typeof d.gaii !== 'string' || typeof d.key !== 'string') { reply(false, null); return; }
  fetch(APEX + '/v1/memory/' + encodeURIComponent(d.gaii) + '/' + encodeURIComponent(d.key),
    jwt ? { headers: { Authorization: 'Bearer ' + jwt } } : undefined)
    .then(function (r) { return r.json().then(function (j) { return { r: r, j: j }; }); })
    .then(function (x) {
      var ok = !!(x.r.ok && x.j && x.j.ok !== false);
      reply(ok, ok && x.j.data ? x.j.data.value : null);
    })
    .catch(function () { reply(false, null); });
});

// Silent SSO via the aimeat-auth SDK: on this foreign origin auth.login()
// resolves an H-2 app-grant (scope from the injected aimeat-scopes meta) when
// the visitor has an apex session AND has consented this origin; otherwise null.
function boot() {
  var auth = window.AIMEAT && window.AIMEAT.auth;
  if (!auth || typeof auth.login !== 'function') { announce(false); return; }
  Promise.resolve(auth.login()).then(function (session) {
    jwt = session && session.jwt ? session.jwt : null;
    announce(!!jwt);
  }).catch(function () { announce(false); });
  if (typeof auth.on === 'function') {
    auth.on('login', function () {
      var s = typeof auth.getSession === 'function' ? auth.getSession() : null;
      jwt = (s && s.jwt) || null;
      announce(!!jwt);
    });
    auth.on('logout', function () { jwt = null; announce(false); });
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
