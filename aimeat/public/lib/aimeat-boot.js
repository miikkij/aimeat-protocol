/*
 * @file aimeat-boot.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The first-paint boot for AIMEAT apps: restore the user's light/dark MODE and
 *   PALETTE onto <html> before anything renders, and keep both in sync when another tab changes
 *   them. This is the 25-line inline IIFE every shell used to copy, served as ONE synchronous
 *   script instead — an Atelier app's head shrinks to a handful of lines and every app follows
 *   the same restore forever, because a fix here reaches all of them.
 *
 *   LOAD IT SYNCHRONOUSLY IN <head> (a plain script tag, no defer, no async, no module): a
 *   deferred restore paints the wrong look first and then flashes. The file is same-origin and
 *   served no-cache, so it revalidates cheaply and never pins an old restore.
 *
 *   IT SETS ATTRIBUTES; IT DECIDES NOTHING ELSE. The login pill (aimeat-auth) owns the theme
 *   and palette CONTROLS and keeps both live after load; this file only covers the gap between
 *   navigation and the pill mounting. Storage-blocked browsers fall back to the OS preference.
 *
 *   No gate lints public/lib JavaScript, so the discipline lives in this header and in
 *   test/e2e-libs.ts, which asserts the file serves, stays synchronous-safe (no top-level
 *   await, no imports) and never touches the network.
 * @structure one IIFE: mode() · pal() · restore from localStorage/OS · storage listener
 * @usage  <script src="/lib/aimeat-boot.js"></script>   (in <head>, before any stylesheet paint matters)
 * @version-history
 *   v0.1.0 — 2026-08-27 — Initial (TARGET-074 phase 1, slice 1): the shell theme-restore IIFE,
 *     served. Same semantics as the inline original in shells.ts.
 */
(function () {
  'use strict';

  /** @param {string|null} t */
  function mode(t) {
    document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
  }

  /** @param {string|null} p */
  function pal(p) {
    if (p && p !== 'aimeat') document.documentElement.setAttribute('data-palette', p);
    else document.documentElement.removeAttribute('data-palette');
  }

  var storedMode = null;
  var storedPal = null;
  try {
    storedMode = localStorage.getItem('aimeat-theme');
    storedPal = localStorage.getItem('aimeat-palette');
  } catch (e) { /* storage blocked — the OS preference below still applies */ }

  mode(storedMode || (typeof matchMedia === 'function'
    && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  pal(storedPal);

  addEventListener('storage', function (e) {
    if (e.key === 'aimeat-theme' && e.newValue) mode(e.newValue);
    if (e.key === 'aimeat-palette' && e.newValue) pal(e.newValue);
  });
})();
