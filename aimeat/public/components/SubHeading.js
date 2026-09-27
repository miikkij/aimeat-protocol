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
 *   - rule: the heading of one part of a long section, in the row label's coral capitals over the ink
 *     rule, with air above it (the app catalogue's detail parts: "What it holds", "Where people came
 *     from", "Who answers for this app"); rule="readout" opens a part of a readout, 30px under the
 *     part before it (the old visitors' parts).
 *   - quiet: a grey heading, a little larger, with no air of its own, over a strip that is not the
 *     page's matter (the old app catalogue's "Active Extensions").
 *   - part: a part's heading in the words' own face, bold ink at the reading size, no air of its own
 *     (the old app catalogue's detail h4: "What people will see"); part="apart" with 30px of air above
 *     and 10px below ("Who answers for this app").
 *   HeadDesc: the grey line alone (a classic page's line under a heading it does not draw itself,
 *   or a line under a field).
 * @structure SubHeading({ level, inline, id, desc, rule, quiet, part, children }) · HeadDesc({ children })
 * @usage html`<${SubHeading} level=${3} id="access-sharing-groups" desc=${t('profile.access.sgDesc')}>${t('profile.access.sgTitle')}<//>`
 * @version-history
 *   v1.4.0 — 2026-09-27 — rule="readout": the rule heading of a readout's part, 30px of air above and
 *     12px below at the reading's line height (the old visitors' .vis-block .vis-h); additive, appcat
 *     parity (sections-b).
 *   v1.3.0 — 2026-09-27 — `part` (and part="apart"): a part's heading in bold ink at the reading size
 *     (the old app catalogue's detail h4); additive, appcat parity (sections-c).
 *   v1.2.0 — 2026-09-27 — `quiet`: the grey heading over a strip (the old app catalogue's Active
 *     Extensions bar); additive, appcat parity.
 *   v1.1.0 — 2026-09-27 — `rule`: a part's heading in coral capitals over the ink rule (the old app
 *     catalogue's .vis-h, .dtl-dm-body h4 and #detail-marks h4); additive, appcat detail builder B.
 *   v1.0.0 — 2026-09-26 — Initial: .sub-heading and the classic .section-desc, as one component
 *     (component plan C9).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

export function HeadDesc({ children }) {
  return html`<div class="section-desc">${children}</div>`;
}

/** @param {{ level?: 2|3|4|5|6, inline?: boolean, id?: string, desc?: any, rule?: boolean|'readout', quiet?: boolean, part?: boolean|'apart', children?: any }} props */
export function SubHeading({ level, inline, id, desc, rule, quiet, part, children }) {
  const tag = level ? `h${Math.min(6, Math.max(2, Number(level) || 4))}` : inline ? 'span' : 'div';
  // rule (added by appcat detail builder B): a part's heading in coral capitals over the ink rule.
  // quiet (added for appcat parity): the grey heading over a strip that is not the page's matter.
  // part (added by appcat sections-c, parity): a part's heading in bold ink at the reading size;
  // 'apart' with air above and below it.
  const partCls = part ? (part === 'apart' ? 'sub-heading sub-heading--part sub-heading--apart' : 'sub-heading sub-heading--part') : null;
  // rule="readout" (added by appcat sections-b, parity): the rule heading that opens a part of a
  // readout, 30px under the part before it and 12px over its own, at the reading's line height (the
  // old visitors' .vis-block .vis-h).
  const ruleCls = rule === 'readout' ? 'sub-heading sub-heading--rule sub-heading--readout' : 'sub-heading sub-heading--rule';
  const head = html`<${tag} class=${rule ? ruleCls : quiet ? 'sub-heading sub-heading--quiet' : partCls || 'sub-heading'} id=${id}>${children}<//>`;
  return desc ? html`${head}<${HeadDesc}>${desc}<//>` : head;
}

export default SubHeading;
