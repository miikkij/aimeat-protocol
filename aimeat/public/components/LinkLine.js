/**
 * @file public/components/LinkLine.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One sentence with a coral link at its end, opening in a new tab. Its look is
 *   css/components/link-line.css; the catalogue entry is `link-line`.
 * @structure LinkLine({ label, href, text })
 * @usage html`<${LinkLine} label=${t('…')} href=${url} text=${shortUrl} />`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/surface/blocks-home.js (the welcome page's address)
 *     with its markup unchanged (UI consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ label: any, href: string, text: any }} props */
export function LinkLine({ label, href, text }) {
  return html`
    <p class="poster-link-line">
      ${label}${' '}
      <a href=${href} target="_blank" rel="noopener">${text}</a>
    </p>`;
}

export default LinkLine;
