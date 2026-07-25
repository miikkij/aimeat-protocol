/**
 * @file aimeat-i18n.js
 * @description Bundled cortex library: lightweight i18n/localization helper for AIMEAT apps.
 *   Wraps translation loading (inline or from the user's own memory — translations are USER
 *   data), a flat-key-first `t()` with {var} interpolation, locale switching with persistence,
 *   a daisyUI-friendly LanguageSwitcher, and a data-i18n DOM applier. No backend, no hard deps;
 *   uses AIMEAT.data when present to load translations from memory.
 * @structure AIMEAT.i18n.{init,t,setLocale,getLocale,locales,available,LanguageSwitcher,apply}
 * @version-history
 *   v1.0.0 — 2026-06-26 — Initial: inline + memory-backed translations, switcher, DOM applier.
 */
(function (AIMEAT) {
  'use strict';

  var state = { keyBase: null, localeList: [], locale: 'en', dicts: {}, fallback: 'en' };
  // THE platform locale key — same as the SPA (public/js/utils.js), the sign-in modal and the
  // login pill's language control. A private 'aimeat-i18n-locale' was a third convention that
  // silently disagreed with the other two.
  var STORE_KEY = 'aimeat-lang';
  var styled = false;

  function injectStyles() {
    if (styled) return; styled = true;
    var css =
      '.aui-i18n-select{font-family:"DM Sans",system-ui,sans-serif;font-size:.875rem;' +
      'padding:.35rem .6rem;border-radius:var(--radius-xs,6px);border:1px solid var(--border,#E5E7EB);' +
      'background:var(--bg-card,#fff);color:var(--text,#1A1A2E);cursor:pointer;}';
    var s = document.createElement('style'); s.setAttribute('data-aimeat', 'i18n'); s.textContent = css;
    document.head.appendChild(s);
  }

  function getPath(obj, path) {
    var parts = String(path).split('.'); var o = obj;
    for (var i = 0; i < parts.length; i++) { if (o == null) return null; o = o[parts[i]]; }
    return o;
  }
  function interpolate(str, vars) {
    if (!vars) return str;
    return str.replace(/\{(\w+)\}/g, function (m, k) { return (vars[k] != null) ? vars[k] : m; });
  }

  // Load a single locale's dictionary: inline first, then the user's memory (USER data).
  function loadDict(locale) {
    if (state.dicts[locale]) return Promise.resolve(state.dicts[locale]);
    if (state.keyBase && AIMEAT.data && typeof AIMEAT.data.get === 'function') {
      return Promise.resolve(AIMEAT.data.get(state.keyBase + '.' + locale))
        .then(function (v) { if (v && typeof v === 'object') state.dicts[locale] = v; return state.dicts[locale] || {}; })
        .catch(function () { return {}; });
    }
    return Promise.resolve({});
  }

  /**
   * init({ keyBase?, locales, default?, fallback?, translations? })
   *  - translations: optional inline map { en:{...}, fi:{...} } (used as-is, no memory read)
   *  - keyBase: memory key prefix; locale dicts read from `${keyBase}.${locale}` via AIMEAT.data
   */
  function init(opts) {
    opts = opts || {};
    state.keyBase = opts.keyBase || null;
    state.localeList = opts.locales || (opts.translations ? Object.keys(opts.translations) : ['en']);
    state.fallback = opts.fallback || opts.default || state.localeList[0] || 'en';
    if (opts.translations) state.dicts = Object.assign({}, opts.translations);
    var saved = null;
    try { saved = window.localStorage.getItem(STORE_KEY); } catch (e) { /* private mode */ }
    state.locale = (saved && state.localeList.indexOf(saved) !== -1) ? saved : (opts.default || state.fallback);
    return loadDict(state.locale).then(function () { return state.locale; });
  }

  function t(key, vars) {
    var d = state.dicts[state.locale] || {};
    var raw = (d[key] != null) ? d[key] : getPath(d, key);
    if (raw == null) {
      var fb = state.dicts[state.fallback] || {};
      raw = (fb[key] != null) ? fb[key] : getPath(fb, key);
    }
    if (raw == null) raw = key;
    return interpolate(String(raw), vars);
  }

  function setLocale(locale) {
    if (state.localeList.indexOf(locale) === -1) return Promise.resolve(state.locale);
    return loadDict(locale).then(function () {
      state.locale = locale;
      try { window.localStorage.setItem(STORE_KEY, locale); } catch (e) { /* ignore */ }
      try { document.cookie = 'aimeat-lang=' + locale + ';path=/;max-age=31536000;SameSite=Lax'; } catch (e) { /* ignore */ }
      try { window.dispatchEvent(new CustomEvent('aimeat-lang-change', { detail: { lang: locale } })); } catch (e) { /* ignore */ }
      try { window.dispatchEvent(new CustomEvent('aimeat-i18n-changed', { detail: { locale: locale } })); } catch (e) { /* ignore */ }
      return locale;
    });
  }

  function getLocale() { return state.locale; }
  function locales() { return state.localeList.slice(); }
  function available() { return state.localeList.length > 0; }

  // Translate every [data-i18n] element in root (textContent). Optional [data-i18n-attr].
  function apply(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i]; var key = n.getAttribute('data-i18n');
      var attr = n.getAttribute('data-i18n-attr');
      if (attr) n.setAttribute(attr, t(key)); else n.textContent = t(key);
    }
  }

  function LanguageSwitcher(opts) {
    opts = opts || {}; injectStyles();
    var sel = document.createElement('select');
    sel.className = 'aui-i18n-select ' + (opts.className || '');
    state.localeList.forEach(function (loc) {
      var o = document.createElement('option'); o.value = loc; o.textContent = (opts.labels && opts.labels[loc]) || loc.toUpperCase();
      if (loc === state.locale) o.selected = true; sel.appendChild(o);
    });
    sel.addEventListener('change', function () {
      setLocale(sel.value).then(function (loc) { if (typeof opts.onChange === 'function') opts.onChange(loc); });
    });
    if (opts.target) {
      var tgt = (typeof opts.target === 'string') ? document.querySelector(opts.target) : opts.target;
      if (tgt) tgt.appendChild(sel);
    }
    return { el: sel, destroy: function () { if (sel.parentNode) sel.parentNode.removeChild(sel); } };
  }

  AIMEAT.i18n = { init: init, t: t, setLocale: setLocale, getLocale: getLocale, locales: locales, available: available, LanguageSwitcher: LanguageSwitcher, apply: apply };
  AIMEAT['aimeat-i18n'] = AIMEAT.i18n;
})(window.AIMEAT || (window.AIMEAT = {}));
