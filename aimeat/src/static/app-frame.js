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
 *   store / title / the legacy aimeat-request-auth · the bar shown when a browser blocks the window.
 *   The grant, the consent window and the refresh-token rule are app-frame-core.js, shared with the
 *   App Catalog's preview.
 * @usage Served at /app-frame.js as a module; referenced by app-frame.html.
 * @version-history
 *   v1.1.0 — 2026-09-26 — A module: the grant, the consent window and forFrame moved unchanged to
 *     app-frame-core.js, which the App Catalog's preview now uses too. The page tells the frame its
 *     own origin in the boot data.
 *   v1.0.0 — 2026-09-25 — Initial (audit A7-1: apps on shared nodes without an app origin).
 */
import { silentGrant, consentWindow } from './app-frame-core.js';

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
    return NAME_PREFIX + JSON.stringify({ v: 1, origin: location.origin, ls: ls, ss: areas.ss });
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

  /**
   * The visible grant flow for this page's app (app-frame-core.js). The redirect is this page's own
   * address, which the node binds to this app. When the browser stops the window, a click on the bar
   * opens it.
   */
  function consent(scope, manage) {
    return consentWindow(app, scope, manage, location.origin + location.pathname, showBar);
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
      silentGrant(app, '').then(function (r) {
        send({ type: 'aimeat-auth', jwt: r && r.ok ? r.access_token : null, nodeUrl: location.origin });
      });
      return;
    }
    if (d.type !== 'aimeat_frame_req' || typeof d.id !== 'string') return;
    if (d.op === 'login') silentGrant(app, String(d.scope || '')).then(function (r) { reply(d.id, d.op, r); });
    else if (d.op === 'consent') consent(String(d.scope || ''), !!d.manage).then(function (r) { reply(d.id, d.op, r); });
    else if (d.op === 'logout') signOut().then(function (r) { reply(d.id, d.op, r); });
    else reply(d.id, d.op, null);
  });
})();
