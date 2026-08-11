/**
 * @file util.js
 * @description Pure helper functions for the app-catalog — no module state, no side effects
 *   (only params + DOM/window globals). Carved out of the former monolithic main.js as the first
 *   shared module so every feature module reuses ONE copy (no duplicated escaping/labels).
 * @structure
 *   - escapeHtml()      → HTML-escape for text AND attribute values (& < > " ')
 *   - jsArg()           → escape for a single-quoted JS argument inside an on* attribute
 *   - sourceLabel(), sourceLabelText() → source-kind labels
 *   - bareOwnerName(), sameOwner()     → owner-identifier comparison
 *   - filterAttr()      → the data-filter/data-tags pair used by the card search
 *   - isSameOriginUrl(), currentOwnerName(), generateId(), readFileAsText()
 * @usage import { escapeHtml, jsArg, sameOwner } from './util.js'
 * @version-history
 *   v1.0.0 — 2026-07-10 — Initial extraction (TARGET-021 Aalto 3 modularization, phase 1).
 *   v1.1.0 — 2026-08-11 — escapeHtml also escapes " and ' (audit H-25, stored XSS via filterAttr).
 */

/**
 * HTML-escape a string for BOTH text content and a quoted attribute value: & < > " '.
 *
 * The quotes are the reason this function exists in this shape. It used to serialize through a
 * detached element's textContent, which escapes & < > and leaves both quote characters intact —
 * correct for a text node, wrong for the attribute values most callers here build. filterAttr()
 * below puts another owner's published app name inside a double-quoted data-filter attribute, so
 * a name containing " ended the attribute and everything after it was parsed as more attributes,
 * including an event handler. /app-catalog.html runs on the apex under a script-src that allows
 * inline script, so that handler ran with the signed-in user's session (audit H-25). The publish
 * route type-checks the name and the tags without constraining their content, and the community
 * grid renders every published card through this path, so the escaping is the only thing standing
 * between one owner's manifest and another owner's page.
 *
 * Escaping ' as well is not needed by any current call site (every attribute the catalog builds is
 * double-quoted), and it costs nothing: an entity inside an attribute value or a text node decodes
 * back to the same character before anyone sees it. It is here so a single-quoted attribute added
 * later is safe by default rather than by review.
 *
 * The one context where the extra escaping is NOT a no-op is an on* handler whose contents a caller
 * escapes AGAIN at the JS level, because escapeHtml now consumes the quote that second pass looks
 * for. Use jsArg() for anything that lands inside a handler; it does the JS-level escaping in the
 * right order and stays the correct tool for that job.
 */
export function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape a user-controlled string for use as a single-quoted JS argument INSIDE a double-quoted
 * HTML on* attribute (e.g. onclick="window._launcher.foo('<here>')"). escapeHtml is not enough
 * here even though it now escapes quotes: an attribute value is HTML-decoded before the JS engine
 * parses it, so &#39; arrives at the parser as a plain apostrophe and an argument like "Fatalii's"
 * still terminates the JS string and throws "missing ) after argument list", breaking the button.
 * The escaping has to happen at the JS level to survive that decode. JS-escape the backslash +
 * single quote; HTML-escape the attribute/markup delimiters (they decode back to plain chars
 * before the JS engine sees them, which is the point).
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

/**
 * data-filter/data-tags attribute pair so a server card can be matched by search/tag without a
 * re-fetch. Both values come from a published manifest that another owner controls and the publish
 * route does not constrain, so the escapeHtml calls are load-bearing: they are what keeps a quote
 * in a name or a tag from closing the attribute (audit H-25). Nothing reads these back as markup —
 * applyServerFilter() uses getAttribute(), which returns the decoded original text — so the
 * escaping is invisible to the search that consumes them.
 */
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
