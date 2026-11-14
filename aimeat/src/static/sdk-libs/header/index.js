/**
 * @file header/index.js
 * @description The aimeat-header library (SDK-libs migration Phase 1). A drop-in script that renders
 *   the canonical AIMEAT site header (brand + morsel count, nav links, language switcher, and the
 *   live golden login pill with its theme toggle) inside any standalone page such as a custom portal
 *   template. It reuses the real auth library (aimeat-auth.js → mountLoginButton) so login is
 *   identical to the SPA, links /css/theme.css so styling matches, and reads the same localStorage
 *   keys so theme/language stay in sync with the SPA. Componentized ESM source esbuild bundles to the
 *   IIFE served, unchanged, at /v1/libs/aimeat-header.js. Ported verbatim from lib-header.ts; this is
 *   a self-running shim (mounts into #aimeat-header or prepends to <body>) — it does not attach to
 *   window.AIMEAT. From _core it takes only the language (lang.js), which touches no namespace.
 * @structure readLang/readTheme/applyTheme/flatten/ensureThemeCss/loadScript/loadTranslations/
 *   loadNavConfig/modalI18n/buildMarkup/wire/fitBar/refreshSession/init — runs init() on DOM ready.
 *   The links themselves are data in ./nav.js.
 * @usage <div id="aimeat-header"></div><script src="/v1/libs/aimeat-header.js"></script>
 * @version-history
 *   v1.5.0 — 2026-11-14 — The bar is the shell's bar again. A signed-in person gets Home, Messages,
 *     Agents and Chat (in the shell since 2026-10-18 and never here), Apps opens /v1/appcat in the
 *     same tab (it opened the old /app-catalog.html in a new one), and the wordmark takes them home.
 *     The public links follow the operator's order and hidden list (/v1/site/header-nav) and carry
 *     Learn when the node has one; a customer's node and a signed-in-only node get the shorter bar
 *     the shell gives them (window.__AIMEAT_HEADER_CFG__, written by routes/libs.ts). The bar folds
 *     to the menu button when it measures an overflow, as the shell's does: eight links and the pill
 *     do not fit every window above the stylesheet's fixed width. The links moved to ./nav.js, which
 *     test/unit/sdk-header-nav.test.ts holds against spa.html.
 *   v1.4.0 — 2026-11-12 — A language button asks for the page again without ?lang= in the address,
 *     which would otherwise win over the button, and the press carries the pick mark (writeLang),
 *     so the node's front page follows it.
 *   v1.3.2 — 2026-11-04 — The name in the pill links to the home's settings dialog, as in the SPA.
 *   v1.3.1 — 2026-10-05 — The language comes from _core/lang.js, the one resolver (secaudit 2026-10, M7).
 *   v1.3.0 — 2026-09-30 — An operator sees the new-version tag (GET /v1/admin/node-update) beside the
 *     pill; it links to /v1/admin?nodeUpdate=1, where the SPA opens the dialog.
 *   v1.2.0 — 2026-08-12 — Spanish added. The language switch and readLang() come off one LANGS list
 *     instead of naming the languages in five places.
 *   v1.1.0 — 2026-08-09 — Same anon/auth split as the SPA header: "How it works" and "For your
 *     business" (data-anon-only) step aside for Apps/Profile/Admin once there is a session. Drops
 *     "Try it" (it pointed at /v1/classic, which the landing already leads to) and "For Developers"
 *     (a site-footer link now). The bar carries at most five targets in either state.
 *   v1.0.0 — 2026-07-19 — Migrated from src/routes/lib-header.ts (SDK-libs migration Phase 1).
 */
import { readLang as resolveLang, writeLang } from '../_core/lang.js';
import { headerLinks, linkShown, brandPath } from './nav.js';

if (!window.__AIMEAT_HEADER_MOUNTED__) {
  window.__AIMEAT_HEADER_MOUNTED__ = true;
  main();
}

