/**
 * @file src/static/app-frame.js
 * @description The page that holds a published app in an isolated frame (the node's own origin).
 *   A node that several people share and that has no app origin serves app-frame.html at the app's
 *   own address to a browser that opens the app (routes/apps/inline-frame.ts). This script builds ONE
 *   iframe whose origin is opaque (the `sandbox` attribute without allow-same-origin, the same flags
 *   the app's own response carries) and answers that frame, and nothing else:
 *     - sign-in: it asks /v1/auth/app-grant-silent for the APP's own scoped grant, with the session
 *       cookie this page can send and the frame cannot, and hands the frame the access token;
 *     - consent: the visible grant flow (PKCE, the node's consent page in a window of its own) for
 *       another person's app, or for a person who is not signed in;
 *     - sign-out of the node, which the frame cannot reach;
 *     - the app's localStorage and sessionStorage, kept here per app, so an app written for plain
 *       browser storage keeps its data between visits (app-frame-shim.js is the frame's half);
 *     - the page title.
 *   The node's session never leaves this page. The frame gets the app's grant and the app's own data.
 * @structure appFromPath · the storage areas · the frame · onMessage → login / consent / logout /
 *   store / title / the legacy aimeat-request-auth · the bar shown when a browser blocks the window
 * @usage Served at /app-frame.js; referenced by app-frame.html.
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial (audit A7-1: apps on shared nodes without an app origin).
 */
