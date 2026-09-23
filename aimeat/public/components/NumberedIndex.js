/**
 * @file public/components/NumberedIndex.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A numbered index: a lead line, then a named row whose items are numbered rows with
 *   an arrow (fold buttons, components/FoldButton.js, passed as children), an optional tour link,
 *   and under it the one open item's panel. IndexPanel is that panel: what it is, its steps, where
 *   it already runs, and its actions, in an opened record (poster.css .poster-record). Its look is
 *   css/components/numbered-index.css; the catalogue entry is `numbered-index`.
 * @structure NumberedIndex({ lead, label, tour, children, panel }) · IndexPanel({ what, steps, proof, children })
 * @usage
 *   html`<${NumberedIndex} lead=${…} label=${…} tour=${{ href, label }} panel=${open && html`<${IndexPanel} …/>`}>
 *     ${items.map((i) => html`<${FoldButton} on=${…} expanded=${…} onClick=${…}>…<//>`)}
 *   <//>`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/status-parts.js (the playbooks) with its markup
 *     unchanged (UI consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';
import { NamedRow } from '/components/NamedRow.js';

const html = htm.bind(h);

/**
 * @param {{ lead: any, label: any, tour?: { href: string, label: any } | null, children?: any, panel?: any }} props
 */
export function NumberedIndex({ lead, label, tour, children, panel }) {
  return html`
    <div class="poster-index">
      <p class="poster-index-lead">${lead}</p>
      <${NamedRow} label=${label}>
        ${children}
        ${tour && html`<a class="poster-index-tour" href=${tour.href} target="_blank" rel="noopener">
          ${tour.label}</a>`}
      <//>
      ${panel}
    </div>`;
}

/**
 * @param {{ what: any, steps: any[], proof?: any, children?: any }} props
 */
export function IndexPanel({ what, steps, proof, children }) {
  return html`
    <div class="poster-record poster-index-open">
      <p class="poster-index-what">${what}</p>
      <ol class="poster-index-steps">
        ${steps.map((step, i) => html`<li key=${i}>${step}</li>`)}
      </ol>
      ${proof && html`
        <p class="poster-index-proof">
          ${proof}
        </p>`}
      <div class="poster-index-actions">
        ${children}
      </div>
    </div>`;
}

export default NumberedIndex;
