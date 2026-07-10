/**
 * @file i18n.js
 * @description Catalogue i18n function layer — the t() lookup, the current-language state, and the
 *   static-chrome applier (data-i18n / -ph / -title + <html lang> + document title + the language
 *   toggle highlight). The translation TABLES live in i18n-data.js; this module is the behaviour
 *   over them. Carved out of main.js so any feature module can import t() directly, with no import
 *   cycle back through the entry module.
 * @usage import { t, getLang, setLang, applyI18n } from './i18n.js'
 * @version-history
 *   v1.0.0 — 2026-07-10 — Initial extraction (TARGET-021 Aalto 3 modularization, phase 4).
 */
import { I18N } from './i18n-data.js';

// Current UI language ('en' | 'fi'). Module-private: read via getLang(), changed via setLang().
// The language *action* (persist to config + re-render dynamic sections) stays in main.js as
// setLanguage(); this module owns only the value plus applying it to the static chrome.
let currentLang = 'en';

export function getLang() { return currentLang; }

/** Set the active language (normalised to 'fi' or 'en'). Does NOT persist or re-render — caller's job. */
export function setLang(lang) { currentLang = (lang === 'fi') ? 'fi' : 'en'; }

export function t(key) {
  var table = I18N[currentLang] || I18N.en;
  if (table[key] != null) return table[key];
  if (I18N.en[key] != null) return I18N.en[key];
  return key;
}

export function applyI18n() {
  var i, nodes;
  nodes = document.querySelectorAll('[data-i18n]');
  for (i = 0; i < nodes.length; i++) nodes[i].textContent = t(nodes[i].getAttribute('data-i18n'));
  nodes = document.querySelectorAll('[data-i18n-ph]');
  for (i = 0; i < nodes.length; i++) nodes[i].setAttribute('placeholder', t(nodes[i].getAttribute('data-i18n-ph')));
  nodes = document.querySelectorAll('[data-i18n-title]');
  for (i = 0; i < nodes.length; i++) nodes[i].setAttribute('title', t(nodes[i].getAttribute('data-i18n-title')));
  document.documentElement.lang = currentLang;
  document.title = t('header.title') + ' — AIMEAT';
  updateLangToggle();
}

// Highlight the active button in the #lang-toggle picker. Internal to applyI18n.
function updateLangToggle() {
  var btns = document.querySelectorAll('#lang-toggle .lang-btn');
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle('active', btns[i].getAttribute('data-lang') === currentLang);
  }
}
