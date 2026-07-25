/**
 * @file auth/locale.js
 * @description The LANGUAGE switch that travels inside the login pill, exactly as the light/dark
 *   toggle does — so every embedding app inherits one identical control instead of hand-rolling its
 *   own. Before this, each app invented its own switcher (a text button, a select, a pair of links),
 *   and three different storage keys were in play: the SPA's 'aimeat-lang', the aimeat-i18n cortex's
 *   'aimeat-i18n-locale', and a URL parameter read by nobody in particular.
 *
 *   ONE key: 'aimeat-lang' — the same one the SPA and the sign-in modal already use. Reading order is
 *   ?lang= → localStorage → cookie → navigator, matching public/js/utils.js detectLocale() so an app
 *   and the SPA agree on the same origin. Writing sets localStorage AND the cookie and fires an
 *   'aimeat-lang-change' window event; an app re-renders on that event and never manages the control.
 *
 *   The app declares which languages it HAS — the pill cannot guess. Either
 *   `<meta name="aimeat-locales" content="en fi">` (preferred: declarative, like aimeat-scopes) or
 *   `mountLoginButton('#login', { locales: ['en','fi'] })`. Declare nothing and no switch renders,
 *   so a single-language app is unaffected.
 * @structure AIMEAT_LANG_KEY · readLocales · aimeatReadLang/aimeatApplyLang · langToggleHtml ·
 *   wireLangToggle
 * @usage import { langToggleHtml, wireLangToggle } from './locale.js';
 *   In the app: window.addEventListener('aimeat-lang-change', e => render(e.detail.lang));
 * @version-history
 *   v1.0.0 — 2026-07-25 — Initial. Born from "the language switcher is different in EVERY app".
 */
import { escHtml } from './theme.js';

/** The one locale key on this platform. Same as public/js/utils.js and auth/i18n.js. */
export var AIMEAT_LANG_KEY = 'aimeat-lang';

/** Two-letter codes the APP says it supports. Order matters: it is the cycle order. */
export function readLocales(opts) {
  var list = (opts && Array.isArray(opts.locales)) ? opts.locales : null;
  if (!list) {
    try {
      var m = /** @type {HTMLMetaElement|null} */ (document.querySelector('meta[name="aimeat-locales"]'));
      if (m && m.content) list = m.content.split(/[\s,]+/);
    } catch { /* no document */ }
  }
  if (!list) return [];
  var seen = {}, out = [];
  for (var i = 0; i < list.length; i++) {
    var c = String(list[i] || '').trim().toLowerCase();
    if (/^[a-z]{2}$/.test(c) && !seen[c]) { seen[c] = 1; out.push(c); }
  }
  return out.length > 1 ? out : [];   // one language needs no switch
}

/** Current locale, resolved the same way the SPA resolves it. */
export function aimeatReadLang(locales) {
  var ok = function (v) { return v && locales.indexOf(v) >= 0 ? v : null; };
  try {
    var u = ok(new URLSearchParams(location.search).get('lang'));
    if (u) return u;
    var s = ok(localStorage.getItem(AIMEAT_LANG_KEY));
    if (s) return s;
    var c = document.cookie.match(/(?:^|;\s*)aimeat-lang=([a-z]{2})(?:;|$)/);
    if (c && ok(c[1])) return c[1];
  } catch { /* storage blocked */ }
  var nav = ok((navigator.language || '').slice(0, 2).toLowerCase());
  return nav || locales[0];
}

export function aimeatApplyLang(lang) {
  try {
    localStorage.setItem(AIMEAT_LANG_KEY, lang);
    document.cookie = 'aimeat-lang=' + lang + ';path=/;max-age=31536000;SameSite=Lax';
  } catch { /* storage blocked */ }
  try { document.documentElement.setAttribute('lang', lang); } catch { /* no document */ }
  try { window.dispatchEvent(new CustomEvent('aimeat-lang-change', { detail: { lang: lang } })); } catch { /* no window */ }
}

/**
 * The control: one button the same size as the theme toggle, showing the CURRENT language and
 * cycling to the next on click. Two languages makes it a plain toggle; more makes it a cycle, with
 * the destination named in the tooltip.
 */
export function langToggleHtml(i, locales) {
  if (!locales.length) return '';
  var cur = aimeatReadLang(locales);
  var next = locales[(locales.indexOf(cur) + 1) % locales.length];
  var title = (i && i.switchLanguage ? i.switchLanguage : 'Switch language') + ': ' + next.toUpperCase();
  return '<button id="aimeat-lang-toggle" class="aimeat-lang-toggle" title="' + escHtml(title) + '" '
    + 'aria-label="' + escHtml(title) + '" data-next="' + escHtml(next) + '" '
    + 'style="display:inline-flex;align-items:center;justify-content:center;height:30px;min-width:30px;'
    + 'padding:0 7px;flex:0 0 auto;background:transparent;border:1px solid rgba(127,127,127,.4);'
    + 'border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;letter-spacing:.4px;line-height:1;'
    + 'color:currentColor;font-family:system-ui">' + escHtml(cur.toUpperCase()) + '</button>';
}

export function wireLangToggle(container, i, locales) {
  var btn = container.querySelector('#aimeat-lang-toggle');
  if (!btn || !locales.length) return;
  function sync(cur) {
    var after = locales[(locales.indexOf(cur) + 1) % locales.length];
    btn.textContent = cur.toUpperCase();
    btn.setAttribute('data-next', after);
    var title = (i && i.switchLanguage ? i.switchLanguage : 'Switch language') + ': ' + after.toUpperCase();
    btn.title = title; btn.setAttribute('aria-label', title);
  }
  btn.addEventListener('click', function () {
    var next = btn.getAttribute('data-next');
    aimeatApplyLang(next);
    sync(next);
  });
  // Stay truthful when the APP sets the language itself (AIMEAT.auth.setLang, a deep link, the
  // i18n cortex): a control showing the wrong language is worse than no control.
  window.addEventListener('aimeat-lang-change', function (ev) {
    var e = /** @type {CustomEvent} */ (ev);
    var lang = e && e.detail && e.detail.lang;
    if (lang && locales.indexOf(lang) >= 0 && lang !== btn.textContent.toLowerCase()) sync(lang);
  });
}
