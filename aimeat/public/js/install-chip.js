/**
 * @file install-chip.js
 * @description The install suggestion on a published app's own origin. Injected into served app
 *   HTML by the head-meta pass (app-head-meta.ts), the same way the manifest link is: the browser
 *   never proposes installing on its own, so when it hands over an install offer
 *   (`beforeinstallprompt`, Chromium only), this shows a small pill above the aimeat.io badge —
 *   "Install this app" in the visitor's language — and a click opens the browser's real dialog.
 *   No offer, no pill: on iOS and Firefox this script does nothing at all. Classic script on
 *   purpose: it runs inside somebody else's single-file app, where a module import and any
 *   framework assumption would be one dependency too many.
 * @structure language pick → beforeinstallprompt holder → pill build/show → prompt on click
 * @usage <script src="/js/install-chip.js" defer></script> (injected at serve time)
 * @version-history
 *   v1.0.0 — 2026-08-16 — Initial.
 */
(function () {
  'use strict';
  var DISMISS_KEY = 'aimeat-install-chip-dismissed';
  try {
    if (sessionStorage.getItem(DISMISS_KEY) === '1') return;
   
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

  function buildPill() {
    var wrap = document.createElement('div');
    wrap.id = 'aimeat-install-chip';
    // Sits just above the aimeat.io badge (bottom:12px), same dark surface so the two read as one
    // family of node chrome. Styled inline because this runs inside an arbitrary app document.
    wrap.style.cssText = 'position:fixed;right:12px;bottom:58px;z-index:2147483646;display:flex;'
      + 'align-items:center;gap:6px;font:600 12px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = T.install;
    btn.style.cssText = 'display:inline-flex;align-items:center;gap:8px;padding:7px 12px;'
      + 'border-radius:9999px;color:#fff;background:rgba(20,20,28,.92);cursor:pointer;'
      + 'border:1px solid rgba(255,255,255,.14);box-shadow:0 4px 16px rgba(0,0,0,.28);'
      + 'font:inherit;';
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
    close.style.cssText = 'width:24px;height:24px;border-radius:50%;color:#fff;'
      + 'background:rgba(20,20,28,.92);border:1px solid rgba(255,255,255,.14);cursor:pointer;'
      + 'font:600 13px/1 system-ui,sans-serif;';
    close.addEventListener('click', function () {
      try {
        sessionStorage.setItem(DISMISS_KEY, '1');
       
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
    // Held for the pill — WITHOUT preventDefault, so the browser's own offer (where one exists)
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
