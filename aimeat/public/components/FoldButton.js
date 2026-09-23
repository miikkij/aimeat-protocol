/**
 * @file public/components/FoldButton.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A mono coral underlined button that shows more, shows less, or switches what a list
 *   shows; the chosen one sits on the sun. `expanded` is announced only where the button opens a
 *   panel. Its look is css/components/fold-button.css (and inside a numbered index,
 *   css/components/numbered-index.css); the catalogue entry is `fold-button`.
 * @structure FoldButton({ on, expanded, onClick, children })
 * @usage html`<${FoldButton} onClick=${() => setOpen(true)}>${t('home.things.showAll')}<//>`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/status-parts.js with its markup unchanged (UI
 *     consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ on?: boolean, expanded?: boolean, onClick?: () => void, children?: any }} props */
export function FoldButton({ on, expanded, onClick, children }) {
  // Without `on` it opens more of a list: the action link's "more" tone. With `on` it is one of a
  // group that chooses what a row shows.
  const cls = on === undefined ? 'poster-action poster-action--more' : `poster-fold ${on ? 'poster-fold--on' : ''}`;
  return html`
    <button type="button"
      class=${cls}
      aria-expanded=${expanded}
      onClick=${onClick}>${children}</button>`;
}

export default FoldButton;