function main() {
  var THEME_KEY = 'aimeat-theme';
  // The languages the node ships UI text in. Mirrors LOCALES in src/i18n.ts.
  var LANGS = ['en', 'fi', 'es'];
  // The links carry their own fallback text (./nav.js); these two are the pill's.
  var NAV_FALLBACK = {
    'nav.themeToDark': 'Switch to dark mode', 'nav.themeToLight': 'Switch to light mode',
  };

  function readLang() {
    return /** @type {string} */ (resolveLang(LANGS));
  }

  function readTheme() {
    try {
      var s = localStorage.getItem(THEME_KEY);
      if (s === 'light' || s === 'dark') return s;
    } catch { /* storage blocked */ }
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }

  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem(THEME_KEY, t); } catch { /* storage blocked */ }
  }

  function flatten(obj, prefix, out) {
    out = out || {}; prefix = prefix || '';
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      var key = prefix ? prefix + '.' + k : k;
      var v = obj[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
      else out[key] = v;
    }
    return out;
  }

  function ensureThemeCss() {
    var present = Array.prototype.some.call(document.querySelectorAll('link[rel=stylesheet]'), function (l) {
      return (l.getAttribute('href') || '').indexOf('/css/theme.css') !== -1;
    });
    if (present) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/css/theme.css';
    link.setAttribute('data-aimeat-theme-css', '');
    // Insert first so the page's own <style> still wins on shared selectors (body, etc.).
    document.head.insertBefore(link, document.head.firstChild);
  }

  function loadScript(src) {
    return new Promise(function (resolve) {
      var existing = document.querySelector('script[src="' + src + '"]');
      if (existing) { resolve(undefined); return; }
      var s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = resolve;
      document.head.appendChild(s);
    });
  }

  async function loadTranslations(lang) {
    var v = Date.now();
    var t = {};
    try {
      var enRes = await fetch('/locales/en.json?v=' + v);
      if (enRes.ok) t = flatten(await enRes.json());
    } catch { /* offline / missing locales — fall through to fallbacks */ }
    if (lang !== 'en') {
      try {
        var locRes = await fetch('/locales/' + lang + '.json?v=' + v);
        if (locRes.ok) {
          var loc = flatten(await locRes.json());
          for (var k in loc) if (Object.prototype.hasOwnProperty.call(loc, k)) t[k] = loc[k];
        }
      } catch { /* locale missing — English fallback stands */ }
    }
    return t;
  }

  /**
   * The operator's arrangement of the public links (their order and the hidden ones). Public, and
   * the same answer the shell's bar reads. A failed request leaves the declared order.
   */
  async function loadNavConfig() {
    try {
      var r = await fetch('/v1/site/header-nav');
      var d = r.ok ? await r.json() : null;
      return (d && d.ok && d.data) ? d.data : null;
    } catch (err) {
      console.warn('AIMEAT header: the order of the public links was not read; the declared order stands', err);
      return null;
    }
  }

  function esc(v) {
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function modalI18n(t) {
    var keys = ['descNew', 'descReturning', 'usernameLabel', 'usernamePlaceholder', 'passwordLabel',
      'passwordPlaceholder', 'displayNameLabel', 'displayNameHint', 'displayNamePlaceholder', 'signInBtn',
      'cancelBtn', 'working', 'errUserShort', 'errPassShort', 'errWrongPass', 'loggedIn', 'logoutBtn',
      'forgotPassword', 'forgotUsername', 'resetPasswordTitle', 'resetPasswordDesc', 'sendResetCode',
      'backToLogin', 'resetCodeSent', 'enterNewPasswordTitle', 'codeLabel', 'newPasswordLabel',
      'newPasswordPlaceholder', 'errPassWeak', 'resetPassword', 'resetSuccess', 'recoverUsernameTitle',
      'recoverUsernameDesc', 'emailLabel', 'sendUsername', 'usernameSent', 'whyTitle', 'whyGhii',
      'whyPrivacy', 'whyAgents', 'whyMorsels',
      // Two-tab modal. Without these the FIRST paint falls back to English and the modal visibly
      // re-renders once the node's full dictionary arrives.
      'tabSignIn', 'tabRegister', 'identifierLabel', 'identifierPlaceholder', 'signInOnlyBtn',
      'createAccountBtn', 'usernameHint', 'registerEmailHint', 'displayNameOptional',
      'errIdentifierRequired', 'errPassRequired', 'errWrongCredentials', 'errNameTaken'];
    var obj = {};
    for (var i = 0; i < keys.length; i++) {
      var val = t['modal.' + keys[i]];
      if (typeof val === 'string') obj[keys[i]] = val;
    }
    return obj;
  }

  /**
   * Where the node's own pages live. On an app origin (`<app>.apps.<apex>`) a relative "/v1/profile"
   * resolves to the APP's subdomain, which is not where the portal, the profile or the help pages
   * are served — and the session cookie is host-only on the apex, so such a link lands the user on
   * a logged-out copy of a page that does not belong to the app. Every node link is therefore
   * absolute to the apex, while an apex page keeps its plain relative links.
   */
  function nodeHref(path) {
    var m = /^(https?:\/\/)[^.]+\.apps\.(.+)$/.exec(location.origin);
    return m ? m[1] + m[2] + path : path;
  }

  function buildMarkup(t, links) {
    var nav = document.createElement('nav');
    nav.className = 'topnav';
    nav.innerHTML =
      '<div style="display:flex;align-items:center;gap:20px">' +
        '<a href="' + nodeHref(brandPath(false)) + '" class="topnav-brand" data-brand>AIME<span class="heart">♥</span><span class="brand-at">AT</span></a>' +
        '<span class="brand-morsels" data-morsels style="display:none"></span>' +
      '</div>' +
      '<div class="topnav-right">' +
        '<button class="topnav-burger" aria-label="Menu" data-burger>☰</button>' +
        '<div class="topnav-menu" data-menu>' +
          // The shell's links (./nav.js): the marketing pages for someone who has not signed in,
          // and Home, Messages, Agents, Chat, Apps and Settings the moment there is a session.
          // Every one is drawn hidden and refreshSession shows the ones this session gets.
          links.map(function (l, i) {
            return '<a href="' + esc(l.external ? l.href : nodeHref(l.href)) + '" data-link="' + i + '"' +
              (l.cls ? ' class="' + l.cls + '"' : '') + (l.external ? ' target="_blank" rel="noopener"' : '') +
              ' style="display:none">' + esc(t[l.key] || l.fallback) + '</a>';
          }).join('') +
          '<div class="topnav-center">' +
            // Theme toggle now lives inside the login pill (mountLoginButton) — see init().
            LANGS.map(function (l) {
              return '<button class="lang-btn" data-lang="' + l + '">' + l.toUpperCase() + '</button>';
            }).join('') +
          '</div>' +
        '</div>' +
        // The operator's new-version notice (components/NodeUpdateNotice.js in the SPA). This page
        // has no dialog, so the tag links to the SPA, which opens it (?nodeUpdate=1). The look is
        // the sun tag (.poster-chip--sun), inline because this page links theme.css and not poster.css.
        '<a data-node-update href="' + nodeHref('/v1/admin?nodeUpdate=1') + '" style="display:none;' +
          'padding:.1rem .45rem;border:1px solid var(--text);background:var(--sun);color:var(--on-sun);' +
          'font-family:var(--font-mono);font-size:.68rem;font-weight:500;letter-spacing:.04em;text-decoration:none"></a>' +
        '<span class="header-auth-slot" id="headerAuth"></span>' +
      '</div>';
    return nav;
  }

  function wire(nav, t, lang) {
    // Burger
    var burger = nav.querySelector('[data-burger]');
    var menu = nav.querySelector('[data-menu]');
    burger.addEventListener('click', function () { menu.classList.toggle('open'); });

    // (Theme toggle moved into the login pill — see mountLoginButton in init().)

    // Language buttons
    nav.querySelectorAll('[data-lang]').forEach(function (b) {
      if (b.getAttribute('data-lang') === lang) b.classList.add('active');
      b.addEventListener('click', function () {
        writeLang(b.getAttribute('data-lang'));
        // A ?lang= left in the address would win over the button just pressed, here and on the
        // server, so the page is asked for again without it.
        var u = new URL(location.href);
        if (u.searchParams.has('lang')) {
          u.searchParams.delete('lang');
          location.replace(u.pathname + u.search + u.hash);
          return;
        }
        location.reload();
      });
    });
  }

  /**
   * Fold the bar to the menu button when its row does not fit, by measurement (spa.html Header does
   * the same, and components/top-bar.css draws `.topnav--compact`). How much room the row needs
   * depends on the session and the language, which a fixed width cannot know. The test runs with
   * the bar expanded, since a folded bar always fits; no paint happens in between.
   */
  function fitBar(nav) {
    var menu = nav.querySelector('[data-menu]');
    var wasCompact = nav.classList.contains('topnav--compact');
    if (wasCompact) nav.classList.remove('topnav--compact');
    var group = /** @type {HTMLElement|null} */ (nav.lastElementChild);
    var contentRight = nav.getBoundingClientRect().right - (parseFloat(getComputedStyle(nav).paddingRight) || 0);
    var overflows = nav.scrollWidth > nav.clientWidth + 1 ||
      (!!group && (group.scrollWidth > group.clientWidth + 1 || group.getBoundingClientRect().right > contentRight + 1));
    nav.classList.toggle('topnav--compact', overflows);
    if (!overflows && wasCompact && menu) menu.classList.remove('open');
  }

  function refreshSession(nav, t, links, site) {
    var hasSession = !!(window.AIMEAT && window.AIMEAT.auth && window.AIMEAT.auth.hasSession);
    var session = hasSession && window.AIMEAT.auth.getSession ? window.AIMEAT.auth.getSession() : null;
    nav.querySelectorAll('[data-link]').forEach(function (el) {
      var link = links[Number(el.getAttribute('data-link'))];
      /** @type {HTMLElement} */ (el).style.display = (link && linkShown(link, session)) ? '' : 'none';
    });
    // The wordmark goes to one place per session state: the home signed in, the front page signed out.
    var brand = nav.querySelector('[data-brand]');
    if (brand) brand.setAttribute('href', nodeHref(brandPath(!!session)));
    var isOp = session && session.roles && session.roles.indexOf('operator') !== -1;
    var updateEl = /** @type {HTMLElement} */ (nav.querySelector('[data-node-update]'));
    updateEl.style.display = 'none';
    if (isOp && session.jwt) {
      fetch('/v1/admin/node-update', { headers: { 'Authorization': 'Bearer ' + session.jwt } })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var s = d && d.ok && d.data;
          if (!s || !s.enabled || !s.updateAvailable) return;
          updateEl.textContent = (t['nodeUpdate.pill'] || 'New: {version}').replace('{version}', s.latest);
          updateEl.title = t['nodeUpdate.pillTitle'] || '';
          updateEl.style.display = 'inline-block';
        })
        .catch(function () { updateEl.style.display = 'none'; });
    }
    var morselEl = /** @type {HTMLElement} */ (nav.querySelector('[data-morsels]'));
    // A bare number by the wordmark says nothing to the buyer of a customer's node (as in the shell).
    if (session && session.jwt && !site.customerNode) {
      fetch('/v1/wallet', { headers: { 'Authorization': 'Bearer ' + session.jwt } })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.ok && d.data && d.data.balance != null) {
            morselEl.textContent = d.data.balance;
            morselEl.style.display = 'inline-flex';
          } else { morselEl.style.display = 'none'; }
        })
        .catch(function () { morselEl.style.display = 'none'; });
    } else {
      morselEl.style.display = 'none';
    }
  }

  async function init() {
    applyTheme(readTheme());
    ensureThemeCss();
    var lang = readLang();
    document.documentElement.lang = lang;

    // What the node says about itself for this bar (routes/libs.ts writes it before the bundle).
    var site = window.__AIMEAT_HEADER_CFG__ || {};
    var loaded = await Promise.all([loadTranslations(lang), loadNavConfig()]);
    var t = loaded[0];
    var links = headerLinks(site, loaded[1]);
    var nav = buildMarkup(t, links);

    var mount = document.getElementById('aimeat-header');
    if (mount) { mount.appendChild(nav); }
    else { document.body.insertBefore(nav, document.body.firstChild); }

    wire(nav, t, lang);

    // Live login pill — the real thing, identical to the SPA.
    await loadScript('/v1/libs/aimeat-auth.js');
    if (window.AIMEAT && window.AIMEAT.auth && window.AIMEAT.auth.login) {
      try { await window.AIMEAT.auth.login(); } catch { /* not signed in — pill renders logged-out */ }
    }
    function mountPill() {
      try {
        if (window.AIMEAT && window.AIMEAT.auth && window.AIMEAT.auth.mountLoginButton) {
          var pillI18n = modalI18n(t);
          // Labels for the theme toggle the pill now renders.
          pillI18n.themeToDark = t['nav.themeToDark'] || NAV_FALLBACK['nav.themeToDark'];
          pillI18n.themeToLight = t['nav.themeToLight'] || NAV_FALLBACK['nav.themeToLight'];
          window.AIMEAT.auth.mountLoginButton('#headerAuth', {
            nameHref: nodeHref('/v1/home?settings=1'),
            onLogin: function () { window.dispatchEvent(new Event('aimeat-auth-change')); },
            onLogout: function () { window.dispatchEvent(new Event('aimeat-auth-change')); },
            i18n: pillI18n,
          });
        }
      } catch (e) { console.error('AIMEAT header: auth mount failed', e); }
    }
    mountPill();
    refreshSession(nav, t, links, site);
    window.addEventListener('aimeat-auth-change', function () { refreshSession(nav, t, links, site); });

    // The row is measured whenever its width or its contents change: the window, the session (the
    // pill and the links), a font arriving late.
    var raf = 0;
    function schedule() {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; fitBar(nav); });
    }
    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(schedule);
      ro.observe(nav);
      var slot = nav.querySelector('#headerAuth');
      if (slot) ro.observe(slot);
    }
    window.addEventListener('resize', schedule);
    window.addEventListener('aimeat-auth-change', schedule);
    schedule();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(); });
  } else {
    init();
  }
}
