/**
 * @file public/components/NamedRow.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One named row: the category word in a fixed left column (poster.css .poster-label),
 *   the content on the right, under the 3px ink rule of a row that is the thing (poster.css
 *   .poster-row--thing). Every row under a band's headline goes through this frame, which is what
 *   makes them line up as a list. `title` is the explainer that rides on the label as a tooltip.
 *   Its look is css/components/named-row.css; the catalogue entry is `named-row`.
 *   Named option: `stack` (the content one part under another at the row's full width: a form
 *   field, or a list with a way on under it).
 * @structure NamedRow({ label, title, stack, children })
 * @usage html`<${NamedRow} label=${t('home.things.assets')}>…<//>`
 * @version-history
 *   v1.1.0 — 2026-10-10 — `stack`, for the home's agents band; additive.
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/status-parts.js with its markup unchanged; the
 *     className passthrough it no longer needs is gone (UI consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ label: any, title?: string, stack?: boolean, children?: any }} props */
export function NamedRow({ label, title, stack, children }) {
  return html`
    <div class="poster-row--thing poster-named-row">
      <span class="poster-label poster-named-row-label" title=${title || undefined}>${label}</span>
      <div class=${stack ? 'poster-named-row-body poster-named-row-body--stack' : 'poster-named-row-body'}>${children}</div>
    </div>`;
}

export default NamedRow;
