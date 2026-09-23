/**
 * @file public/components/StarToggle.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A star that keeps one thing always visible: hollow when off, sun-coloured when on,
 *   pressed-state announced. Its look is css/components/star-toggle.css; the catalogue entry is
 *   `star-toggle`.
 * @structure StarToggle({ on, title, onClick })
 * @usage html`<${StarToggle} on=${starred} title=${t('home.things.star')} onClick=${toggle} />`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/status-parts.js with its markup unchanged (UI
 *     consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ on: boolean, title?: string, onClick?: () => void }} props */
export function StarToggle({ on, title, onClick }) {
  return html`
    <button type="button" class="poster-star ${on ? 'poster-star--on' : ''}"
      aria-pressed=${on}
      title=${title}
      onClick=${onClick}>${on ? '★' : '☆'}</button>`;
}

export default StarToggle;
