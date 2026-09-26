/**
 * @file src/static/app-frame-shim.js
 * @description The first script of an app that the node serves into an isolated frame. The node puts
 *   it in front of the app's own markup (routes/apps/inline-frame.ts), inline, so it runs before any
 *   line the app wrote. The frame's origin is opaque, and there the browser refuses localStorage,
 *   sessionStorage and document.cookie outright: an app that touches one of them without a try stops
 *   at that line. This script gives them back:
 *     - localStorage and sessionStorage start from the copy the frame page keeps for this app
 *       (app-frame.js hands it over in window.name, before the app's first byte), and every write
 *       goes back to that page to keep;
 *     - document.cookie works for as long as the page is open.
 *   It also marks the frame for the SDK (window.__AIMEAT_FRAME__: the page around it will ask the
 *   node for the app's own sign-in) and tells that page the app's title. Nothing here reaches the
 *   node's session: what the frame page hands over is the app's own data, and on request the app's
 *   own grant.
 *   The leading comment block is removed before the script is served (utils/app-frame-assets.ts).
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial (audit A7-1: apps on shared nodes without an app origin).
 */
(function () {
  'use strict';
  if (window.__AIMEAT_FRAME__) return;

  var PREFIX = 'aimeat-frame:';
  // Characters per storage area, the ceiling app-frame.js keeps for the same data.
  var LIMIT = 1000000;
  var boot = null;
  try {
    if (typeof window.name === 'string' && window.name.indexOf(PREFIX) === 0) boot = JSON.parse(window.name.slice(PREFIX.length));
  } catch (e) { boot = null; }
  var hasHost = !!(boot && boot.v === 1) && window.parent !== window;
  // The frame page and this document share the address they were served from; that address, not
  // this document's opaque origin, is the one the page listens on.
  var hostOrigin = location.protocol + '//' + location.host;
  try {
    Object.defineProperty(window, '__AIMEAT_FRAME__', { value: Object.freeze({ v: 1, host: hasHost }) });
  } catch (e) { /* defined already */ }

  function post(message) {
    if (!hasHost) return;
    try { window.parent.postMessage(message, hostOrigin); } catch (e) { /* the page is gone */ }
  }

  function refused(read) {
    try { read(); return false; } catch (e) { return true; }
  }

  function quotaError() {
    try { return new DOMException('The quota has been exceeded.', 'QuotaExceededError'); } catch (e) {
      var err = new Error('The quota has been exceeded.');
      err.name = 'QuotaExceededError';
      return err;
    }
  }

  /** A Storage that behaves like the browser's, over a copy this page keeps and the frame page stores. */
  function makeStorage(area, initial) {
    var data = Object.create(null);
    var size = 0;
    if (initial && typeof initial === 'object') {
      Object.keys(initial).forEach(function (k) {
        if (typeof initial[k] === 'string') { data[k] = initial[k]; size += k.length + initial[k].length; }
      });
    }
    function send(action, key, value) { post({ type: 'aimeat_frame_store', area: area, action: action, key: key, value: value }); }
    var api = {
      getItem: function (k) { k = String(k); return k in data ? data[k] : null; },
      setItem: function (k, v) {
        k = String(k); v = String(v);
        var next = size - (k in data ? k.length + data[k].length : 0) + k.length + v.length;
        if (next > LIMIT) throw quotaError();
        data[k] = v; size = next; send('set', k, v);
      },
      removeItem: function (k) {
        k = String(k);
        if (!(k in data)) return;
        size -= k.length + data[k].length; delete data[k]; send('remove', k);
      },
      clear: function () { data = Object.create(null); size = 0; send('clear'); },
      key: function (i) { var keys = Object.keys(data); i = Number(i); return i >= 0 && i < keys.length ? keys[i] : null; },
    };
    Object.defineProperty(api, 'length', { configurable: true, get: function () { return Object.keys(data).length; } });
    // A Proxy, so `localStorage.x = '1'`, `localStorage.x`, `delete localStorage.x`, Object.keys and
    // JSON.stringify(localStorage) all work the way an app written for the real one expects.
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
    try { Object.defineProperty(window, name, { configurable: true, enumerable: true, get: function () { return value; } }); } catch (e) { /* the browser keeps its own */ }
  }

  if (refused(function () { return window.localStorage.length; })) install('localStorage', makeStorage('ls', boot && boot.ls));
  if (refused(function () { return window.sessionStorage.length; })) install('sessionStorage', makeStorage('ss', boot && boot.ss));

  if (refused(function () { return document.cookie; })) {
    var jar = Object.create(null);
    try {
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
    } catch (e) { /* the browser keeps its own */ }
  }

  if (!hasHost) return;
  var lastTitle = null;
  function sendTitle() {
    var title = String(document.title || '');
    if (title === lastTitle) return;
    lastTitle = title;
    post({ type: 'aimeat_frame_title', title: title.slice(0, 200) });
  }
  function watchTitle() {
    sendTitle();
    try {
      new MutationObserver(sendTitle).observe(document.head || document.documentElement, { childList: true, subtree: true, characterData: true });
    } catch (e) { /* the title stays what it was */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchTitle);
  else watchTitle();
})();
