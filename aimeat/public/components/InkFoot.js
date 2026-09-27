/**
 * @file public/components/InkFoot.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The foot of a page: facts in paper words on ink, two columns on a desktop and one on
 *   a phone, bleeding to the page's edges. Its look is css/components/ink-foot.css; the catalogue
 *   entry is `ink-foot`.
 *   `brand` (added for appcat): a word under both facts, across the foot, in the poster face on the
 *   sun (the old app catalogue's "AIMEAT").
 * @structure InkFoot({ brand, children })
 * @usage html`<${InkFoot}><p>…</p><p>…</p><//>`
 * @version-history
 *   v1.1.0 — 2026-09-27 — `brand`: the word under the facts (appcat); additive, ink-foot.css .poster-foot-brand.
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/status-parts.js (the trust line) with its markup
 *     unchanged (UI consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

export function InkFoot({ brand, children }) {
  if (brand) return html`<section class="poster-foot">${children}<span class="poster-foot-brand">${brand}</span></section>`;
  return html`<section class="poster-foot">${children}</section>`;
}

export default InkFoot;
