/**
 * @file public/components/FoldSection.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A section of a tab page that is one row until it is opened: a coral mono number, the
 *   title, a mono detail on the right and an arrow; open, the body under it. Its look is
 *   css/components/fold-row.css; the catalogue entry is `fold-row`.
 * @structure FoldSection({ id, num, title, sub, lead, open, onToggle, children })
 *   - lead: an optional line under the row that stays while the section is shut (the lead, og-lead)
 * @usage html`<${FoldSection} id="sec-map" num="04" title="Map" sub="12 spaces" open=${o} onToggle=${…}>…<//>`
 * @version-history
 *   v1.1.0 — 2026-09-25 — An optional lead under the row, shown open or shut (the AI tab's three
 *     classic cards said what they hold before they were opened; UI consolidation phase 5).
 *   v1.0.0 — 2026-09-25 — Moved out of views/profile/organisms/poster-parts.js (Fold) with its markup
 *     unchanged (UI consolidation phase 5, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ id?: string, num?: any, title: any, sub?: any, lead?: any, open?: boolean, onToggle: () => void, children?: any }} props */
export function FoldSection({ id, num, title, sub, lead, open, onToggle, children }) {
  return html`
    <section class=${`og-sec og-fold-sec ${open ? 'is-open' : ''}`} id=${id}>
      <button type="button" class="og-fold og-fold--toggle" aria-expanded=${open ? 'true' : 'false'} onClick=${onToggle}>
        <i>${num}</i><span>${title}</span>${sub ? html`<span class="og-fold-r">${sub}</span>` : null}<span class="og-fold-arrow">${open ? '↓' : '→'}</span>
      </button>
      ${lead ? html`<p class="og-lead">${lead}</p>` : null}
      ${open ? html`<div class="og-fold-body">${children}</div>` : null}
    </section>`;
}

export default FoldSection;
