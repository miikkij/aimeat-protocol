/**
 * @file public/components/Section.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A section of a Settings page, open or folded, as one component (component plan C9,
 *   page parts). An open section is PageSection (the ink section title with its small coral count
 *   or number, the actions at the right, the body); a folded one is FoldSection (one row with a
 *   coral number, the title, a mono word at the right and the arrow, which opens in place and says
 *   aria-expanded). Both stay importable by their own names; this is the one door to both.
 *   A page passes data and never writes a class. Looks: css/components/page-section.css and
 *   fold-row.css.
 *
 *   - id: the section's anchor, which the rail scrolls to.
 *   - num, title, count: the head (`count` wins over `num` beside an open title).
 *   - doors: the actions at the right of an open section's head (give it Action links).
 *   - first: the first section on the page, with no rule on top.
 *   - plain: a section with no head at all, only the rule on top and the body (added by page group G2a).
 *   - part: a part of a dialog's body, its slab title a size smaller and 2rem between parts (dialog.css;
 *     added by appcat's dialogs).
 *   - fold: the section is one row until it is opened; then `open`, `onToggle`, `sub` (the mono
 *     word at the right of the row) and `lead` (a line under the row, shown open or shut); `clip`
 *     cuts a long `sub` with … on its line (added by page group G6).
 * @structure Section(props) · PageSection · FoldSection
 * @usage html`<${Section} id="sk-own" num="01" title=${x('secOwn')} count=${sub} first>…<//>`
 *        html`<${Section} fold id="og-map" num="07" title=${x('map')} open=${o} onToggle=${() => setO(!o)}>…<//>`
 * @version-history
 *   2026-09-27 — `part` passed on to PageSection (a part of a dialog's body, appcat parity).
 *   2026-09-27 — `chapter` passed on to PageSection (a chapter of a long page of one thing, appcat).
 *   2026-09-27 — `group` passed on to PageSection (a section holding a group of sections).
 *   2026-09-27 — `band` passed on to PageSection.
 *   v1.4.0 — 2026-09-26 — `inner` passes to FoldSection: a fold inside a part, without its number
 *     (page group G1a; additive).
 *   v1.3.0 — 2026-09-26 — `wrap` passes to FoldSection: the detail under the title on a narrower
 *     screen (page group G6; additive).
 *   v1.2.0 — 2026-09-26 — `clip` passes to FoldSection: a long detail cut with … (page group G6; additive).
 *   v1.1.0 — 2026-09-26 — `plain` passes to PageSection: a section with no head (page group G2a; additive).
 *   v1.0.0 — 2026-09-26 — Initial: PageSection and FoldSection behind one door (component plan C9).
 */
import { h } from 'preact';
import htm from 'htm';
import { PageSection } from '/components/PageSection.js';
import { FoldSection } from '/components/FoldSection.js';

const html = htm.bind(h);

/**
 * @param {{ fold?: boolean, id?: string, num?: any, title: any, count?: any, doors?: any, first?: boolean,
 *   plain?: boolean, band?: boolean, group?: boolean, chapter?: any, part?: boolean, sub?: any, lead?: any, clip?: boolean, wrap?: boolean, inner?: boolean,
 *   open?: boolean, onToggle?: () => void, children?: any }} props
 */
export function Section({ fold, id, num, title, count, doors, first, plain, band, group, chapter, part, sub, lead, clip, wrap, inner, open, onToggle, children }) {
  if (fold) return html`<${FoldSection} id=${id} num=${num} title=${title} sub=${sub} lead=${lead} clip=${clip} wrap=${wrap} inner=${inner} open=${open} onToggle=${onToggle}>${children}<//>`;
  return html`<${PageSection} id=${id} num=${num} title=${title} count=${count} doors=${doors} first=${first} plain=${plain} band=${band} group=${group} chapter=${chapter} part=${part}>${children}<//>`;
}

export { PageSection, FoldSection };
export default Section;
