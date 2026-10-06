/**
 * @file public/components/StoreDoor.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every control that leads into the store, and the line that says the store is not open
 *   yet. While the store takes orders (site.store_status "open", the default) StoreDoor is the link it
 *   always was, opening the store beside. While it is "soon" the same place carries "Opens soon" as a
 *   label with the same shape and no link, so nothing on the page leads into a store that cannot sell.
 *   When the operator set a discount code (site.store_soon_code), "Opens soon" can be pressed and shows
 *   that code with a copy button. Without a store address everything draws nothing. A page passes its
 *   own classes and words.
 * @structure StoreDoor({ class, label, newTab?, href?, soon?, code? }) · StoreSoonCode({ code }) ·
 *   StoreSoonNote({ class, soon? })
 * @usage html`<${StoreDoor} class="ld-sh-door showroom-door" label=${tr('landing.showGetOwn', 'Get your own →')} />`
 * @version-history
 *   v1.1.0 — 2026-10-06 — With site.store_soon_code set, "Opens soon" is pressable and shows the shared
 *     discount code (StoreSoonCode) with a copy button (Jouni: "When you click we should give them
 *     discount code").
 *   v1.0.0 — 2026-10-06 — Initial: site.store_status "soon" on aimeat.io while the store's payments are
 *     in test mode.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t, getLocale } from '/js/i18n.js';
import { storeHref, storeOpensSoon, storeSoonNote, storeSoonCode } from '/js/site.js';
import { CopyButton } from '/components/CopyButton.js';

const html = htm.bind(h);

// t() echoes the key when a translation is missing, so fall back to readable English.
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/**
 * A link into the store, or "Opens soon" in its place. With a discount code set, "Opens soon" can be
 * pressed, and the press puts the code in its place with a copy button.
 * @param {{ class?: string, label: string, newTab?: boolean, href?: string, soon?: boolean, code?: string }} props
 *   `newTab` false keeps a link that always opened in the same tab doing so. `href`, `soon` and `code`
 *   default to this node's store settings; the design lab passes them to draw every state.
 */
export function StoreDoor({ class: cls = '', label, newTab = true, href = storeHref(), soon = storeOpensSoon(), code = storeSoonCode() }) {
  const [shown, setShown] = useState(false);
  if (!href) return null;
  if (soon && code) {
    if (shown) return html`<${StoreSoonCode} code=${code} />`;
    // A link's shape, so it reads as something to press on every page that draws it as a link.
    return html`<a class=${(cls + ' store-soon-ask').trim()} href="#" role="button"
      onClick=${(e) => { e.preventDefault(); setShown(true); }}>${tr('landing.storeSoonCodeCta', 'Opens soon: get your discount code')}</a>`;
  }
  if (soon) {
    return html`<span class=${(cls + ' store-soon').trim()}>${tr('landing.storeOpensSoon', 'Opens soon')}</span>`;
  }
  return newTab
    ? html`<a class=${cls || undefined} href=${href} target="_blank" rel="noopener">${label}</a>`
    : html`<a class=${cls || undefined} href=${href}>${label}</a>`;
}

/**
 * The discount code, ready to copy, and when to use it.
 * @param {{ code: string }} props
 */
export function StoreSoonCode({ code }) {
  return html`<span class="store-soon-code" role="status">
    <span>${tr('landing.storeSoonCodeText', 'Your discount code:')}</span>
    <strong class="store-soon-code-value">${code}</strong>
    <${CopyButton} text=${code} />
    <span class="store-soon-code-hint">${tr('landing.storeSoonCodeHint', 'Use it at checkout when the store opens.')}</span>
  </span>`;
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
