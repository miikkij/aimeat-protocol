/**
 * @file src/static/page-frame-shim.js
 * @description The first script of an HTML page that the node serves into the page frame
 *   (routes/page-host.ts). The node puts it in front of the page's own markup, inline, so it runs
 *   before any line the page wrote. The frame's origin is ALWAYS opaque (the response carries the CSP
 *   sandbox without allow-same-origin), and there the browser refuses localStorage, sessionStorage and
 *   document.cookie outright: a page an AI wrote that touches one of them without a try stops at that
 *   line. This script puts its own in their place, held in memory for as long as the page is open and
 *   kept nowhere else, because a page's state is the open tab's. It does not test whether the
 *   browser's own work first: in this frame they never do.
 *
 *   It also sends a link that leaves the page to the viewer around the frame, which shows the address
 *   and opens it only when the person presses Open. The sandbox gives the page no popups and no way
 *   to move the tab, so without this a link to a source would simply do nothing. The message carries
 *   the address of a link the page itself holds and nothing else, so it goes to any parent ('*'):
 *   the viewer is the only page allowed to frame this one (frame-ancestors).
 *   The leading comment block is removed before the script is served (utils/app-frame-assets.ts).
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (HTML pages in workspaces).
 */
(function () {
  'use strict';
  if (window.__AIMEAT_PAGE__) return;
  Object.defineProperty(window, '__AIMEAT_PAGE__', { value: Object.freeze({ v: 1 }) });

  var LIMIT = 1000000;

  /** A Storage that behaves like the browser's, held in memory while the page is open. */
  function makeStorage() {
    var data = Object.create(null);
    var size = 0;
    var api = {
      getItem: function (k) { k = String(k); return k in data ? data[k] : null; },
      setItem: function (k, v) {
        k = String(k); v = String(v);
        var next = size - (k in data ? k.length + data[k].length : 0) + k.length + v.length;
        if (next > LIMIT) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        data[k] = v; size = next;
      },
      removeItem: function (k) {
        k = String(k);
        if (!(k in data)) return;
        size -= k.length + data[k].length; delete data[k];
      },
      clear: function () { data = Object.create(null); size = 0; },
      key: function (i) { var keys = Object.keys(data); i = Number(i); return i >= 0 && i < keys.length ? keys[i] : null; },
    };
    Object.defineProperty(api, 'length', { configurable: true, get: function () { return Object.keys(data).length; } });
    return new Proxy(api, {
      get: function (t, p) {
        if (p in api) return api[p];
        return typeof p === 'string' && p in data ? data[p] : undefined;
      },
      set: function (t, p, v) { if (typeof p === 'string' && !(p in api)) api.setItem(p, v); return true; },
      deleteProperty: function (t, p) { if (typeof p === 'string' && !(p in api)) api.removeItem(p); return true; },
      has: function (t, p) { return p in api || (typeof p === 'string' && p in data); },
      ownKeys: function () { return Object.keys(data); },
      getOwnPropertyDescriptor: function (t, p) {
        if (typeof p === 'string' && !(p in api) && p in data) return { value: data[p], writable: true, enumerable: true, configurable: true };
        return undefined;
      },
    });
  }

  function install(name, value) {
    Object.defineProperty(window, name, { configurable: true, enumerable: true, get: function () { return value; } });
  }
  install('localStorage', makeStorage());
  install('sessionStorage', makeStorage());

  var jar = Object.create(null);
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: function () { return Object.keys(jar).map(function (k) { return k + '=' + jar[k]; }).join('; '); },
    set: function (v) {
      var parts = String(v).split(';');
      var eq = parts[0].indexOf('=');
      if (eq < 0) return;
      var name = parts[0].slice(0, eq).trim();
      if (!name) return;
      var gone = parts.slice(1).some(function (p) {
        p = p.trim().toLowerCase();
        if (p.indexOf('max-age=') === 0) return Number(p.slice(8)) <= 0;
        if (p.indexOf('expires=') === 0) { var t = Date.parse(p.slice(8)); return !isNaN(t) && t < Date.now(); }
        return false;
      });
      if (gone) delete jar[name]; else jar[name] = parts[0].slice(eq + 1).trim();
    },
  });

  /** The address `raw` names against this page, or null when it names none. */
  function addressOf(raw) {
    var s = String(raw);
    if (typeof URL.canParse === 'function' && !URL.canParse(s, location.href)) return null;
    return new URL(s, location.href);
  }

  /** Ask the viewer to open an address. Only web and mail addresses; anything else is dropped. */
  function askOpen(url) {
    if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'mailto:')) return;
    window.parent.postMessage({ type: 'aimeat_page_open', url: url.href }, '*');
  }

  // A link that leaves the page: to the viewer. An anchor within the page and a file of the page
  // (same origin) keep their own behaviour inside the frame.
  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el.nodeType === 1 && el.tagName !== 'A' && el.tagName !== 'AREA') el = el.parentNode;
    if (!el || el.nodeType !== 1) return;
    var href = el.getAttribute('href');
    if (!href || href.charAt(0) === '#') return;
    var url = addressOf(href);
    if (url && url.origin === location.origin) return;
    e.preventDefault();
    askOpen(url);
  }, true);

  // window.open is refused by the sandbox; a page that opens a source with it asks the viewer instead.
  window.open = function (u) { if (u) askOpen(addressOf(u)); return null; };
})();
