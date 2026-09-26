/**
 * @file public/components/OfferMap.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The map of offers (a special view of the Offers page), in four ways to read the same
 *   offers grouped by the need they answer: columns (one per need, as many as fit at 10rem), the grid
 *   (a row per agent, a column per need, scrolling inside the map when the page is narrow), blocks
 *   (one per need, wider the more it holds) and the tree (the Mermaid flowchart, a press on an offer
 *   opens it). An offer is a tile: a framed link that opens the offer's own page in a new tab, with
 *   its title, a small "opens elsewhere" mark and its agent's tag; the frame and the mark coral under
 *   the pointer. A group's head carries its count in typewriter letters. A page passes the groups as
 *   data; it never writes a class. The look is css/components/offer-map.css (formerly the op-map,
 *   op-tile, op-cols, op-matrix, op-mx-* and op-blocks rules of the Offers sheets).
 *
 *   OfferMap({ mode, groups, chart, onPick }):
 *   - mode: 'columns' (the default) | 'grid' | 'tiles' | 'tree'.
 *   - groups: [{ key, label, items: [{ key, title, href, agent, online, mark }] }]: `mark` is the
 *     agent's tag as the page draws it (Mark presence), `online` dims an agent that is away in the grid.
 *   - chart: the Mermaid source of the tree; onPick(groupIndex, itemIndex): a press on an offer in it.
 *   - agentLabel: the grid's first column head (the agent).
 *   A block grows with its count up to twelve (offer-map-block--n1…n12, in place of main's inline
 *   --op-n, so the component writes no style).
 * @structure OfferMap(props) · Tile · Columns · Grid · Blocks · Tree
 * @usage html`<${OfferMap} mode=${mode} groups=${groups} chart=${src} onPick=${(g, i) => open(groups[g].items[i])} />`
 * @version-history
 *   v1.1.0 — 2026-09-27 — A tree with onPick wears .offer-map-tree--pick (the node hover main had).
 *   v1.0.0 — 2026-09-26 — Initial: the Offers map's views as one component, with the values of
 *     offer-map.css and the grid's column cuts (op-matrix--n1…n6, which the previous branch had lost,
 *     so the grid stood in one column) (page group G6).
 */
import { h, Fragment } from 'preact';
import htm from 'htm';
import { Mermaid } from '/components/Mermaid.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');

/** The small "opens elsewhere" mark in a tile's corner. */
const outMark = () => html`<svg class="offer-map-out" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" aria-hidden="true"><path d="M14 4h6v6" /><path d="M20 4L10 14" /><path d="M18 14v6H4V6h6" /></svg>`;

/** One offer as a link that opens its page in a new tab; a line tile sits in a grid row that already names the agent. */
function Tile({ it, line, compact }) {
  return html`<a class=${cx('offer-map-tile', line && 'offer-map-tile--line', compact && 'offer-map-tile--compact')}
    href=${it.href} target="_blank" rel="noopener" title=${it.title}>
    <span class="offer-map-tile-t"><span>${it.title}</span>${outMark()}</span>
    ${line ? null : html`<span class="offer-map-agent">${it.mark}</span>`}
  </a>`;
}

const Head = ({ g, grid }) => html`<div class=${cx('poster-day-title', grid ? 'offer-map-grid-head' : 'offer-map-head')}><span>${g.label}</span><em>${g.items.length}</em></div>`;

function Columns({ groups }) {
  return html`<div class="offer-map-cols">
    ${groups.map((g) => html`<div class="offer-map-col" key=${g.key}><${Head} g=${g} />${g.items.map((it) => html`<${Tile} key=${it.key} it=${it} />`)}</div>`)}
  </div>`;
}

/** A row per agent (in the order of the first need it answers), a column per need. */
function Grid({ groups, agentLabel }) {
  const order = new Map(groups.map((g, i) => [g.key, i]));
  const byAgent = new Map();
  groups.forEach((g) => g.items.forEach((it) => {
    if (!byAgent.has(it.agent)) byAgent.set(it.agent, []);
    byAgent.get(it.agent).push({ ...it, need: g.key });
  }));
  const first = (list) => Math.min(...list.map((it) => order.get(it.need) ?? 99));
  const rows = [...byAgent.entries()].sort(([a, ai], [b, bi]) => first(ai) - first(bi) || a.localeCompare(b));
  return html`<div class="offer-map-scroll">
    <div class=${`offer-map-grid offer-map-grid--n${Math.min(groups.length, 6)}`}>
      <div class="poster-day-title offer-map-grid-head offer-map-grid-head--agent">${agentLabel}</div>
      ${groups.map((g) => html`<${Head} key=${'h' + g.key} g=${g} grid />`)}
      ${rows.map(([agent, list]) => html`<${Fragment} key=${'a' + agent}>
        <div class=${cx('offer-map-grid-agent', !list[0].online && 'offer-map-grid-agent--off')}>${list[0].mark}</div>
        ${groups.map((g) => html`<div class="offer-map-grid-cell" key=${agent + '/' + g.key}>${list.filter((it) => it.need === g.key).map((it) => html`<${Tile} key=${it.key} it=${it} line />`)}</div>`)}
      <//>`)}
    </div>
  </div>`;
}

/** A block per need, wider the more it holds (its flex grows with the count). */
function Blocks({ groups }) {
  return html`<div class="offer-map-blocks">
    ${groups.map((g) => html`<div class=${`poster-box poster-box--copy offer-map-block offer-map-block--n${Math.max(1, Math.min(g.items.length, 12))}`} key=${g.key}>
      <${Head} g=${g} />
      <div class="offer-map-block-tiles">${g.items.map((it) => html`<${Tile} key=${it.key} it=${it} compact />`)}</div>
    </div>`)}
  </div>`;
}

/** The flowchart; a press on an offer's node (id …g<group>o<offer>…) picks it. */
function Tree({ chart, onPick }) {
  const click = (e) => {
    const id = e.target?.closest?.('.node')?.id || '';
    const leaf = /g(\d+)o(\d+)/.exec(id);
    if (leaf) onPick?.(+leaf[1], +leaf[2]);
  };
  return html`<div class=${onPick ? 'offer-map-scroll offer-map-tree--pick' : 'offer-map-scroll'} onClick=${click}><${Mermaid} chart=${chart} /></div>`;
}

export function OfferMap({ mode = 'columns', groups = [], chart, onPick, agentLabel }) {
  if (mode === 'tree') return html`<${Tree} chart=${chart} onPick=${onPick} />`;
  if (mode === 'grid') return html`<${Grid} groups=${groups} agentLabel=${agentLabel} />`;
  if (mode === 'tiles') return html`<${Blocks} groups=${groups} />`;
  return html`<${Columns} groups=${groups} />`;
}

export default OfferMap;
