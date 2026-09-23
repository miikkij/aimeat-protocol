/**
 * @file public/components/FreeText.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Words an operator put into a layout. FreeText is a passage written into the layout
 *   itself, in one of three framings (plain, card, band); TextBlock is a passage kept as a record,
 *   under the band headline; NoticeBlock is a board's latest notices under the same headline, each
 *   with its category and its poster's name. Its look is css/components/free-text.css; the
 *   catalogue entry is `free-text`.
 * @structure FreeText({ tone, title, children }) · TextBlock({ title, children }) · NoticeBlock({ title, children })
 * @usage html`<${FreeText} tone="card" title=${title}><${Markdown} text=${body} /><//>`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/surface/freeform.js and blocks-portal.js with its
 *     markup unchanged (UI consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ tone: 'plain'|'card'|'band', title?: any, children?: any }} props */
export function FreeText({ tone, title, children }) {
  return html`
    <section class=${`poster-free poster-free--${tone}`}>
      ${title ? html`<h2 class="poster-free-title">${title}</h2>` : ''}
      ${children}
    </section>`;
}

/** @param {{ title?: any, children?: any }} props */
export function TextBlock({ title, children }) {
  return html`
    <section class="poster-text-block">
      ${title ? html`<h2 class="poster-section-title poster-section-title--large">${title}</h2>` : ''}
      ${children}
    </section>`;
}

/** @param {{ title?: any, children?: any }} props */
export function NoticeBlock({ title, children }) {
  return html`
    <section class="poster-notice-block">
      ${title ? html`<h2 class="poster-section-title poster-section-title--large">${title}</h2>` : ''}
      ${children}
    </section>`;
}

export default FreeText;
