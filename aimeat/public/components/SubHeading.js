/**
 * @file public/components/SubHeading.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The small heading over a group of fields, a card or a note inside a section, and the
 *   grey line the classic Settings pages put under it (component plan C9, page parts; Jouni's
 *   decision "Sub-heading": small ink headline letters). A page passes the words and never writes
 *   a class. Looks: css/components/sub-heading.css (.sub-heading) and section-header.css with
 *   profile-poster.css (.section-desc, the classic pages' grey line: 64 lines in 47 files on main).
 *
 *   - level: 2 to 6 draws a heading of that level (it counts in the page's outline); without it the
 *     words stand in a block, as most sub-headings do (33 blocks, 17 spans, 33 headings on main).
 *   - inline: in a line (a span).
 *   - desc: the grey line under it (.section-desc).
 *   - id: the anchor a link scrolls to.
 *   HeadDesc: the grey line alone (a classic page's line under a heading it does not draw itself,
 *   or a line under a field).
 * @structure SubHeading({ level, inline, id, desc, children }) · HeadDesc({ children })
 * @usage html`<${SubHeading} level=${3} id="access-sharing-groups" desc=${t('profile.access.sgDesc')}>${t('profile.access.sgTitle')}<//>`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: .sub-heading and the classic .section-desc, as one component
 *     (component plan C9).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

export function HeadDesc({ children }) {
  return html`<div class="section-desc">${children}</div>`;
}

/** @param {{ level?: 2|3|4|5|6, inline?: boolean, id?: string, desc?: any, children?: any }} props */
export function SubHeading({ level, inline, id, desc, children }) {
  const tag = level ? `h${Math.min(6, Math.max(2, Number(level) || 4))}` : inline ? 'span' : 'div';
  const head = html`<${tag} class="sub-heading" id=${id}>${children}<//>`;
  return desc ? html`${head}<${HeadDesc}>${desc}<//>` : head;
}

export default SubHeading;
