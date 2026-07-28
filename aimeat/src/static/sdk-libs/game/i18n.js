/**
 * @file game/i18n.js
 * @description Translation for the aimeat-game kit's OWN handful of strings, and the merge point
 *   for the host's. The kit ships English and Finnish for the words it puts on screen itself
 *   (Close, Back, Locked, Coming soon, …); everything else — every label in your game — comes from
 *   the host, because the kit has no idea what your entries are called.
 *
 *   The Finnish is written as Finnish, not as translated English.
 *
 *   It follows the PLATFORM language choice rather than inventing a second one: the current
 *   language is read from AIMEAT.auth.getLang() when the auth library is present, else the
 *   `aimeat-lang` storage key, else the browser, and it re-renders on the platform's
 *   `aimeat-lang-change` event. There is no language switch in this kit — the login pill has one.
 * @structure BASE (en/fi) · lang/setLang · use(dict) · t(key, vars) · onChange
 * @usage  AIMEAT.game.i18n.use({ fi: { play: 'Pelaa' }, en: { play: 'Play' } });
 *         AIMEAT.game.i18n.t('play');
 * @version-history
 *   v1.0.0 — 2026-07-28 — Initial (NOSTE prompt 01).
 */

/** The kit's own strings. A host dictionary of the same shape is merged over this. */
const BASE = {
  en: {
    close: 'Close',
    back: 'Back',
    cancel: 'Cancel',
    confirm: 'Confirm',
    menu: 'Menu',
    locked: 'Locked',
    done: 'Done',
    open: 'Open',
    now: 'Now',
    later: 'Later',
    comingSoon: 'Coming soon',
    notifyMe: 'Tell me when this opens',
    notified: 'We will tell you',
    eta: 'Expected {when}',
    empty: 'Nothing here yet',
    nobodyYet: 'No one on the board yet — the first entry sets the mark',
    you: 'You',
    total: 'Total',
    points: '{a} / {b}',
    earned: 'Earned',
    notEarned: 'Not earned yet',
    earnedOn: 'Earned {when}',
    best: 'Best {n}',
    inARow: '{n} in a row',
    sortBy: 'Sort by',
    morsels: 'morsels',
    target: 'Target {n}',
    fix: 'Fix this',
  },
  fi: {
    close: 'Sulje',
    back: 'Takaisin',
    cancel: 'Peruuta',
    confirm: 'Vahvista',
    menu: 'Valikko',
    locked: 'Lukossa',
    done: 'Tehty',
    open: 'Auki',
    now: 'Nyt',
    later: 'Myöhemmin',
    comingSoon: 'Tulossa',
    notifyMe: 'Kerro kun tämä aukeaa',
    notified: 'Ilmoitamme sinulle',
    eta: 'Arvio {when}',
    empty: 'Täällä ei ole vielä mitään',
    nobodyYet: 'Taululla ei ole vielä ketään — ensimmäinen asettaa rajan',
    you: 'Sinä',
    total: 'Yhteensä',
    points: '{a} / {b}',
    earned: 'Ansaittu',
    notEarned: 'Vielä ansaitsematta',
    earnedOn: 'Ansaittu {when}',
    best: 'Paras {n}',
    inARow: '{n} peräkkäin',
    sortBy: 'Järjestys',
    morsels: 'morselia',
    target: 'Tavoite {n}',
    fix: 'Korjaa tämä',
  },
};

/** Host dictionaries merged in by `use()`, keyed by language. */
const HOST = { en: {}, fi: {} };

/** @type {Array<(lang: string) => void>} */
const listeners = [];

let current = detect();

/** Resolve the platform language: auth library → storage key → browser → 'en'. */
function detect() {
  try {
    const ns = /** @type {any} */ (window).AIMEAT;
    if (ns && ns.auth && typeof ns.auth.getLang === 'function') {
      const l = ns.auth.getLang();
      if (l) return String(l).slice(0, 2);
    }
    const stored = localStorage.getItem('aimeat-lang');
    if (stored) return stored.slice(0, 2);
  } catch { /* storage blocked — fall through to the browser */ }
  return (navigator.language || 'en').slice(0, 2);
}

/** @param {string} lang */
function announce(lang) {
  for (const cb of listeners.slice()) {
    try { cb(lang); } catch { /* one bad listener never stops the rest */ }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('aimeat-lang-change', function (ev) {
    const detail = /** @type {any} */ (ev).detail;
    const lang = (detail && detail.lang) || detect();
    if (lang === current) return;
    current = String(lang).slice(0, 2);
    announce(current);
  });
}

export const i18n = {
  /** The languages the kit itself ships. A host may add more via `use()`. */
  langs: ['en', 'fi'],

  /** The language in force right now. @returns {string} */
  lang() { return current; },

  /**
   * Set the language for the kit AND the platform (one key, `aimeat-lang`, shared with the site).
   * @param {string} lang
   */
  setLang(lang) {
    const next = String(lang).slice(0, 2);
    if (next === current) return;
    current = next;
    try {
      const ns = /** @type {any} */ (window).AIMEAT;
      if (ns && ns.auth && typeof ns.auth.setLang === 'function') ns.auth.setLang(next);
      else localStorage.setItem('aimeat-lang', next);
    } catch { /* storage blocked — the in-memory language still changed */ }
    announce(current);
  },

  /**
   * Merge the host's dictionary over the kit's. Either `{ en: {...}, fi: {...} }` or a flat
   * object for the current language.
   * @param {Record<string, any>} dict
   */
  use(dict) {
    if (!dict) return;
    const looksNested = Object.keys(dict).every(function (k) {
      return dict[k] && typeof dict[k] === 'object' && !Array.isArray(dict[k]);
    });
    if (looksNested) {
      for (const lang in dict) {
        HOST[lang] = Object.assign({}, HOST[lang] || {}, dict[lang]);
      }
    } else {
      HOST[current] = Object.assign({}, HOST[current] || {}, dict);
    }
    announce(current);
  },

  /**
   * Look up a string: host(current) → kit(current) → kit(en) → the key itself. `{name}` in the
   * text is replaced from `vars`.
   * @param {string} key
   * @param {Record<string, any>} [vars]
   * @returns {string}
   */
  t(key, vars) {
    const text = (HOST[current] && HOST[current][key])
      || (BASE[current] && BASE[current][key])
      || (HOST.en && HOST.en[key])
      || BASE.en[key]
      || key;
    if (!vars) return String(text);
    return String(text).replace(/\{(\w+)\}/g, function (whole, name) {
      return vars[name] == null ? whole : String(vars[name]);
    });
  },

  /**
   * Run a callback whenever the language changes (host `use()` counts — new words arrived).
   * @param {(lang: string) => void} cb
   * @returns {() => void}  stop listening
   */
  onChange(cb) {
    listeners.push(cb);
    return function () {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    };
  },
};

/** Shorthand used inside the kit's own components. @type {(key: string, vars?: any) => string} */
export const t = i18n.t;
