/**
 * @file public/components/CountBars.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Counts grouped by what they count, as one component: one line per key (an address, a
 *   door, a kind of credential, an author, a kind of package) with an ink bar as long as its share of
 *   the biggest count and the count at the right. Length is the whole encoding; there is no series
 *   colour, so a grouping reads the same with four keys or forty. The only colours that carry a
 *   meaning are coral on a key the page names hot and the warning ink on a key the page cannot vouch
 *   for. Several groupings stand side by side in CountBarsSet, one under the other on a narrow
 *   screen. A page passes data and never a class; the look is css/components/count-bars.css.
 *
 *   Two looks, one kind of thing:
 *   - the default (main's Security page, .adm-sec-* in admin-security.css): a row label over the
 *     rows, each row a mono key, a short bar and the count, a hairline between the rows;
 *   - `wide` (main's Knowledge page, .adm-kn-cut / .adm-kn-part in admin-knowledge.css): the grouping
 *     takes the section's width, its title and why line at the left and its rows at the right, each
 *     row a name, a long bar on a track and the count; a rule under the grouping unless it is `last`.
 *     On a narrower screen the title stands over the rows and each bar goes under its name.
 *
 *   CountBars({ label, title, why, rows, keyOf, hot, words, more, max, wide, last })
 *   - label: the row label over the rows (the library's Label).
 *   - title: what the grouping groups by (bold); why: the grey line under the title.
 *   - rows: [{ key, name, count, note, tone, onPick, title }]; a falsy row is left out.
 *     name: the words for the key (default keyOf(row), else the key itself); count: the bar's length
 *     and the figure; note: a short word beside the name in the warning colour; tone 'warn': the bar
 *     in the warning colour; onPick: the name is a button (it narrows a list to this key); title:
 *     the name's tooltip.
 *   - keyOf(row): the words for a row's key, when the rows carry no name.
 *   - hot: the keys whose bar is coral (an address the tarpit walled).
 *   - words: the keys are words, not machine readings (another face, grey) and there is no bar.
 *   - more: { name, count } drawn as the last line, in words ("12 more sources").
 *   - max: the longest bar in pixels in the default look (90); the others scale to it, never under 4.
 *     In the `wide` look the longest bar fills the track and the others never go under 2%.
 *   - wide: the second look above; last: the last grouping of its section, no rule under it.
 *   CountBarsSet({ children }): the groupings side by side.
 * @structure CountBars(props) · CountBarsRow(row) · CountBarsName(row) · CountBarsSet({ children })
 * @usage html`<${CountBarsSet}>
 *          <${CountBars} label=${S('byDoor')} rows=${r.by_door} />
 *          <${CountBars} label=${S('bySource')} rows=${r.by_source} keyOf=${(x) => ipText(x.key)} hot=${r.walled_sources} />
 *        <//>`
 *        html`<${CountBars} wide title=${x('byAuthor')} why=${x('byAuthorWhy')}
 *          rows=${authors.map((a) => ({ key: a.key, name: a.name, count: a.packages, onPick: () => pick(a.key) }))} />`
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial: the Security page's three groupings of the refusal log (Grouping in
 *     views/admin/security-tab.refusals.js) as a component, the bar lengths still SVG widths (admin
 *     group G1).
 *   v1.1.0 — 2026-09-27 — FacetBars (the Knowledge page's facets, admin group G7) folded in: one kind
 *     of thing, counts per key drawn as bars. Added `title` + `why`, a row's `name`, `note`,
 *     `tone: 'warn'`, `onPick` + `title`, the `wide` look and `last`. The default look draws as before.
 */
import { h } from 'preact';
import htm from 'htm';
import { num } from '/js/format.js';
import { Label } from '/components/Mark.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');

/**
 * A row's name: a button when it narrows a list, its warning note beside it.
 * @param {{ name: any, note?: any, onPick?: () => void, title?: string }} props
 */
function CountBarsName({ name, note, onPick, title }) {
  return html`${onPick
    ? html`<button type="button" class="count-bars-pick" title=${title} onClick=${onPick}>${name}</button>`
    : title ? html`<span title=${title}>${name}</span>` : name}${note ? html`<b class="count-bars-note">${note}</b>` : null}`;
}

/**
 * One row in either look.
 * @param {{ row: any, name: any, top: number, max: number, hot?: boolean, words?: boolean, wide?: boolean }} props
 */
function CountBarsRow({ row, name, top, max, hot, words, wide }) {
  const n = row.count || 0;
  const tone = cx(hot && 'hot', row.tone === 'warn' && 'warn');
  if (wide) {
    const width = top > 0 ? Math.max(2, Math.round((n / top) * 100)) : 0;
    return html`<span class=${cx('count-bars-part', words && 'count-bars-part--words')}>
      <span class="count-bars-name"><${CountBarsName} ...${row} name=${name} /></span>
      ${words ? null : html`<span class="count-bars-track"><svg class=${cx('count-bars-fill', tone && 'count-bars-fill--' + tone)}
        width=${width + '%'} aria-hidden="true"></svg></span>`}
      <span class="count-bars-n">${num(n)}</span>
    </span>`;
  }
  return html`<div class=${cx('count-bars-row', words && 'count-bars-row--words')}>
    <span class="count-bars-key"><${CountBarsName} ...${row} name=${name} /></span>
    ${words ? null : html`<svg class=${cx('count-bars-bar', tone && 'count-bars-bar--' + tone)} width=${Math.max(4, Math.round(n / (top || 1) * max))} aria-hidden="true"></svg>`}
    <span class="count-bars-n">${num(n)}</span>
  </div>`;
}

/**
 * @param {{ label?: any, title?: any, why?: any,
 *   rows?: Array<{ key: any, name?: any, count: number, note?: any, tone?: string, onPick?: () => void, title?: string }>,
 *   keyOf?: (row: any) => any, hot?: Array<any>, words?: boolean, more?: { name: any, count: number } | null,
 *   max?: number, wide?: boolean, last?: boolean }} props
 */
export function CountBars({ label, title, why, rows = [], keyOf, hot, words, more, max = 90, wide, last }) {
  const list = (rows || []).filter(Boolean);
  const top = list.reduce((m, r) => Math.max(m, r.count || 0), 0);
  const nameOf = (r) => r.name ?? (keyOf ? keyOf(r) : r.key);
  const drawn = list.map((r, i) => html`<${CountBarsRow} key=${r.key ?? i} row=${r} name=${nameOf(r)} top=${top} max=${max}
    hot=${!!(hot && hot.includes(r.key))} words=${words} wide=${wide} />`);
  const moreRow = more ? html`<${CountBarsRow} key="more" row=${{ count: more.count }} name=${more.name} top=${top} max=${max} words=${true} wide=${wide} />` : null;
  const head = title ? html`<span class="count-bars-head"><b>${title}</b>${why ? html`<span class="count-bars-why">${why}</span>` : null}</span>` : null;

  if (wide) {
    return html`<div class=${cx('count-bars', 'count-bars--wide', last && 'count-bars--last')}>
      ${head || (label ? html`<span class="count-bars-head"><${Label} block>${label}<//></span>` : html`<span></span>`)}
      <span class="count-bars-rows">${drawn}${moreRow}</span>
    </div>`;
  }
  return html`<div class="count-bars">
    ${label ? html`<${Label} block>${label}<//>` : null}
    ${head}
    ${drawn}${moreRow}
  </div>`;
}

/** Groupings side by side, one under the other on a narrow screen. */
export function CountBarsSet({ children }) {
  return html`<div class="count-bars-set">${children}</div>`;
}

export default CountBars;
