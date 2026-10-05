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
 *
 *   The page acts on a message only when it carries the frame's secret (app-frame-core.js fromFrame):
 *   every document the sandboxed frame loads has the origin 'null', a foreign page a link opened in
 *   it included. The secret and the app's storage reach the frame once, in its name at creation, and
 *   the frame support script clears the name; the page never writes the name again. A document that
 *   starts with no boot data (a reload inside the frame) asks for a new frame, and the page builds
 *   one at the app's own address with a new secret. Answers that carry a grant go back on the
 *   MessagePort the request brought, which belongs to the document that asked and to no later one.
 * @structure appFromPath · the storage areas · build(src) the frame · onMessage → boot / login /
 *   consent / logout / store / title / the legacy aimeat-request-auth · the bar shown when a browser
 *   blocks the window. The grant, the consent window, the secret and the refresh-token rule are
 *   app-frame-core.js, shared with the App Catalog's preview.
 * @usage Served at /app-frame.js as a module; referenced by app-frame.html.
 * @version-history
 *   v1.3.0 — 2026-10-05 — Secaudit 2026-10, WEB-1 and WEB-2. A message counts only with the frame's
 *     secret; the storage is no longer written back into the frame's name after each change (a foreign
 *     page in the frame read the app's storage, the SDK's access token in it, from window.name); a
 *     frame document without boot data gets a new frame; grant answers go back on the request's
 *     MessagePort; a draft (`?preview=`) asks the node as unpublished code.
 *   v1.2.0 — 2026-10-04 — The consent request's `prompt` ('create') reaches the consent window, so
 *     signIn({ register: true }) opens on the create-account form in the isolated frame too.
 *   v1.1.0 — 2026-09-26 — A module: the grant, the consent window and forFrame moved unchanged to
 *     app-frame-core.js, which the App Catalog's preview now uses too. The page tells the frame its
 *     own origin in the boot data.
 *   v1.0.0 — 2026-09-25 — Initial (audit A7-1: apps on shared nodes without an app origin).
 */
