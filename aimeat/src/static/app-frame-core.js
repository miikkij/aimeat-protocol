/**
 * @file src/static/app-frame-core.js
 * @description What a page of the node does for an app it holds in an opaque-origin frame. Two pages
 *   hold one: the isolated frame's page on a node several people share with no app origin
 *   (app-frame.js), and the App Catalog's preview of code its owner has not published yet
 *   (app-catalog/js/preview-host.js, which esbuild bundles this into). Both ask the node for the
 *   app's own grant, run the visible consent for it, and hand the frame the access token alone. The
 *   node's session stays on the page that imports this.
 *
 *   A page trusts its frame by a secret, never by the frame's origin. Every document a sandboxed
 *   iframe loads has the opaque origin 'null', a foreign page that a link opened inside the frame
 *   included, so `e.source === frame.contentWindow && e.origin === 'null'` admits that page too
 *   (secaudit 2026-10, WEB-1). The page makes a secret per frame, hands it over once in the frame's
 *   name, the frame support script (app-frame-shim.js) takes it and clears the name before the app's
 *   first byte runs, and every message the page acts on carries it. A frame document that finds no
 *   boot data asks for a new frame (FRAME_BOOT), which the page answers by building one; that request
 *   needs no secret, because all it can cause is a fresh frame holding the app's own address.
 * @structure b64url · pkce · forFrame · frameSecret() · bootName(boot) · fromFrame(e, frame, secret) ·
 *   silentGrant(app, scope, opts) · consentWindow(app, scope, manage, redirectUri, onBlocked)
 * @usage import { silentGrant, consentWindow, frameSecret, bootName, fromFrame, FRAME_BOOT } from './app-frame-core.js';
 * @version-history
 *   v1.2.0 — 2026-10-05 — frameSecret, bootName, fromFrame and FRAME_BOOT: the page admits a message
 *     only with its frame's secret (secaudit 2026-10, WEB-1). silentGrant takes { unpublished }: code
 *     that is not the published version (a draft, a checkpoint, a proposal) never approves its own
 *     owner's widening silently (WEB-2).
 *   v1.1.0 — 2026-10-04 — consentWindow takes `prompt`; 'create' sends prompt=create to authorize.
 *   v1.0.0 — 2026-09-26 — Initial: moved out of app-frame.js unchanged, so the App Catalog's preview
 *     asks for the same grant the isolated frame does instead of handing over the session.
 */

/** Base64url-encode a buffer (no padding), the encoding PKCE and the state parameter use. */
export function b64url(buf) {
  var bytes = new Uint8Array(buf), s = '';
  for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A fresh PKCE pair. Plain http on a name other than localhost has no crypto.subtle; the SDK falls back the same way. */
export function pkce() {
  var verifier = b64url(crypto.getRandomValues(new Uint8Array(32)).buffer);
  if (crypto.subtle && crypto.subtle.digest) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
      .then(function (d) { return { verifier: verifier, challenge: b64url(d), method: 'S256' }; });
  }
  return Promise.resolve({ verifier: verifier, challenge: verifier, method: 'plain' });
}

/** What a frame may hold of a grant answer: all of it but the refresh token, which stays with the page. */
export function forFrame(data) {
  var out = {};
  Object.keys(data || {}).forEach(function (k) { if (k !== 'refresh_token') out[k] = data[k]; });
  return out;
}

/** The prefix of the boot data in a frame's name; app-frame-shim.js reads the same string. */
export var BOOT_PREFIX = 'aimeat-frame:';

/** The message a frame document sends when it starts with no boot data: build me a new frame. */
export var FRAME_BOOT = 'aimeat_frame_boot';

/** A fresh secret for one frame: 128 random bits, base64url. */
export function frameSecret() {
  return b64url(crypto.getRandomValues(new Uint8Array(16)).buffer);
}

/**
 * The name a new frame is created with. A browser reads it into the frame only at creation, and the
 * frame support script clears it at once, so the boot data and the secret are never left where a
 * later document of the same frame could read them.
 * @param {{ origin: string, secret: string, ls?: Record<string,string>, ss?: Record<string,string> }} boot
 */
export function bootName(boot) {
  return BOOT_PREFIX + JSON.stringify({ v: 1, origin: boot.origin, secret: boot.secret, ls: boot.ls || {}, ss: boot.ss || {} });
}

