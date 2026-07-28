/**
 * @file site.js
 * @description Reader for this node's own public-page links (window.__SITE, injected by
 *   serveSpa from config.siteLinks). The marketing pages point at apps and contacts that
 *   belong to whoever runs the node, so nothing here is guaranteed to exist: a fresh clone
 *   has none of it, and every page must render fine without a single one.
 * @structure
 *   - siteLink(key) — the URL, or '' when this node has no such link
 *   - hasSite(key)  — presence test for hiding a nav item or a whole section
 *   - siteContacts() — the people to show, in approach order (possibly none)
 *   - contactHref(subject) — mailto: for the first contact, or '' when nobody is configured
 * @usage import { siteLink, hasSite } from '/js/site.js';
 * @version-history
 *   v1.0.0 — 2026-07-28 — Initial. Makes every public-page app reference operator-configurable
 *     so a node that is not aimeat.io never advertises aimeat.io's apps or contact details.
 *   v1.1.0 — 2026-07-28 — Contacts become a list with roles (a company has more than one
 *     person), replacing the single contactName/Email/Phone trio.
 */

/** @returns {Record<string, any>} */
function site() {
  const s = /** @type {any} */ (window).__SITE;
  return (s && typeof s === 'object') ? s : {};
}

/**
 * The configured URL for a site link, or '' when this node does not have one.
 * Callers render conditionally on the empty string; they never hardcode a fallback.
 * @param {string} key one of: learn, exchange, assessment, roadmap, paper, crm, radar,
 *   briefing, apiAccelerator, playbooks, showcase, contactName, contactEmail, contactPhone
 * @returns {string}
 */
export function siteLink(key) {
  const v = site()[key];
  return typeof v === 'string' ? v : '';
}

/**
 * Whether this node has the given link configured. Use to drop a nav item, a proof link or
 * a whole section rather than rendering a dead control.
 * @param {string} key
 * @returns {boolean}
 */
export function hasSite(key) {
  return siteLink(key) !== '';
}

/**
 * @typedef {{ name: string, role: string, email: string, phone: string }} SiteContact
 */

/**
 * The people this node prints on its public pages, in the order they should be approached.
 * Empty when the node configured nobody, which is a valid state: the page then renders no
 * contact card and no "talk to us" control rather than a dead one.
 * @returns {SiteContact[]}
 */
export function siteContacts() {
  const c = site().contacts;
  return Array.isArray(c) ? c.filter(x => x && typeof x.email === 'string' && x.email !== '') : [];
}

/**
 * mailto: href for the FIRST configured contact, or '' when nobody is configured. First
 * rather than "the founder" on purpose: whoever should field the first message goes first
 * in the list, and every call to action mails them.
 * @param {string} [subject] optional pre-filled subject line
 * @returns {string}
 */
export function contactHref(subject) {
  const first = siteContacts()[0];
  if (!first) return '';
  return subject ? `mailto:${first.email}?subject=${encodeURIComponent(subject)}` : `mailto:${first.email}`;
}