import { silentGrant, consentWindow, frameSecret, bootName as nameFor, fromFrame, FRAME_BOOT } from './app-frame-core.js';

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

  /** What the frame reads before its first byte: its own storage, the node's choices it follows, its secret. */
  function bootName(secret) {
    var ls = Object.create(null);
    Object.keys(areas.ls).forEach(function (k) { ls[k] = areas.ls[k]; });
    var store = local();
    FOLLOW.forEach(function (k) {
      if (k in ls || !store) return;
      try { var v = store.getItem(k); if (typeof v === 'string') ls[k] = v; } catch (e) { /* nothing to follow */ }
    });
    return nameFor({ origin: location.origin, secret: secret, ls: ls, ss: areas.ss });
  }

  // ── The frame ──
  var frame = null;
  var secret = '';
  // Whether the frame holds code that is not the app's published version: a draft opened with its
  // preview token. Decided from the address each frame is built with.
  var unpublished = false;

  /** The frame's address: this page's own path, its query with mode=frame, and a hash. */
  function frameSrc(search, hash) {
    var query = new URLSearchParams(search);
    query.set('mode', 'frame');
    return { src: location.pathname + '?' + query.toString() + (hash || ''), unpublished: query.has('preview') };
  }

  /** A new frame at `target`, with a new secret. The old frame, and whatever document it holds, goes. */
  function build(target) {
    secret = frameSecret();
    unpublished = target.unpublished;
    var next = document.createElement('iframe');
    next.id = 'aimeat-app-frame';
    next.setAttribute('sandbox', SANDBOX);
    next.setAttribute('allow', ALLOW);
    next.setAttribute('allowfullscreen', '');
    next.setAttribute('title', file);
    next.name = bootName(secret);
    next.src = target.src;
    if (frame) frame.replaceWith(next); else document.body.appendChild(next);
    frame = next;
  }
  build(frameSrc(location.search, location.hash));

  // A document in the frame that found no boot data: a reload inside the frame, or a page the frame
  // navigated to. It gets a new frame at the app's own address, never the old frame's name. Bounded,
  // so a document that asks on every load cannot keep the page rebuilding.
  var rebuilds = [];
  function rebuild(path) {
    var now = Date.now();
    rebuilds = rebuilds.filter(function (t) { return now - t < 10000; });
    if (rebuilds.length >= 5) return;
    rebuilds.push(now);
    var url = null;
    try { url = new URL(typeof path === 'string' ? path : '', location.origin); } catch (e) { url = null; }
    // Only this app's own address; anything else is the address this page was opened with.
    if (url && url.origin === location.origin && url.pathname === location.pathname) build(frameSrc(url.search, url.hash));
    else build(frameSrc(location.search, location.hash));
  }

  var flushTimer = null;
  function flush() {
    flushTimer = null;
    var ls = local(), ss = session();
    try { if (ls) ls.setItem(KEYS.ls, JSON.stringify(areas.ls)); } catch (e) {
      try { console.warn('[aimeat] this browser has no room left for the app\'s data; it is kept until the page closes.'); } catch (e2) { /* no console */ }
    }
    try { if (ss) ss.setItem(KEYS.ss, JSON.stringify(areas.ss)); } catch (e) { /* the same, for this tab */ }
    // The frame's name is never written here: a later document of the frame could read it. A reload
    // inside the frame asks for a new frame instead (rebuild), which starts from what the app wrote.
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
  /**
   * An answer goes back on the MessagePort the request brought. A port belongs to the document that
   * made it, so an answer that carries a grant cannot reach a page the frame navigated to after it
   * asked. A request without a port gets no answer.
   */
  function send(e, message) {
    var port = e.ports && e.ports[0];
    if (!port) return;
    try { port.postMessage(message); } catch (err) { /* the asking document is gone */ }
  }
  function reply(e, id, op, result) { send(e, { type: 'aimeat_frame_res', id: id, op: op, result: result === undefined ? null : result }); }

  /**
   * The visible grant flow for this page's app (app-frame-core.js). The redirect is this page's own
   * address, which the node binds to this app. When the browser stops the window, a click on the bar
   * opens it.
   */
  function consent(scope, manage, prompt) {
    return consentWindow(app, scope, manage, location.origin + location.pathname, showBar, prompt);
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
    var d = e.data;
    // A frame document with no boot data asks for a new frame. No secret: it has none, and all the
    // request can cause is a fresh frame at this app's own address.
    if (frame && e.source === frame.contentWindow && e.origin === 'null' && d && typeof d === 'object' && d.type === FRAME_BOOT) {
      rebuild(d.path);
      return;
    }
    // Everything else: this page's own frame, sandboxed, and holding the secret this page gave it.
    if (!fromFrame(e, frame, secret)) return;
    if (d.type === 'aimeat_frame_store') { onStore(d); return; }
    if (d.type === 'aimeat_frame_title') { document.title = String(d.title || '').slice(0, 200) || file; return; }
    var opts = { unpublished: unpublished };
    if (d.type === 'aimeat-request-auth') {
      // The older sandbox request (AIMEAT.auth.requestParentAuth): the app's own grant, never a session.
      silentGrant(app, '', opts).then(function (r) {
        send(e, { type: 'aimeat-auth', jwt: r && r.ok ? r.access_token : null, nodeUrl: location.origin });
      });
      return;
    }
    if (d.type !== 'aimeat_frame_req' || typeof d.id !== 'string') return;
    if (d.op === 'login') silentGrant(app, String(d.scope || ''), opts).then(function (r) { reply(e, d.id, d.op, r); });
    else if (d.op === 'consent') consent(String(d.scope || ''), !!d.manage, d.prompt === 'create' ? 'create' : '').then(function (r) { reply(e, d.id, d.op, r); });
    else if (d.op === 'logout') signOut().then(function (r) { reply(e, d.id, d.op, r); });
    else reply(e, d.id, d.op, null);
  });
})();
