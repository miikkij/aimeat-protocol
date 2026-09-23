/**
 * @file public/components/BackLink.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A mono coral link back to where a person came from, above a page's headline. Its
 *   look is css/components/back-link.css; the catalogue entry is `back-link`.
 * @structure BackLink({ href, onClick, children })
 * @usage html`<${BackLink} href="/v1/home" onClick=${go}>↩ ${t('home.history.back')}<//>`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/history.js with its markup unchanged (UI
 *     consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ href: string, onClick?: (e: Event) => void, children?: any }} props */
export function BackLink({ href, onClick, children }) {
  return html`
    <a class="poster-back" href=${href}
       onClick=${onClick}>
      ${children}
    </a>`;
}

export default BackLink;
