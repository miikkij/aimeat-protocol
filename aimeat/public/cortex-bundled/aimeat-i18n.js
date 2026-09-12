/**
 * @file aimeat-i18n.js
 * @description Bundled cortex library for AIMEAT apps, in two independent halves.
 *
 *   AIMEAT.i18n — WHICH WORDS. Translation loading (inline or from the user's own memory, since
 *   translations are USER data), a flat-key-first `t()` with {var} interpolation, locale switching
 *   with persistence, a LanguageSwitcher, and a data-i18n DOM applier.
 *
 *   AIMEAT.fmt — HOW THINGS ARE WRITTEN. Dates, times, numbers, money and morsels in the reader's
 *   own format, read in the reader's own clock. Driven by their PROFILE, not by the language.
 *
 *   THE TWO HALVES ARE INDEPENDENT AND MUST STAY THAT WAY. Language, regional format and time zone
 *   are three separate settings, the way an operating system keeps them, and a person is free to
 *   mix them: Finnish words with an American date format and a Tokyo clock is a legitimate
 *   combination and the library's job is to obey all three. Deriving the format from the language
 *   is the specific defect this split exists to prevent.
 *   → decision "Kieli, esitysmuoto ja aikavyöhyke ovat kolme erillistä asetusta", 2026-09-12
 *
 *   AND MORSELS ARE NOT MONEY. fmt.money() refuses them outright. A morsel paces what agents may
 *   push into the store; it accrues on its own and it buys nothing. fmt.morsels() formats them and
 *   never attaches a currency symbol.
 *
 *   No backend, no hard deps; uses AIMEAT.data when present to load translations from memory.
 * @structure
 *   AIMEAT.i18n.{init,t,setLocale,getLocale,locales,available,LanguageSwitcher,apply}
 *   AIMEAT.fmt.{use,useProfile,region,timezone,number,date,time,dateTime,relative,money,morsels,
 *               resolvedTimeZone,zoneLabel}
 * @version-history
 *   v1.1.0 — 2026-09-12 — AIMEAT.fmt: the formatting half, driven by the profile rather than by the
 *     language, with money() refusing morsels.
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

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // AIMEAT.fmt — HOW THINGS ARE WRITTEN, which is not the same question as which words appear.
  //
  // The two halves of this file are deliberately independent. `i18n` decides the WORDS and is
  // driven by the language pill. `fmt` decides how a date, a number and an amount are WRITTEN, and
  // which clock a time is read in, and it is driven by the person's profile. An operating system
  // keeps display language, regional format and time zone apart and lets a person mix them freely;
  // so does this. Deriving one from the other is the defect this half exists to prevent — the node's
  // own admin pages had six copies of a line that did exactly that, and they had already drifted.
  // → decision "Kieli, esitysmuoto ja aikavyöhyke ovat kolme erillistä asetusta", 2026-09-12
  //
  // NOTHING SET MEANS FOLLOW THE BROWSER, which is what every app did before this existed. An app
  // that never calls fmt.use() behaves exactly as it did.
  // ══════════════════════════════════════════════════════════════════════════════════════════

  var fmtState = { region: null, timezone: null };

  /** The tag to format with, or undefined — which IS the browser's own default. */
  function fmtTag() { return fmtState.region || undefined; }

  /** Merge the reader's clock into an option bag. Nothing set: the browser's own zone applies. */
  function withZone(opts) {
    if (!fmtState.timezone) return opts || {};
    var out = {}; for (var k in (opts || {})) out[k] = opts[k];
    out.timeZone = fmtState.timezone; return out;
  }

  function asDate(v) {
    var d = (v instanceof Date) ? v : new Date(v);
    return isFinite(d.getTime()) ? d : null;
  }

  /**
   * Tell the library how this reader writes things: fmt.use({ region, timezone }).
   *
   * An app that has the person's profile passes it here once. An app that does not, does not call
   * it, and every formatter follows the browser.
   */
  function use(prefs) {
    fmtState.region = (prefs && prefs.region) || null;
    fmtState.timezone = (prefs && prefs.timezone) || null;
    return { region: fmtState.region, timezone: fmtState.timezone };
  }

  /**
   * Read the settings off the signed-in person's profile, when the app is running on their node.
   * Resolves to the settings either way; a signed-out reader simply follows their browser.
   */
  function useProfile() {
    return fetch('/v1/ghii/me', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (body) { return use(body && body.data); })
      .catch(function () { return use(null); });
  }

  function fmtNumber(n, opts) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    try { return new Intl.NumberFormat(fmtTag(), opts || {}).format(n); } catch (e) { return String(n); }
  }

  function fmtDate(v, opts) {
    var d = asDate(v); if (!d) return '—';
    try { return d.toLocaleDateString(fmtTag(), withZone(opts)); } catch (e) { return String(v); }
  }

  function fmtTime(v, opts) {
    var d = asDate(v); if (!d) return '—';
    try { return d.toLocaleTimeString(fmtTag(), withZone(opts)); } catch (e) { return String(v); }
  }

  function fmtDateTime(v, opts) {
    var d = asDate(v); if (!d) return '—';
    try { return d.toLocaleString(fmtTag(), withZone(opts)); } catch (e) { return String(v); }
  }

  /** "3 days ago", "in 2 hours". */
  function fmtRelative(v) {
    var d = asDate(v); if (!d) return '—';
    var value = Math.round((d.getTime() - Date.now()) / 1000);
    var steps = [['second', 60], ['minute', 60], ['hour', 24], ['day', 7], ['week', 4.345], ['month', 12], ['year', Infinity]];
    var unit = 'second';
    for (var i = 0; i < steps.length; i++) {
      unit = steps[i][0];
      if (Math.abs(value) < steps[i][1]) break;
      value = Math.round(value / steps[i][1]);
    }
    try { return new Intl.RelativeTimeFormat(fmtTag(), { numeric: 'auto' }).format(value, unit); }
    catch (e) { return fmtDateTime(d); }
  }

  /**
   * AN AMOUNT OF MONEY. Refuses morsels, on purpose and loudly.
   *
   * A morsel is a PACER, not a currency and not a credit: it paces what agents may push into the
   * store, it accrues while the owner is idle, and it buys nothing. Money is a separate matter with
   * its own rails, and it sits beside morsels rather than counting them. The two are numbers of
   * similar size on the same screens, so a formatter that accepted both would put a euro sign over
   * somebody's pacing meter — which would tell every reader something false about what this
   * platform is. Use fmt.morsels().
   */
  function fmtMoney(n, currency, opts) {
    var code = String(currency || '').toUpperCase();
    if (code === 'MORSEL' || code === 'MORSELS' || code === 'MRSL') {
      throw new TypeError('AIMEAT.fmt.money will not format morsels: a morsel is a pacer, not a currency, and it buys nothing. Use AIMEAT.fmt.morsels().');
    }
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    var digits = (n !== 0 && Math.abs(n) < 0.01) ? 4 : 2;
    var o = { style: 'currency', currency: code || 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits };
    for (var k in (opts || {})) o[k] = opts[k];
    try { return new Intl.NumberFormat(fmtTag(), o).format(n); }
    catch (e) { return fmtNumber(n) + ' ' + code; }
  }

  /** A morsel COUNT. Never a currency symbol; the word travels with the number. */
  function fmtMorsels(n, word) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    return fmtNumber(n) + ' ' + (word || t('morsels') || 'morsels');
  }

  /** The units a span is broken into, biggest first, with how many milliseconds each holds. */
  var SPAN_UNITS = [['days', 86400000], ['hours', 3600000], ['minutes', 60000], ['seconds', 1000]];

  /**
   * A LENGTH OF TIME — "1pv 23t 26min" — in the reader's own language and their own shorthand.
   *
   * A different question from relative(), which says how long AGO. This is a span: an uptime, a
   * countdown, how long a job took.
   *
   * DO NOT REACH FOR A TRANSLATION KEY HERE. `{n} pv` survives Finnish only because `pv` does not
   * inflect; one `{n}` cannot carry a language whose noun changes with the number (Polish `1 dzień`
   * but `2 dni`, Russian `1 день`, `2 дня`, `5 дней`), and no key can produce "eilen". CLDR holds
   * every one of those rules and Intl reads them.
   *
   * @param {number} ms how long, in milliseconds; a negative span is read as its length
   * @param {Object} [opts] `max` is how many units may appear (default 3). Everything else goes to
   *   Intl.DurationFormat, so `{ style: 'long' }` spells the units out.
   */
  function fmtDuration(ms, opts) {
    var n = Math.abs(Number(ms));
    if (!isFinite(n)) return '—';
    var o = opts || {};
    var max = typeof o.max === 'number' ? o.max : 3;
    var parts = {}, left = Math.round(n / 1000) * 1000, used = 0;
    for (var i = 0; i < SPAN_UNITS.length; i++) {
      var unit = SPAN_UNITS[i][0], size = SPAN_UNITS[i][1];
      var v = Math.floor(left / size);
      // Empty units are skipped until the first non-empty one, so two days and six minutes still
      // says minutes rather than stopping at the hours.
      if (v > 0 || used > 0) {
        if (v > 0) { parts[unit] = v; used++; }
        if (used >= max) break;
      }
      left -= v * size;
    }
    // An empty string in the middle of a sentence reads as broken rather than as "no time at all",
    // and a zero is dropped by default, so this case asks for it out loud.
    var zero = used === 0;
    if (zero) parts.seconds = 0;
    var bag = { style: 'narrow' };
    if (zero) bag.secondsDisplay = 'always';
    for (var k in o) if (k !== 'max') bag[k] = o[k];
    try {
      return new Intl.DurationFormat(fmtTag(), bag).format(parts);
    } catch (e) {
      // Intl.DurationFormat is Baseline since March 2025; an older browser lands here.
      var out = [];
      for (var u in parts) out.push(parts[u] + u.charAt(0));
      return out.join(' ');
    }
  }

  /** The zone actually in force, always a real IANA name. */
  function resolvedTimeZone() {
    if (fmtState.timezone) return fmtState.timezone;
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; }
  }

  /**
   * How to name the zone beside a time ("EET"), or null when there is nothing worth saying.
   *
   * Null while the reader follows their browser: naming the clock somebody is already reading
   * teaches them nothing. Once a zone IS chosen the label is shown every time rather than only when
   * it differs from the device — a mark that appears only on a mismatch is itself the surprise.
   */
  function zoneLabel(v) {
    if (!fmtState.timezone) return null;
    var d = asDate(v || new Date()); if (!d) return null;
    try {
      var parts = new Intl.DateTimeFormat(fmtTag(), { timeZone: fmtState.timezone, timeZoneName: 'short' }).formatToParts(d);
      for (var i = 0; i < parts.length; i++) if (parts[i].type === 'timeZoneName') return parts[i].value;
      return null;
    } catch (e) { return null; }
  }

  AIMEAT.fmt = {
    use: use, useProfile: useProfile,
    region: function () { return fmtState.region; },
    timezone: function () { return fmtState.timezone; },
    // `num` and `number` are the same function under two names. `num` is what /js/format.js and the
    // served SDK libraries call it, and three of them were calling `AIMEAT.fmt.num` against a
    // surface that only had `number` — a guarded call, so nothing threw and the person's setting
    // was simply ignored. Both names stay: an app written against `number` keeps working.
    num: fmtNumber, number: fmtNumber,
    date: fmtDate, time: fmtTime, dateTime: fmtDateTime, duration: fmtDuration,
    relative: fmtRelative, money: fmtMoney, morsels: fmtMorsels,
    resolvedTimeZone: resolvedTimeZone, zoneLabel: zoneLabel,
  };
})(window.AIMEAT || (window.AIMEAT = {}));