/**
 * Whether a message event comes from this page's frame while it is sandboxed (opaque origin) AND
 * carries that frame's secret. The secret is what tells the app's own document from any other
 * document the same frame may have navigated to.
 * @param {MessageEvent} e
 * @param {HTMLIFrameElement|null} frame
 * @param {string} secret
 */
export function fromFrame(e, frame, secret) {
  if (!frame || !frame.contentWindow || e.source !== frame.contentWindow || e.origin !== 'null') return false;
  var d = e.data;
  return !!(d && typeof d === 'object' && typeof d.secret === 'string' && secret && d.secret === secret);
}

/**
 * The app's own scoped grant from the silent door, asked by the app's name with this page's session
 * cookie, which the frame cannot send. The node answers only a page of its own origin here. The owner's
 * own app is granted silently; another person's app answers consent_required until that person agrees.
 * `opts.unpublished` says the frame holds code that is not the app's published version (a draft, a
 * checkpoint, a proposal): another person may have written it, so the node approves the owner's own
 * app silently only within the grant the owner already holds, and asks for consent beyond it.
 * @param {string} app  owner/filename
 * @param {string} scope  space-separated scopes the app declares
 * @param {{ unpublished?: boolean }} [opts]
 */
export function silentGrant(app, scope, opts) {
  return fetch('/v1/auth/app-grant-silent?app=' + encodeURIComponent(app) + '&scope=' + encodeURIComponent(scope || '')
    + (opts && opts.unpublished ? '&bytes=unpublished' : ''),
    { credentials: 'include', cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (j) { return (j && j.data) ? forFrame(j.data) : { ok: false, error: 'failed' }; })
    .catch(function () { return { ok: false, error: 'failed' }; });
}

function openWindow(url) {
  var w = 460, h = 660;
  var left = window.screen && window.screen.width ? (window.screen.width - w) / 2 : 0;
  var top = window.screen && window.screen.height ? (window.screen.height - h) / 2 : 0;
  return window.open(url, 'aimeat_consent', 'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top);
}

/**
 * The visible grant flow for `app`: the node's consent page in a window of its own, which posts the
 * code back to this page (its opener, on the node's own origin); this page exchanges it with the PKCE
 * verifier it kept, and resolves the grant for the frame, `{ revoked: true }`, or null.
 * `redirectUri` is the app's own address on the node, the one redirect the node binds to that app.
 * `onBlocked(retry, cancel)` runs when the browser stops the window: `retry` must be called from a
 * click on this page, `cancel` gives up.
 */
export function consentWindow(app, scope, manage, redirectUri, onBlocked, prompt) {
  return pkce().then(function (p) {
    var state = b64url(crypto.getRandomValues(new Uint8Array(16)).buffer);
    var url = '/v1/app-grants/authorize?response_type=code&response_mode=web_message'
      + (manage ? '&manage=1' : '')
      + (prompt === 'create' ? '&prompt=create' : '')
      + '&app=' + encodeURIComponent(app)
      + '&scope=' + encodeURIComponent(scope || '')
      + '&redirect_uri=' + encodeURIComponent(redirectUri)
      + '&code_challenge=' + encodeURIComponent(p.challenge)
      + '&code_challenge_method=' + encodeURIComponent(p.method)
      + '&state=' + encodeURIComponent(state);
    return new Promise(function (resolve) {
      var popup = openWindow(url);
      if (popup) { waitFor(popup); return; }
      onBlocked(function () {
        var again = openWindow(url);
        if (again) waitFor(again); else resolve(null);
      }, function () { resolve(null); });

      function waitFor(win) {
        var done = false, timer = null;
        function finish(v) { done = true; window.removeEventListener('message', onGrant); if (timer) clearInterval(timer); resolve(v); }
        function onGrant(e) {
          if (e.origin !== location.origin || e.source !== win) return;
          var d = e.data || {};
          if (d.type !== 'aimeat_app_grant' || d.state !== state) return;
          if (d.revoked) { finish({ revoked: true }); return; }
          if (!d.code) { finish(null); return; }
          fetch('/v1/app-grants/token', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ grant_type: 'authorization_code', code: d.code, code_verifier: p.verifier, redirect_uri: redirectUri }),
          })
            .then(function (r) { return r.json(); })
            .then(function (j) { finish(j && j.ok && j.data && j.data.access_token ? forFrame(j.data) : null); })
            .catch(function () { finish(null); });
        }
        window.addEventListener('message', onGrant);
        timer = setInterval(function () { if (!done && win.closed) finish(null); }, 500);
      }
    });
  });
}
