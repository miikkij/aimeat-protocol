/**
 * @file site.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reader for this node's own public-page links (window.__SITE, injected by
 *   serveSpa from config.siteLinks). The marketing pages point at apps and contacts that
 *   belong to whoever runs the node, so nothing here is guaranteed to exist: a fresh clone
 *   has none of it, and every page must render fine without a single one.
 * @structure
 *   - siteLink(key) — the URL, or '' when this node has no such link
 *   - hasSite(key)  — presence test for hiding a nav item or a whole section
 *   - siteContacts() — the people to show, in approach order (possibly none)
 *   - contactHref(subject) — mailto: for the first contact, or '' when nobody is configured
 *   - signedInOnly() — the node shows its content to signed-in accounts only (contentAccess)
 *   - SIGN_IN_STEPS · signInFirst(pathname, signedIn) — which SPA addresses a visitor without a
 *     session reaches on such a node, and whether this one shows the sign-in page instead
 *   - customerNode() · storeOrdersHref(locale) — a node the store made for a buyer, and their orders
 * @usage import { siteLink, hasSite } from '/js/site.js';
 * @version-history
 *   v1.6.0 — 2026-10-29 — customerNode() and storeOrdersHref(): a node the store made for a buyer
 *     shows the customer's view, and the orders page in the store (UX review 2026-10-29, B to D).
 *   v1.5.2 — 2026-10-22 — /v1/eco-capability-allow is a sign-in step: the owner allows another
 *     account's capability to run an action of their outside app there.
 *   v1.5.1 — 2026-10-21 — /v1/secret-allow is a sign-in step: the owner allows a secret's use there.
 *   v1.5.0 — 2026-10-18 —signedInOnly(), SIGN_IN_STEPS and signInFirst(): on a node set to show its
 *     content to signed-in accounts only, a visitor without a session sees the sign-in page in place
 *     of every view except the steps of signing in (plan doc-mvcn6c7e4e5q, V1.5).
 *   v1.0.0 — 2026-07-28 — Initial. Makes every public-page app reference operator-configurable
 *     so a node that is not aimeat.io never advertises aimeat.io's apps or contact details.
 *   v1.1.0 — 2026-07-28 — Contacts become a list with roles (a company has more than one
 *     person), replacing the single contactName/Email/Phone trio.
 *   v1.4.1 — 2026-10-08 — storeSoonCode()'s comment: the store checks the code, not its payment provider.
 *   v1.4.0 — 2026-10-06 — storeSoonCode(): the shared discount code "Opens soon" shows when pressed.
 *   v1.3.0 — 2026-10-06 — storeOpensSoon() and storeSoonNote(): a store that shows its prices and does
 *     not take orders yet (site.store_status "soon").
 *   v1.2.0 — 2026-08-28 — storeHref(): the one price door. The pricing page is gone; every
 *     "get your own" control goes to the store when the node has one and hides when it does not.
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
 * Where "get your own" goes: the store this node sells through, or '' when it has none. The ONE
 * price door on the whole site: the store is its own AIMEAT instance and the only place a price
 * exists, so a caller with '' hides the control rather than pointing at a page of its own.
 * @returns {string}
 */
export function storeHref() {
  return siteLink('store');
}

/**
 * Whether the store is shown but does not take orders yet (site.store_status "soon"). Then the store
 * section keeps its prices, and every control that would lead into the store says "Opens soon"
 * instead. Never true on a node without a store.
 * @returns {boolean}
 */
export function storeOpensSoon() {
  return storeHref() !== '' && site().storeStatus === 'soon';
}

/**
 * The discount code "Opens soon" gives when pressed (site.store_soon_code), or '' when the store is
 * open or the operator set none. One code for everybody; the store checks it.
 * @returns {string}
 */
export function storeSoonCode() {
  return storeOpensSoon() ? siteLink('storeSoonCode') : '';
}

/**
 * The operator's own "opens soon" sentence for this language (site.store_note_en / _fi / _es), or ''
 * when they wrote none and the default text applies.
 * @param {string} locale 'en', 'fi' or 'es'
 * @returns {string}
 */
export function storeSoonNote(locale) {
  const key = { en: 'storeNoteEn', fi: 'storeNoteFi', es: 'storeNoteEs' }[String(locale || '').slice(0, 2)];
  return key ? siteLink(key) : '';
}

/**
 * Whether this is a customer's node: one the store's fleet service made for a buyer and named the
 * plan of (site.purchase_plan). The pages then show the customer's view: the welcome on the home,
 * the shorter menu, and no node maintenance in the top bar (UX review 2026-10-29; Jouni chose the
 * shorter menu and the maintenance move).
 * @returns {boolean}
 */
export function customerNode() {
  return siteLink('purchasePlan') !== '';
}

/**
 * The owner's orders and invoices in the store (site.store_orders_url) in the page's language, or ''
 * when the node has no such page.
 * @param {string} locale
 * @returns {string}
 */
export function storeOrdersHref(locale) {
  const raw = siteLink('storeOrders');
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.searchParams.set('lang', String(locale || 'en').slice(0, 2));
    return url.toString();
  } catch (err) {
    console.warn('[site] the orders address is not a URL:', err.message);
    return '';
  }
}

/**
 * @typedef {{ name: string, role: string, email: string, phone: string, linkedin: string }} SiteContact
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

/**
 * True when this node shows its content to its own signed-in accounts only (config contentAccess
 * 'signed-in'; routes/portal-spa.ts puts it on window.__SITE). The API refuses a visitor without a
 * session there (middleware/content-access-gate.ts), so the SPA shows such a visitor the sign-in page.
 * @returns {boolean}
 */
export function signedInOnly() {
  return site().contentAccess === 'signed-in';
}

/**
 * The SPA addresses that are steps of signing in, so a visitor without a session reaches them on a
 * signed-in-only node: an app's consent (app-grant), opening an app or a page that needs a sign-in
 * (app-open), an invitation (invite), a sign-in round an agent started (oauth-round) and allowing
 * what an agent asked for (allow). Each one asks for the sign-in itself. The agent device consent
 * (/v1/agents/verify) and the OAuth consent are the server's own pages and never reach the SPA.
 */
export const SIGN_IN_STEPS = new Set(['/v1/app-grant', '/v1/app-open', '/v1/invite', '/v1/oauth-round', '/v1/allow', '/v1/secret-allow', '/v1/eco-capability-allow']);

/**
 * Whether the view at `pathname` gives way to the sign-in page: on a signed-in-only node, for a
 * visitor without a session, everywhere except the steps of signing in. The public viewers (a shared
 * workspace, a welcome page, an app's guide) are content, so they ask for the sign-in too.
 * @param {string} pathname
 * @param {boolean} signedIn
 * @returns {boolean}
 */
export function signInFirst(pathname, signedIn) {
  return signedInOnly() && !signedIn && !SIGN_IN_STEPS.has(pathname);
}
