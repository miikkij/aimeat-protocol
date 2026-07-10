/**
 * @file util.js
 * @description Pure helper functions for the app-catalog — no module state, no side effects
 *   (only params + DOM/window globals). Carved out of the former monolithic main.js as the first
 *   shared module so every feature module reuses ONE copy (no duplicated escaping/labels).
 * @usage import { escapeHtml, jsArg, sameOwner } from './util.js'
 * @version-history
 *   v1.0.0 — 2026-07-10 — Initial extraction (TARGET-021 Aalto 3 modularization, phase 1).
 */

/** HTML-escape a string via a detached element's textContent (handles < > &). */
export function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Escape a user-controlled string for use as a single-quoted JS argument INSIDE a double-quoted
 * HTML on* attribute (e.g. onclick="window._launcher.foo('<here>')"). escapeHtml only handles
 * < > & — an apostrophe like in "Fatalii's" would otherwise terminate the JS string and throw
 * "missing ) after argument list", breaking the button. JS-escape the backslash + single quote;
 * HTML-escape the attribute/markup delimiters (they decode back to plain chars before the JS
 * engine sees them).
 */
export function jsArg(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\r\n]+/g, ' ');
}

/** Short icon+word label for a local app's source kind. */
export function sourceLabel(source) {
  switch (source) {
    case 'local': return '\u{1F4C4} local';
    case 'url':   return '\u{1F310} url';
    case 'aimeat': return '\u{1F4E6} aimeat';
    case 'zip':   return '\u{1F4E6} zip';
    default:      return source || 'unknown';
  }
}

/** Human word for a source kind (detail view). */
export function sourceLabelText(src) {
  var map = { url: 'URL', file: 'File', paste: 'Paste', aimeat: 'AIMEAT', zip: 'ZIP' };
  return map[src] || (src || '—');
}

/** The bare owner name (strip @node, lowercase). */
export function bareOwnerName(name) {
  return (name || '').split('@')[0].toLowerCase();
}

/** True when two owner identifiers refer to the same account (bare-name comparison). */
export function sameOwner(appOwner, sessionOwner) {
  if (!sessionOwner) return false;
  var a = bareOwnerName(appOwner);
  return !!a && a === bareOwnerName(sessionOwner);
}

/** data-filter/data-tags attribute pair so a server card can be matched by search/tag without a re-fetch. */
export function filterAttr(name, tags) {
  tags = (tags || []).map(function (tg) { return String(tg).toLowerCase(); });
  var searchable = escapeHtml((String(name || '') + ' ' + tags.join(' ')).toLowerCase());
  return ' data-filter="' + searchable + '" data-tags="' + escapeHtml(tags.join(',')) + '"';
}

/**
 * True only for URLs on this (apex SPA) origin. Such URLs — and blob: URLs, which inherit the
 * creator's origin — must NEVER run app HTML top-level: that is the H-2 cross-user session-theft
 * vector. Genuinely external URLs are already cross-origin and safe to open in a new tab.
 */
export function isSameOriginUrl(url) {
  try { return new URL(url, window.location.href).origin === window.location.origin; }
  catch (e) { return false; }
}

/**
 * The signed-in owner's bare name, from the aimeat-auth SDK session (or the persisted session
 * fallback), or null. Pure read of window.AIMEAT / localStorage — shared by main + the detail
 * module so neither has to reach into the other.
 */
export function currentOwnerName() {
  try {
    if (window.AIMEAT && window.AIMEAT.auth && window.AIMEAT.auth.getSession()) {
      return window.AIMEAT.auth.getSession().owner || null;
    }
    var stored = localStorage.getItem('aimeat_session');
    if (stored) return JSON.parse(stored).owner || null;
  } catch (e) {}
  return null;
}

/** A UUID (crypto.randomUUID with an older-browser fallback). Pure — shared by every module that mints app ids. */
export function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0;
    var v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/** Read a File/Blob as a UTF-8 string (Promise). Pure FileReader helper. */
export function readFileAsText(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = function () { reject(reader.error); };
    reader.readAsText(file);
  });
}
