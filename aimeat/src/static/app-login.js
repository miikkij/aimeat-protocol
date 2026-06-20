/**
 * @file src/static/app-login.js
 * @description Drop-in auth shim auto-injected into apps served on the app origin. It performs the
 *   seamless, secure SSO so a logged-in owner's own app works WITHOUT a separate login: it embeds a
 *   hidden iframe to the apex bridge (app-silent.html), receives a SCOPED, revocable grant token via
 *   postMessage (validating the apex origin), and exposes it as `window.AIMEAT_APP`. It also patches
 *   `fetch` so the app's same-origin `/v1/*` calls carry the token, and shims the legacy
 *   `/v1/auth/refresh` so apps written for the old ambient session keep working unchanged.
 *   No session is ever shared — only the app's own scoped token (manage/revoke in Profile › Access).
 * @usage Injected as `<script src="https://<apex>/app-login.js">` by subdomains.ts when serving an
 *   app on the app origin. Apps may set `window.AIMEAT_APP_SCOPES` (space-separated) before it loads.
 * @version-history
 *   v1.0.0 — 2026-06-20 — Initial (H-2 seamless secure app SSO).
 */
(function () {
  if (window.AIMEAT_APP) return; // run once

  // The apex origin is where THIS script was served from.
  var apex = '';
  try { apex = new URL(document.currentScript.src).origin; } catch (e) { /* ignore */ }
  if (!apex) {
    var s = document.querySelector('script[src*="/app-login.js"]');
    if (s) { try { apex = new URL(s.src).origin; } catch (e) { /* ignore */ } }
  }
  if (!apex) return;

  var scopes = window.AIMEAT_APP_SCOPES || 'memory:read memory:write';
  var state = { token: null, refresh: null, error: null, ready: false };
  window.AIMEAT_APP = state;

  // Patch fetch: same-origin /v1/* calls carry the scoped app token; the legacy session-refresh is
  // shimmed so old apps that called it transparently receive the app token instead of a 401 loop.
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = (typeof input === 'string') ? input : (input && input.url) || '';
    var isV1 = url.indexOf('/v1/') === 0 || url.indexOf(location.origin + '/v1/') === 0;
    if (isV1 && /\/v1\/auth\/refresh\b/.test(url)) {
      var body = JSON.stringify({ ok: !!state.token, data: state.token ? { token: state.token, expires_in: 3600 } : null });
      return Promise.resolve(new Response(body, { status: state.token ? 200 : 401, headers: { 'Content-Type': 'application/json' } }));
    }
    if (isV1 && state.token) {
      init = init || {};
      var h = new Headers((init && init.headers) || (typeof input !== 'string' && input ? input.headers : undefined) || {});
      if (!h.has('Authorization')) h.set('Authorization', 'Bearer ' + state.token);
      init.headers = h;
    }
    return realFetch(input, init);
  };

  window.addEventListener('message', function (e) {
    if (e.origin !== apex) return;          // only trust the apex bridge
    var d = e.data || {};
    if (d.type !== 'aimeat_app_login') return;
    var r = d.result || {};
    if (r.ok && r.access_token) { state.token = r.access_token; state.refresh = r.refresh_token || null; state.error = null; }
    else { state.error = r.error || 'failed'; }
    state.ready = true;
    try { window.dispatchEvent(new CustomEvent('aimeat-app-login', { detail: state })); } catch (x) { /* ignore */ }
  });

  var f = document.createElement('iframe');
  f.style.display = 'none';
  f.setAttribute('aria-hidden', 'true');
  f.setAttribute('title', 'AIMEAT login');
  f.src = apex + '/app-silent.html?scope=' + encodeURIComponent(scopes);
  (document.body || document.documentElement).appendChild(f);
})();
