/**
 * @file public/components/PageSection.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A section of a Settings & Controls tab page: the section title (poster.css
 *   .poster-section-title) with a small mono count or number beside it, the doors on the right, and
 *   the body. Its look is css/components/page-section.css; the catalogue entry is `page-section`.
 * @structure PageSection({ id, num, title, count, doors, first, children })
 * @usage html`<${PageSection} id="sec-files" num="02" title="Files" count=${12} doors=${html`<button class="og-door">Upload</button>`}>…<//>`
 * @version-history
 *   v1.0.0 — 2026-09-25 — Moved out of views/profile/organisms/poster-parts.js (Section) with its markup
 *     unchanged (UI consolidation phase 5, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/**
 * `count` wins over `num` beside the title; `first` drops the rule on top.
 * @param {{ id?: string, num?: any, title: any, count?: any, doors?: any, first?: boolean, children?: any }} props
 */
export function PageSection({ id, num, title, count, doors, first, children }) {
  return html`
    <section class=${`og-sec ${first ? 'og-sec--first' : ''}`} id=${id}>
      <div class="og-sec-h">
        <h2 class="poster-section-title">${title}${count !== null && count !== undefined ? html`<small>${count}</small>` : html`<small>${num}</small>`}</h2>
        ${doors ? html`<div class="og-doors">${doors}</div>` : null}
      </div>
      ${children}
    </section>`;
}

export default PageSection;
