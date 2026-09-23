/**
 * @file public/components/InkFoot.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The foot of a page: facts in paper words on ink, two columns on a desktop and one on
 *   a phone, bleeding to the page's edges. Its look is css/components/ink-foot.css; the catalogue
 *   entry is `ink-foot`.
 * @structure InkFoot({ children })
 * @usage html`<${InkFoot}><p>…</p><p>…</p><//>`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/status-parts.js (the trust line) with its markup
 *     unchanged (UI consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

export function InkFoot({ children }) {
  return html`<section class="poster-foot">${children}</section>`;
}

export default InkFoot;
