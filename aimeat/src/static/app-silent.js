/**
 * @file src/static/app-silent.js
 * @description Silent SSO bridge (apex origin). Loaded by app-silent.html inside a hidden iframe
 *   that a published app (on its own `<sub>.apps.<domain>` origin) embeds. Because the iframe runs
 *   on the apex — same site as the app — the host-only session cookie reaches it first-party, so it
 *   can ask the apex for a SCOPED grant token for the embedding app and postMessage it back.
 *   The embedding app origin is taken from `location.ancestorOrigins` (the trusted parent origin),
 *   and the token is posted ONLY to that exact origin — never broadcast.
 * @usage Served at /app-silent.js; referenced by /app-silent.html.
 * @version-history
 *   v1.0.0 — 2026-06-20 — Initial (H-2 seamless secure app SSO).
 */
(function () {
  // The real embedding app origin. ancestorOrigins is the trustworthy source (Chrome/Safari);
  // document.referrer is the Firefox fallback. We post the token ONLY to this origin.
  var appOrigin = '';
  try { if (location.ancestorOrigins && location.ancestorOrigins.length) appOrigin = location.ancestorOrigins[0]; } catch (e) { /* ignore */ }
  if (!appOrigin && document.referrer) { try { appOrigin = new URL(document.referrer).origin; } catch (e) { /* ignore */ } }
  if (!appOrigin) return; // cannot determine the parent → do nothing (never leak a token)

  var scope = new URLSearchParams(location.search).get('scope') || '';
  var post = function (result) {
    try { window.parent.postMessage({ type: 'aimeat_app_login', result: result }, appOrigin); } catch (e) { /* ignore */ }
  };

  // Same-origin (apex) credentialed call — the host-only cookie (Path=/v1/auth) is sent here.
  fetch('/v1/auth/app-grant-silent?origin=' + encodeURIComponent(appOrigin) + '&scope=' + encodeURIComponent(scope),
    { credentials: 'include', cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (j) { post((j && j.data) ? j.data : { ok: false, error: 'failed' }); })
    .catch(function () { post({ ok: false, error: 'failed' }); });
})();
