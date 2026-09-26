/**
 * @file public/components/MorselFlow.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where the morsels came from and where they went, and how fast the balance fills: the
 *   Wallet page's own view, as one component. A page passes data; it never writes a class. The look
 *   is css/components/morsel-flow.css, the Object box of css/poster.css (via Box.js boxClass) around
 *   each column and the pace, and components/Figure.js: the Figure (the poster numeral, in its state
 *   colour) for the totals and the sums, the one Meter for the bar. One column on a phone.
 *
 *   - MorselFlow({ columns }): the columns side by side. A column is { key, total, tone, title, count,
 *     rows, empty }: `total` is the figure in the poster face at its head, in `tone` = 'fine' (came in)
 *     | 'notice' (went out); `title` the words after it; `count` the small typewriter line at the head's
 *     right end (how many rows, over which dates); `rows` the sources, each { key, title, sub, sum }
 *     (the name, a typewriter line under it, the sum in the poster face at the right); `empty` the grey
 *     line when there are no rows.
 *   - MorselPace({ title, words, pct, figure }): the pace sentence (its `title` in bold, then `words`)
 *     beside the meter that fills to `pct` (0 to 100) with `figure` written on it.
 * @structure MorselFlow({ columns }) · MorselPace({ title, words, pct, figure })
 * @usage html`<${MorselFlow} columns=${[{ key: 'in', total: '+190', tone: 'fine', title: x('came'),
 *          count: '12 rows · 1.9.–26.9.', rows: [{ key, title, sub: '3 times', sum: 90 }], empty: x('nothingYet') }]} />`
 *        html`<${MorselPace} title=${x('paceTitle')} words=${sentence} pct=${pct} figure=${`${balance} / ${cap}`} />`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial (page group G7, Wallet): the morsel flow the Wallet page drew by hand
 *     (.wal-flow, .wal-col, .wal-col-h, .wal-src, .wal-pace and the .wal-bar meter) as one component
 *     with its own class names; the bar is the one Meter (beside).
 */
import { h } from 'preact';
import htm from 'htm';
import { boxClass } from '/components/Box.js';
import { Figure, Meter } from '/components/Figure.js';

const html = htm.bind(h);
const has = (v) => v !== undefined && v !== null && v !== false && v !== '';

function Column({ total, tone, title, count, rows, empty }) {
  const list = rows || [];
  return html`
    <div class=${`${boxClass()} morsel-flow-col`}>
      <div class="morsel-flow-head"><${Figure} n=${total} tone=${tone} /> ${title}${has(count) ? html`<small class="morsel-flow-count">${count}</small>` : null}</div>
      ${list.length
        ? list.map((r, i) => html`<div class="morsel-flow-src" key=${r.key ?? r.title ?? i}><span>${r.title}${has(r.sub) ? html`<small>${r.sub}</small>` : null}</span><${Figure} n=${r.sum} /></div>`)
        : html`<div class="morsel-flow-src morsel-flow-src--empty">${empty}</div>`}
    </div>`;
}

export function MorselFlow({ columns }) {
  return html`<div class="morsel-flow">${(columns || []).filter(Boolean).map((c, i) => html`<${Column} key=${c.key ?? i} ...${c} />`)}</div>`;
}

export function MorselPace({ title, words, pct, figure }) {
  return html`
    <div class=${`${boxClass()} morsel-pace`}>
      <div>${has(title) ? html`<b>${title}</b> ` : null}${words}</div>
      <${Meter} beside pct=${pct} figure=${figure} />
    </div>`;
}

export default MorselFlow;
