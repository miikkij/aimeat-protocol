/**
 * @file public/components/StoreDoor.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every control that leads into the store, and the line that says the store is not open
 *   yet. While the store takes orders (site.store_status "open", the default) StoreDoor is the link it
 *   always was, opening the store beside. While it is "soon" the same place carries "Opens soon" as a
 *   label with the same shape and no link, so nothing on the page leads into a store that cannot sell.
 *   Without a store address both draw nothing. A page passes its own classes and words.
 * @structure StoreDoor({ class, label, newTab?, href?, soon? }) · StoreSoonNote({ class, soon? })
 * @usage html`<${StoreDoor} class="ld-sh-door showroom-door" label=${tr('landing.showGetOwn', 'Get your own →')} />`
 * @version-history
 *   v1.0.0 — 2026-10-06 — Initial: site.store_status "soon" on aimeat.io while the store's payments are
 *     in test mode.
 */
import { h } from 'preact';
import htm from 'htm';
import { t, getLocale } from '/js/i18n.js';
import { storeHref, storeOpensSoon, storeSoonNote } from '/js/site.js';

const html = htm.bind(h);

// t() echoes the key when a translation is missing, so fall back to readable English.
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/**
 * A link into the store, or "Opens soon" in its place.
 * @param {{ class?: string, label: string, newTab?: boolean, href?: string, soon?: boolean }} props
 *   `newTab` false keeps a link that always opened in the same tab doing so. `href` and `soon` default
 *   to this node's store settings; the design lab passes them to draw both states.
 */
export function StoreDoor({ class: cls = '', label, newTab = true, href = storeHref(), soon = storeOpensSoon() }) {
  if (!href) return null;
  if (soon) {
    return html`<span class=${(cls + ' store-soon').trim()}>${tr('landing.storeOpensSoon', 'Opens soon')}</span>`;
  }
  return newTab
    ? html`<a class=${cls || undefined} href=${href} target="_blank" rel="noopener">${label}</a>`
    : html`<a class=${cls || undefined} href=${href}>${label}</a>`;
}

/**
 * The sentence that says the marketplace is not open yet: the operator's own for this language when
 * they wrote one, the default otherwise. Nothing while the store is open.
 * @param {{ class?: string, soon?: boolean }} props `soon` defaults to this node's store settings.
 */
export function StoreSoonNote({ class: cls = '', soon = storeOpensSoon() }) {
  if (!soon) return null;
  const note = storeSoonNote(getLocale()) || tr('landing.storeSoonNote', 'The marketplace opens soon.');
  return html`<p class=${(cls + ' store-soon-note').trim()}>${note}</p>`;
}

export default StoreDoor;
