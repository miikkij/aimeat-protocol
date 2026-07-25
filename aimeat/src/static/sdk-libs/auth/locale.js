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
 * @structure AIMEAT_LANG_KEY · readLocales · aimeatReadLang/aimeatApplyLang · langName ·
 *   langSwitchHtml/wireLangSwitch
 * @usage import { langSwitchHtml, wireLangSwitch } from './locale.js';
 *   In the app: window.addEventListener('aimeat-lang-change', e => render(e.detail.lang));
 * @version-history
 *   v2.0.0 — 2026-07-25 — Segmented control (every option visible, one click to any) up to three
 *     languages; a popover list beyond that. Replaces the cycling button, which with three or more
 *     languages was a blind carousel.
 *   v1.0.0 — 2026-07-25 — Initial. Born from "the language switcher is different in EVERY app".
 */
import { escHtml } from './theme.js';
import { clampPopover } from './cluster.js';

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

/** The language's own name for the picker list ("suomi", not "Finnish"), code as the fallback. */
function langName(code) {
  try {
    var dn = new Intl.DisplayNames([code], { type: 'language' });
    var n = dn.of(code);
    if (n && n !== code) return n.charAt(0).toUpperCase() + n.slice(1);
  } catch { /* Intl.DisplayNames unavailable */ }
  return code.toUpperCase();
}

/** How many languages still fit as a segmented control before the picker becomes a popover list. */
var SEGMENT_MAX = 3;

/**
 * The control: every declared language VISIBLE, the active one marked, one click to any — never a
 * blind cycle. Up to three languages render as a segmented group (FI | EN); four or more become a
 * popover list (current code as the trigger) so eight languages cost the header no more width than
 * two. Cluster classes come from cluster.js (ensureClusterStyles).
 */
export function langSwitchHtml(i, locales) {
  if (!locales.length) return '';
  var cur = aimeatReadLang(locales);
  var group = (i && i.switchLanguage ? i.switchLanguage : 'Language');
  if (locales.length <= SEGMENT_MAX) {
    return '<span id="aimeat-lang-switch" class="aimeat-seg" role="group" aria-label="' + escHtml(group) + '">'
      + locales.map(function (c) {
        return '<button type="button" data-lang="' + escHtml(c) + '" aria-pressed="' + (c === cur) + '" '
          + 'title="' + escHtml(langName(c)) + '" aria-label="' + escHtml(langName(c)) + '">'
          + escHtml(c.toUpperCase()) + '</button>';
      }).join('')
      + '</span>';
  }
  return '<span id="aimeat-lang-switch" class="aimeat-pop-wrap">'
    + '<button type="button" class="aimeat-pop-btn" aria-haspopup="listbox" aria-expanded="false" '
    + 'title="' + escHtml(group) + '" aria-label="' + escHtml(group) + '">'
    + escHtml(cur.toUpperCase()) + ' <span aria-hidden="true">▾</span></button>'
    + '<span class="aimeat-pop aimeat-pop-list" role="listbox">'
    + locales.map(function (c) {
      return '<button type="button" role="option" data-lang="' + escHtml(c) + '" aria-pressed="' + (c === cur) + '">'
        + escHtml(c.toUpperCase()) + ' · ' + escHtml(langName(c)) + '</button>';
    }).join('')
    + '</span></span>';
}

export function wireLangSwitch(container, i, locales) {
  var root = container.querySelector('#aimeat-lang-switch');
  if (!root || !locales.length) return;
  var trigger = root.querySelector('.aimeat-pop-btn');
  function sync(cur) {
    root.querySelectorAll('button[data-lang]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === cur));
    });
    if (trigger) trigger.childNodes[0].textContent = cur.toUpperCase() + ' ';
  }
  root.querySelectorAll('button[data-lang]').forEach(function (b) {
    b.addEventListener('click', function () {
      aimeatApplyLang(b.getAttribute('data-lang'));
      sync(b.getAttribute('data-lang'));
      root.classList.remove('aimeat-open');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    });
  });
  if (trigger) trigger.addEventListener('click', function (ev) {
    ev.stopPropagation();
    var open = root.classList.toggle('aimeat-open');
    trigger.setAttribute('aria-expanded', String(open));
    if (open) clampPopover(root.querySelector('.aimeat-pop'));
  });
  // Stay truthful when the APP sets the language itself (AIMEAT.auth.setLang, a deep link, the
  // i18n cortex): a control showing the wrong language is worse than no control.
  window.addEventListener('aimeat-lang-change', function (ev) {
    var e = /** @type {CustomEvent} */ (ev);
    var lang = e && e.detail && e.detail.lang;
    if (lang && locales.indexOf(lang) >= 0) sync(lang);
  });
}