(function () {
  'use strict';

  var match = /^\/v1\/apps\/([^/]+)\/([^/]+)$/.exec(location.pathname);
  if (!match) return;
  var owner, file;
  try { owner = decodeURIComponent(match[1]); file = decodeURIComponent(match[2]); } catch (e) { return; }
  var app = owner + '/' + file;

  // The same flags as APP_FRAME_SANDBOX in src/utils/app-csp.ts, which the app's response carries as
  // a CSP `sandbox` directive; a browser applies both, and test/unit/app-frame.test.ts holds them
  // equal. allow-same-origin is never one of them.
  var SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox '
    + 'allow-downloads allow-pointer-lock allow-orientation-lock allow-presentation '
    + 'allow-top-navigation-by-user-activation';
  // Features the app may ask the person for, each behind the browser's own prompt.
  var ALLOW = 'camera; microphone; geolocation; fullscreen; clipboard-read; clipboard-write; autoplay; '
    + 'display-capture; screen-wake-lock; web-share; midi; picture-in-picture; accelerometer; gyroscope; magnetometer';
  var NAME_PREFIX = 'aimeat-frame:';
  // Characters per storage area, the same ceiling app-frame-shim.js keeps.
  var STORE_LIMIT = 1000000;
  // The node-wide choices an app follows until it makes one of its own.
  var FOLLOW = ['aimeat-lang', 'aimeat-theme', 'aimeat-palette'];
  var KEYS = { ls: 'aimeat_frame_ls:' + app, ss: 'aimeat_frame_ss:' + app };

  document.title = file;

  // ── The app's storage, kept on this page per app ──
  function readArea(store, key) {
    var out = Object.create(null);
    try {
      var v = JSON.parse(store.getItem(key) || '{}');
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        Object.keys(v).forEach(function (k) { if (typeof v[k] === 'string') out[k] = v[k]; });
      }
    } catch (e) { /* no storage, or not ours: start empty */ }
    return out;
  }
  function sizeOf(map) {
    var n = 0;
    Object.keys(map).forEach(function (k) { n += k.length + map[k].length; });
    return n;
  }
  function local() { try { return window.localStorage; } catch (e) { return null; } }
  function session() { try { return window.sessionStorage; } catch (e) { return null; } }
  var areas = { ls: local() ? readArea(local(), KEYS.ls) : Object.create(null), ss: session() ? readArea(session(), KEYS.ss) : Object.create(null) };
  var sizes = { ls: sizeOf(areas.ls), ss: sizeOf(areas.ss) };

  /** What the frame reads before its first byte: its own storage, and the node's choices it follows. */
  function bootName() {
    var ls = Object.create(null);
    Object.keys(areas.ls).forEach(function (k) { ls[k] = areas.ls[k]; });
    var store = local();
    FOLLOW.forEach(function (k) {
      if (k in ls || !store) return;
      try { var v = store.getItem(k); if (typeof v === 'string') ls[k] = v; } catch (e) { /* nothing to follow */ }
    });
    return NAME_PREFIX + JSON.stringify({ v: 1, ls: ls, ss: areas.ss });
  }

  // ── The frame ──
  var frame = document.createElement('iframe');
  frame.id = 'aimeat-app-frame';
  frame.setAttribute('sandbox', SANDBOX);
  frame.setAttribute('allow', ALLOW);
  frame.setAttribute('allowfullscreen', '');
  frame.setAttribute('title', file);
  frame.name = bootName();
  var query = new URLSearchParams(location.search);
  query.set('mode', 'frame');
  frame.src = location.pathname + '?' + query.toString() + location.hash;
  document.body.appendChild(frame);

  var flushTimer = null;
  function flush() {
    flushTimer = null;
    var ls = local(), ss = session();
    try { if (ls) ls.setItem(KEYS.ls, JSON.stringify(areas.ls)); } catch (e) {
      try { console.warn('[aimeat] this browser has no room left for the app\'s data; it is kept until the page closes.'); } catch (e2) { /* no console */ }
    }
    try { if (ss) ss.setItem(KEYS.ss, JSON.stringify(areas.ss)); } catch (e) { /* the same, for this tab */ }
    // A reload inside the frame starts from what the app wrote.
    frame.name = bootName();
  }
  function schedule() { if (!flushTimer) flushTimer = setTimeout(flush, 250); }
  window.addEventListener('pagehide', function () { if (flushTimer) { clearTimeout(flushTimer); flush(); } });

  function onStore(d) {
    var area = d.area === 'ls' || d.area === 'ss' ? d.area : null;
    if (!area) return;
    var map = areas[area];
    if (d.action === 'clear') {
      areas[area] = Object.create(null);
      sizes[area] = 0;
    } else if (typeof d.key === 'string' && d.action === 'set' && typeof d.value === 'string') {
      var had = d.key in map ? d.key.length + map[d.key].length : 0;
      var next = sizes[area] - had + d.key.length + d.value.length;
      if (next > STORE_LIMIT) return;
      map[d.key] = d.value;
      sizes[area] = next;
    } else if (typeof d.key === 'string' && d.action === 'remove') {
      if (!(d.key in map)) return;
      sizes[area] -= d.key.length + map[d.key].length;
      delete map[d.key];
    } else {
      return;
    }
    schedule();
  }

  // ── Answers to the frame ──
  function send(message) {
    // '*' because the frame's origin is opaque and has no name to target. The message goes to the one
    // window this page created, and only after a request that came from that window.
    try { frame.contentWindow.postMessage(message, '*'); } catch (e) { /* the frame is gone */ }
  }
  function reply(id, op, result) { send({ type: 'aimeat_frame_res', id: id, op: op, result: result === undefined ? null : result }); }

  /** The frame gets the access token and what describes it; the refresh token stays with this page. */
  function forFrame(data) {
    var out = {};
    Object.keys(data || {}).forEach(function (k) { if (k !== 'refresh_token') out[k] = data[k]; });
    return out;
  }

  function silentGrant(scope) {
    return fetch('/v1/auth/app-grant-silent?app=' + encodeURIComponent(app) + '&scope=' + encodeURIComponent(scope || ''),
      { credentials: 'include', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) { return (j && j.data) ? forFrame(j.data) : { ok: false, error: 'failed' }; })
      .catch(function () { return { ok: false, error: 'failed' }; });
  }

  function b64url(buf) {
    var bytes = new Uint8Array(buf), s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function pkce() {
    var verifier = b64url(crypto.getRandomValues(new Uint8Array(32)).buffer);
    if (crypto.subtle && crypto.subtle.digest) {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
        .then(function (d) { return { verifier: verifier, challenge: b64url(d), method: 'S256' }; });
    }
    // Plain http on a name other than localhost has no crypto.subtle; the SDK falls back the same way.
    return Promise.resolve({ verifier: verifier, challenge: verifier, method: 'plain' });
  }

  function openWindow(url) {
    var w = 460, h = 660;
    var left = window.screen && window.screen.width ? (window.screen.width - w) / 2 : 0;
    var top = window.screen && window.screen.height ? (window.screen.height - h) / 2 : 0;
    return window.open(url, 'aimeat_consent', 'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top);
  }

  /**
   * The visible grant flow for this page's app. The consent page posts the code back to this page
   * (its opener, on the node's own origin), this page exchanges it with the PKCE verifier it kept,
   * and the frame gets the access token.
   */
  function consent(scope, manage) {
    return pkce().then(function (p) {
      var state = b64url(crypto.getRandomValues(new Uint8Array(16)).buffer);
      var redirectUri = location.origin + location.pathname;
      var url = '/v1/app-grants/authorize?response_type=code&response_mode=web_message'
        + (manage ? '&manage=1' : '')
        + '&app=' + encodeURIComponent(app)
        + '&scope=' + encodeURIComponent(scope || '')
        + '&redirect_uri=' + encodeURIComponent(redirectUri)
        + '&code_challenge=' + encodeURIComponent(p.challenge)
        + '&code_challenge_method=' + encodeURIComponent(p.method)
        + '&state=' + encodeURIComponent(state);
      return new Promise(function (resolve) {
        var popup = openWindow(url);
        if (popup) { waitFor(popup); return; }
        // The browser stopped the window. A click on this page opens it; so does a second try.
        showBar(function () {
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

  function signOut() {
    // A person ends the node's session from an app with a click, and a click in the frame activates
    // this page too. An app that asks with no click just before is refused, which is what stops an app
    // signing its visitors out of the node on load. A browser without navigator.userActivation is not
    // asked, and signs out as the app-origin bridge always has.
    var ua = navigator.userActivation;
    if (ua && !ua.isActive) return Promise.resolve({ ok: false, error: 'no_gesture' });
    return fetch('/v1/auth/revoke', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } })
      .then(function () { return { ok: true }; })
      .catch(function () { return { ok: false }; });
  }

  // ── The bar, when a browser blocks the sign-in window ──
  var WORDS = {
    en: { text: 'Your browser blocked the sign-in window.', open: 'Open it', later: 'Not now' },
    fi: { text: 'Selaimesi esti kirjautumisikkunan.', open: 'Avaa ikkuna', later: 'Ei nyt' },
    es: { text: 'Tu navegador bloqueó la ventana de inicio de sesión.', open: 'Abrirla', later: 'Ahora no' },
  };
  function words() {
    var lang = '';
    try { lang = (local() && local().getItem('aimeat-lang')) || ''; } catch (e) { /* none */ }
    if (!WORDS[lang]) lang = String(navigator.language || 'en').slice(0, 2).toLowerCase();
    return WORDS[lang] || WORDS.en;
  }
  function showBar(onOpen, onLater) {
    var old = document.getElementById('aimeat-frame-bar');
    if (old) old.remove();
    var w = words();
    var bar = document.createElement('div');
    bar.id = 'aimeat-frame-bar';
    bar.setAttribute('role', 'alert');
    var text = document.createElement('span');
    text.textContent = w.text;
    var open = document.createElement('button');
    open.type = 'button';
    open.className = 'primary';
    open.textContent = w.open;
    var later = document.createElement('button');
    later.type = 'button';
    later.textContent = w.later;
    open.addEventListener('click', function () { bar.remove(); onOpen(); });
    later.addEventListener('click', function () { bar.remove(); onLater(); });
    bar.appendChild(text);
    bar.appendChild(open);
    bar.appendChild(later);
    document.body.appendChild(bar);
    open.focus();
  }

  // ── The one door in ──
  window.addEventListener('message', function (e) {
    // Only this page's own frame, and only while it is sandboxed: its origin is then opaque.
    if (e.source !== frame.contentWindow || e.origin !== 'null') return;
    var d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'aimeat_frame_store') { onStore(d); return; }
    if (d.type === 'aimeat_frame_title') { document.title = String(d.title || '').slice(0, 200) || file; return; }
    if (d.type === 'aimeat-request-auth') {
      // The older sandbox road (AIMEAT.auth.requestParentAuth): the app's own grant, never a session.
      silentGrant('').then(function (r) {
        send({ type: 'aimeat-auth', jwt: r && r.ok ? r.access_token : null, nodeUrl: location.origin });
      });
      return;
    }
    if (d.type !== 'aimeat_frame_req' || typeof d.id !== 'string') return;
    if (d.op === 'login') silentGrant(String(d.scope || '')).then(function (r) { reply(d.id, d.op, r); });
    else if (d.op === 'consent') consent(String(d.scope || ''), !!d.manage).then(function (r) { reply(d.id, d.op, r); });
    else if (d.op === 'logout') signOut().then(function (r) { reply(d.id, d.op, r); });
    else reply(d.id, d.op, null);
  });
})();
