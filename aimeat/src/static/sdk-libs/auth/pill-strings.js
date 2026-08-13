/**
 * @file auth/pill-strings.js
 * @description The login pill's OWN labels, in the languages the node ships. The pill draws the
 *   language switch, so it is the one widget on the page that always knows which language the reader
 *   chose; before this it rendered "logged in / Logout" in English underneath a Spanish page, because
 *   the labels defaulted to English literals and only the SPA ever passed `opts.i18n`. Every app that
 *   declares `aimeat-locales` now gets the pill in the reader's language without passing anything.
 *
 *   Why a table rather than a fetch: locales/en.json is 479 kB, and loading half a megabyte on every
 *   app page for eleven words is not a trade worth making. These eleven strings are the pill cluster's
 *   entire vocabulary.
 *
 *   The English column matches `modal.*` in locales/en.json where a key exists there, EXCEPT
 *   `signInBtn`: the pill's button keeps the heart and the shorter wording it has always had, because
 *   it sits in a header row rather than in the modal. `federated`, `manageAccess` and `account` are
 *   pill-only and live here alone.
 * @structure PILL_STRINGS (en/fi/es) · pillStrings(lang)
 * @usage import { pillStrings } from './pill-strings.js';
 *   const i = Object.assign({}, pillStrings(lang), opts.i18n);   // a caller's strings always win
 * @version-history
 *   v1.0.0 — 2026-08-13 — Initial. Born from a Spanish CADENCE showing an English "Logout".
 */

export var PILL_STRINGS = {
  en: {
    loggedIn: 'logged in', logoutBtn: 'Logout', signInBtn: '❤️ Sign In', account: 'Account',
    federated: 'Federated', manageAccess: 'Manage permissions',
    lightMode: 'Light mode', darkMode: 'Dark mode', themeLabel: 'Theme',
    chooseLook: 'Choose look', switchLanguage: 'Language',
  },
  fi: {
    loggedIn: 'kirjautuneena', logoutBtn: 'Kirjaudu ulos', signInBtn: '❤️ Kirjaudu', account: 'Tili',
    federated: 'Federoitu', manageAccess: 'Hallitse oikeuksia',
    lightMode: 'Vaalea tila', darkMode: 'Tumma tila', themeLabel: 'Teema',
    chooseLook: 'Valitse tyyli', switchLanguage: 'Kieli',
  },
  es: {
    loggedIn: 'sesión iniciada', logoutBtn: 'Cerrar sesión', signInBtn: '❤️ Entrar', account: 'Cuenta',
    federated: 'Federado', manageAccess: 'Gestionar permisos',
    lightMode: 'Modo claro', darkMode: 'Modo oscuro', themeLabel: 'Tema',
    chooseLook: 'Elige el aspecto', switchLanguage: 'Idioma',
  },
};

/** The pill's labels for one language, falling back to English per key. */
export function pillStrings(lang) {
  var base = PILL_STRINGS.en;
  var over = PILL_STRINGS[lang] || {};
  var out = {};
  for (var k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = over[k] || base[k];
  return out;
}
