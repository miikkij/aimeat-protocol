/**
 * @file auth/app-origin.js
 * @description The app-origin half of aimeat-auth (H-2): when this SDK runs on an app origin rather
 *   than on the apex, the session cookie is not first-party there, so a session has to be fetched
 *   through a same-site bridge and, when the app needs scopes the person has not granted, through a
 *   visible consent popup. Pure functions over the config and the crypto helpers: no module state,
 *   which is why they could leave session.js unchanged.
 *
 *   PURE EXTRACTION from session.js on 2026-09-04, moved because that file passed the 800-line
 *   ceiling. Nothing here was rewritten; session.js re-exports the three public names, so every
 *   module that imports isAppOrigin, apexLogout or requestConsentPopup from './session.js' is
 *   untouched.
 *
 * @structure isAppOrigin · appScopeDrift · silentAppToken · apexLogout · requestConsentPopup
 * @usage import { isAppOrigin, silentAppToken } from './app-origin.js';
 * @version-history
 *   v1.0.0 — 2026-09-04 — Extracted verbatim from auth/session.js (lines 109-234).
 */
import { APEX_URL, appDeclaredScopes } from './config.js';
import { parseJwt } from './crypto.js';
import { emit } from './events.js';
import { b64url, pkce } from './pkce.js';

// ── App-origin seamless SSO (H-2) ──
// When this SDK runs on an APP ORIGIN (a *.apps.<domain> host, different from the node/apex), the
// host-only session cookie can't be read directly. The same-site silent bridge (a hidden iframe to
// the apex, where the cookie IS first-party) mints a SCOPED, revocable grant token and posts it back.
export function isAppOrigin() {
  try { return location.origin !== new URL(APEX_URL).origin; } catch { return false; }
}

// Scopes the app DECLARES that this app-origin session's token does NOT carry — the self-heal signal.
export function appScopeDrift(session) {
  if (!session || !session._appOrigin || !session.jwt) return [];
  var have = (parseJwt(session.jwt) || {}).scopes || [];
  return appDeclaredScopes().split(' ').filter(function (s) { return s && have.indexOf(s) < 0; });
}

export function silentAppToken() {
  return new Promise(function (resolve) {
    var apexOrigin;
    try { apexOrigin = new URL(APEX_URL).origin; } catch { resolve(null); return; }
    if (location.origin === apexOrigin) { resolve(null); return; }
    var settled = false, iframe = null, timer = null;
    function finish(v) {
      if (settled) return; settled = true;
      window.removeEventListener('message', onMsg);
      if (timer) clearTimeout(timer);
      if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
      resolve(v);
    }
    function onMsg(e) {
      if (e.origin !== apexOrigin) return;
      var d = e.data || {};
      if (d.type !== 'aimeat_app_login') return;
      // Return the FULL result (token on success, or { error:'consent_required', app, scope }) so the
      // caller can launch the visible consent popup). null only when the bridge produced nothing.
      finish(d.result || null);
    }
    window.addEventListener('message', onMsg);
    iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.src = apexOrigin + '/app-silent.html?scope=' + encodeURIComponent(appDeclaredScopes());
    (document.body || document.documentElement).appendChild(iframe);
    timer = setTimeout(function () { finish(null); }, 8000);
  });
}

// End the shared apex session from an APP ORIGIN (frames the same-site apex bridge in ?mode=logout).
export function apexLogout() {
  return new Promise(function (resolve) {
    var apexOrigin;
    try { apexOrigin = new URL(APEX_URL).origin; } catch { resolve(false); return; }
    if (location.origin === apexOrigin) { resolve(false); return; }
    var settled = false, iframe = null, timer = null;
    function finish(v) {
      if (settled) return; settled = true;
      window.removeEventListener('message', onMsg);
      if (timer) clearTimeout(timer);
      if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
      resolve(v);
    }
    function onMsg(e) {
      if (e.origin !== apexOrigin) return;
      var d = e.data || {};
      if (d.type !== 'aimeat_app_logout') return;
      finish(!!(d.result && d.result.ok));
    }
    window.addEventListener('message', onMsg);
    iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.src = apexOrigin + '/app-silent.html?mode=logout';
    (document.body || document.documentElement).appendChild(iframe);
    timer = setTimeout(function () { finish(false); }, 8000);
  });
}

// ── App-grant consent popup (H-2, PKCE code flow; b64url/pkce live in ./pkce.js) ──
export async function requestConsentPopup(app, scopeStr, manage) {
  var apexOrigin;
  try { apexOrigin = new URL(APEX_URL).origin; } catch { return null; }
  var p = await pkce();
  var state = b64url(crypto.getRandomValues(new Uint8Array(16)).buffer);
  var redirectUri = location.origin + '/'; // app origin; never navigated in web_message mode (origin binding only)
  var scope = scopeStr || appDeclaredScopes();
  // manage=1 → the consent page always shows the management screen (the gear).
  var url = apexOrigin + '/v1/app-grants/authorize?response_type=code&response_mode=web_message'
    + (manage ? '&manage=1' : '')
    + '&app=' + encodeURIComponent(app)
    + '&scope=' + encodeURIComponent(scope)
    + '&redirect_uri=' + encodeURIComponent(redirectUri)
    + '&code_challenge=' + encodeURIComponent(p.challenge)
    + '&code_challenge_method=' + encodeURIComponent(p.method)
    + '&state=' + encodeURIComponent(state);
  var w = 460, h = 660;
  var left = (window.screen && window.screen.width ? (window.screen.width - w) / 2 : 0);
  var top = (window.screen && window.screen.height ? (window.screen.height - h) / 2 : 0);
  var popup = window.open(url, 'aimeat_consent', 'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top);
  if (!popup) {
    // Popup blocked (no user activation / aggressive blocker). Fail LOUDLY so the app can react.
    try { console.warn('[aimeat-auth] consent popup blocked — app-origin sign-in needs a real user click (user activation). Synthetic/automated clicks cannot open the consent window.'); } catch { /* no console */ }
    emit('popup-blocked', { app: app });
    return null;
  }
  var msg = await new Promise(function (resolve) {
    var done = false, iv = null;
    function onMsg(e) {
      if (e.origin !== apexOrigin) return;
      var d = e.data || {};
      if (d.type !== 'aimeat_app_grant' || d.state !== state) return;
      done = true; cleanup(); resolve(d);
    }
    function cleanup() { window.removeEventListener('message', onMsg); if (iv) clearInterval(iv); }
    window.addEventListener('message', onMsg);
    iv = setInterval(function () { if (popup.closed && !done) { cleanup(); resolve(null); } }, 500);
  });
  if (msg && msg.revoked) return { revoked: true };       // user revoked from the consent screen
  if (!msg || !msg.code) return null;                     // denied / closed
  try {
    var resp = await fetch(apexOrigin + '/v1/app-grants/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code: msg.code, code_verifier: p.verifier, redirect_uri: redirectUri }),
    });
    var j = await resp.json();
    return (j && j.ok && j.data && j.data.access_token) ? j.data : null;
  } catch { return null; }
}
