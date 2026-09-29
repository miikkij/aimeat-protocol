/**
 * @file install-chip.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The install suggestion on a published app's own origin. Injected into served app
 *   HTML by the head-meta pass (app-head-meta.ts), the same way the manifest link is: the browser
 *   never proposes installing on its own, so when it hands over an install offer
 *   (`beforeinstallprompt`, Chromium only), this shows a small button on the node's row of marks
 *   at the bottom-left, "Install this app" in the visitor's language, and a click opens the
 *   browser's real dialog. No offer, no button: on iOS and Firefox this script does nothing at
 *   all. Classic script on purpose: it runs inside somebody else's single-file app, where a module
 *   import and any framework assumption would be one dependency too many.
 * @structure language pick → dismissal check → beforeinstallprompt holder → button build/show →
 *   prompt on click
 * @usage <script src="/js/install-chip.js" defer></script> (injected at serve time)
 * @version-history
 *   v1.1.0 — 2026-09-29 — The third mark on the one row (developer decision 2026-09-29): placed
 *     after the AI label and the attribution bolt by the widths they declare (--aimeat-mark-ai-w,
 *     --aimeat-mark-badge-w), 34px high like them, on the same opaque surface. It was a separate
 *     pill at bottom:58px on the right, where it landed on the opened AI statement on a phone. A
 *     dismissal is remembered for 30 days per app instead of for the tab.
 *   v1.0.0 — 2026-08-16 — Initial.
 */
(function () {
  'use strict';
  // One key per app: on the apex every app shares one origin, so the path tells them apart.
  var DISMISS_KEY = 'aimeat-install-chip-dismissed:' + location.pathname;
  var DISMISS_DAYS = 30;
  try {
    var at = Number(localStorage.getItem(DISMISS_KEY));
    if (at && Date.now() - at < DISMISS_DAYS * 864e5) return;
  } catch (err) { void err; }
  if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return;

  var LABELS = {
    en: { install: 'Install this app', dismiss: 'Dismiss' },
    fi: { install: 'Asenna tämä appi', dismiss: 'Sulje' },
    es: { install: 'Instalar esta app', dismiss: 'Cerrar' },
  };
  var lang = (navigator.language || '').slice(0, 2);
  var T = LABELS[lang] || LABELS.en;

  var offer = null;
  var pill = null;

  // Same surface as the attribution bolt (utils/app-badge.ts): opaque, so the words keep their
  // contrast whatever the app paints behind them. Every declaration is !important because this
  // runs inside somebody else's page, where `button{...}` is a common reset.
  var FONT = 'font:600 12px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif!important;';
  var RESET = 'margin:0!important;border:0!important;background:none!important;color:#fff!important;'
    + 'cursor:pointer!important;height:100%!important;box-sizing:border-box!important;' + FONT;
  var ARROW = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true" '
    + 'focusable="false" style="flex:none!important;display:block!important"><path d="M11 3h2v10.2l3.6-3.6 '
    + '1.4 1.4-6 6-6-6 1.4-1.4 3.6 3.6zM5 19h14v2H5z"/></svg>';

  function buildPill() {
    var wrap = document.createElement('div');
    wrap.id = 'aimeat-install-chip';
    // The third place on the row: after the AI label and the bolt when they are there, in their
    // place when they are not (the fallbacks are 0).
    var left = 'calc(12px + var(--aimeat-mark-ai-w, 0px) + var(--aimeat-mark-badge-w, 0px))';
    wrap.style.cssText = 'position:fixed!important;left:' + left + '!important;right:auto!important;'
      + 'bottom:12px!important;top:auto!important;z-index:2147483646!important;display:flex!important;'
      + 'align-items:center!important;height:34px!important;box-sizing:border-box!important;'
      + 'max-width:calc(100vw - 12px - ' + left + ')!important;margin:0!important;padding:0!important;'
      + 'border-radius:9999px!important;overflow:hidden!important;background:#14141c!important;'
      + 'border:1px solid rgba(255,255,255,.14)!important;box-shadow:0 4px 16px rgba(0,0,0,.28)!important;' + FONT;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = ARROW;
    var words = document.createElement('span');
    words.textContent = T.install;
    words.style.cssText = 'overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;';
    btn.appendChild(words);
    btn.style.cssText = RESET + 'display:inline-flex!important;align-items:center!important;gap:6px!important;'
      + 'min-width:0!important;padding:0 8px 0 12px!important;';
    btn.addEventListener('click', function () {
      if (!offer) return;
      var o = offer;
      offer = null;
      o.prompt();
      hide();
    });
    var close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', T.dismiss);
    close.textContent = '×';
    close.style.cssText = RESET + 'flex:none!important;width:30px!important;padding:0 4px 0 0!important;'
      + 'font-size:15px!important;opacity:.7!important;';
    close.addEventListener('click', function () {
      try {
        localStorage.setItem(DISMISS_KEY, String(Date.now()));
      } catch (err) { void err; }
      hide();
    });
    wrap.appendChild(btn);
    wrap.appendChild(close);
    return wrap;
  }

  function hide() {
    if (pill && pill.parentNode) pill.parentNode.removeChild(pill);
    pill = null;
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    // Held for the button — WITHOUT preventDefault, so the browser's own offer (where one exists)
    // stays available beside it. Cancelling and then not prompting is how an app ends up with no
    // install offer at all.
    offer = e;
    if (!pill) {
      pill = buildPill();
      var attach = function () { document.body.appendChild(pill); };
      if (document.body) attach();
      else document.addEventListener('DOMContentLoaded', attach);
    }
  });

  window.addEventListener('appinstalled', hide);
})();
