/**
 * @file public/components/CheckItem.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One thing tried or not yet tried, as a door to it: a ticked box on the sun when
 *   done, a dashed empty box when not, the words the same weight either way. Its look is
 *   css/components/check-item.css; the catalogue entry is `check-item`.
 * @structure CheckItem({ done, href, external, onClick, children })
 * @usage html`<${CheckItem} done=${true} href="/v1/chat">${t('home.ach.chat')}<//>`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/status-parts.js (tried so far) with its markup
 *     unchanged (UI consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ done: boolean, href: string, external?: boolean, onClick?: () => void, children?: any }} props */
export function CheckItem({ done, href, external = false, onClick, children }) {
  return html`
    <a class="poster-check ${done ? 'poster-check--done' : ''}" href=${href}
       target=${external ? '_blank' : undefined} rel=${external ? 'noopener' : undefined}
       onClick=${onClick}>
      <span class="poster-check-mark" aria-hidden="true">${done ? '✓' : '·'}</span>
      ${children}
    </a>`;
}

export default CheckItem;
