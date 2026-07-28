/**
 * @file site.js
 * @description Reader for this node's own public-page links (window.__SITE, injected by
 *   serveSpa from config.siteLinks). The marketing pages point at apps and contacts that
 *   belong to whoever runs the node, so nothing here is guaranteed to exist: a fresh clone
 *   has none of it, and every page must render fine without a single one.
 * @structure
 *   - siteLink(key) — the URL, or '' when this node has no such link
 *   - hasSite(key)  — presence test for hiding a nav item or a whole section
 *   - contactHref(subject) — mailto: for the configured contact, or '' when unset
 * @usage import { siteLink, hasSite } from '/js/site.js';
 * @version-history
 *   v1.0.0 — 2026-07-28 — Initial. Makes every public-page app reference operator-configurable
 *     so a node that is not aimeat.io never advertises aimeat.io's apps or contact details.
 */

/** @returns {Record<string, string>} */
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
 * mailto: href for the configured contact, or '' when no contact email is set. An empty
 * return means the page should not render a "contact us" control at all.
 * @param {string} [subject] optional pre-filled subject line
 * @returns {string}
 */
export function contactHref(subject) {
  const email = siteLink('contactEmail');
  if (!email) return '';
  return subject ? `mailto:${email}?subject=${encodeURIComponent(subject)}` : `mailto:${email}`;
}
