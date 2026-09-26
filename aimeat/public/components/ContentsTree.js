/**
 * @file public/components/ContentsTree.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The whole structure of a place as one tree, standing in the contents rail's place (an
 *   organism workspace shown "as a tree"): every group with its count, every space in it with its
 *   count and how many things in it are new for you, the documents of a space nested under it (the
 *   first few, then "… N more"), the panels of the place, and at its foot the way back to the rail.
 *   A page passes the tree as data and what each line opens; it never writes a class. The look is the
 *   page kit's tree (.og-tree*, css/components/tab-page.css, the class names the kit already has).
 *   The line you are on is drawn on the sun and says aria-current.
 *
 *   groups: [{ key, label, count?, items: [line] }]; a line: { key, label, count?, fresh?, on?,
 *   onClick, children?: [{ key, label, draft?, on?, onClick }], more?: { label, onClick } }.
 *   `count` of a group or a line is drawn even when it is '' (its place stays); `fresh` is the coral
 *   "+N" after a line's count. `draftLabel` names a document that is a draft. `foot`: { mark, label,
 *   onClick }, the way back under a rule.
 * @structure ContentsTree({ title, groups, foot, draftLabel })
 * @usage html`<${ContentsTree} title=${railTitle} groups=${groups} draftLabel=${t('organisms.draft')}
 *          foot=${{ mark: '↩', label: showRail, onClick: () => setTree(false) }} />`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the workspace's tree of views/profile/organisms/workspace/cover.js
 *     (renderTree) as a component that takes data; its markup and look unchanged (page migration G2b).
 */
import { h } from 'preact';
import htm from 'htm';
import { Mark } from '/components/Mark.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');
const given = (v) => v !== undefined && v !== null;

function Line({ line, draftLabel }) {
  const { label, count, fresh, on, onClick, children, more } = line;
  return html`
    <div class="og-tree-space">
      <button type="button" class=${cx('og-tree-link', on && 'on')} aria-current=${on ? 'true' : undefined} onClick=${onClick}>
        <span>${label}</span>${given(count) ? html`<em>${count}${fresh > 0 ? html` <b>+${fresh}</b>` : null}</em>` : null}
      </button>
      ${(children || []).map((d) => html`
        <button type="button" key=${d.key} class=${cx('og-tree-doc', d.on && 'on')} aria-current=${d.on ? 'true' : undefined} onClick=${d.onClick}>
          ${d.draft ? html`<${Mark} kind="status" tone="attention">${draftLabel}<//>` : null}${d.label}
        </button>`)}
      ${more ? html`<button type="button" class="og-tree-doc og-tree-more" onClick=${more.onClick}>${more.label}</button>` : null}
    </div>`;
}

export function ContentsTree({ title, groups = [], foot, draftLabel }) {
  return html`
    <nav class="og-tree poster-row--thing" aria-label=${title}>
      ${groups.filter(Boolean).map((g) => html`
        <div class="og-tree-group" key=${g.key}>
          <span class="og-tree-label">${g.label}${given(g.count) ? html`<em>${g.count}</em>` : null}</span>
          ${(g.items || []).filter(Boolean).map((line) => html`<${Line} key=${line.key} line=${line} draftLabel=${draftLabel} />`)}
        </div>`)}
      ${foot ? html`
        <hr />
        <button type="button" class="og-rail-link og-rail-toggle" onClick=${foot.onClick}><i>${foot.mark}</i>${foot.label}</button>` : null}
    </nav>`;
}

export default ContentsTree;
