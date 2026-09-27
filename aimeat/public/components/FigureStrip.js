/**
 * @file public/components/FigureStrip.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The strip of figures under a page head, as one component (C4 "Facts" of the component
 *   plan): between two heavy rules, each figure a number in the poster face, its word, and a small
 *   typewriter line under it; two to a row on a narrow screen. A page passes the figures as data and
 *   named options; it never writes a class. The look is css/components/figure-strip.css, whose class
 *   names (.og-strip, .og-strip-*) the admin pages share.
 *
 *   FigureStrip({ items, loading, wrap, flush, lead })
 *   - items: [{ n, of, label, sub, tone, key, onClick, title }]; a falsy item is left out. With
 *     `onClick` the figure is a button (a filter, a door to its page) whose word underlines under the
 *     pointer; `title` is its tooltip.
 *     n: the figure (a number, a word, a time; '…' while it loads, '·' when there is none).
 *     of: the "of how many" after it ("/4"), smaller and grey. label: the word beside the figure.
 *     sub: the typewriter line under it; a sub of '' still draws the (empty) line, as the pages did,
 *     so leave it undefined for none.
 *     tone: 'coral' (a word in coral capitals: a state, a time) | 'word' (a word in capitals where a
 *     number would stand) | 'notice' (a number in coral: the one to look at) | 'fine' | 'warn' |
 *     'danger' (the Status colours) | 'dim' (a figure that is not there yet) | 'long' (a long word,
 *     such as an address, smaller and breaking where it must). Two tones join with a space:
 *     'word fine' is a word in capitals in the fine colour.
 *   - loading: the number of figures to hold the place with '…' while the data loads.
 *   - wrap: the lines under the figures are read whole (they wrap instead of ending in "…").
 *   - flush: the strip opens its box, no air above. lead: the strip opens a tab's content: no air
 *     above, air under it before what follows.
 *   - free: the figures stand free inside a section, without the rules: each number over its word in
 *     the row label's coral capitals, wrapping as they fit (the old app catalogue's visitor numbers).
 * @structure FigureStrip({ items, loading, wrap, flush, lead, free })
 * @usage html`<${FigureStrip} items=${[{ n: apps.length, label: x('stripApps'), sub: x('stripAppsSub') },
 *          { n: drafts.length, tone: drafts.length ? 'coral' : undefined, label: x('stripDrafts'), sub: '' }]} />`
 *        html`<${FigureStrip} loading=${4} />`
 * @version-history
 *   v1.2.0 — 2026-09-27 — `free`: figures without the rules, the word under the number in coral
 *     capitals (the old app catalogue's .vis-stats); additive, appcat detail builder B.
 *   v1.1.0 — 2026-09-27 — An item's `onClick` and `title`: the admin's strips whose figures are
 *     filters and doors (Overview, Applications, Owners, Security, CORS, Compliance); additive.
 *   v1.0.0 — 2026-09-26 — Initial: the strip ~25 Settings pages wrote by hand
 *     (<div class="og-strip"><div><b>…</b><span>…</span><small>…</small></div>…) as one component, with
 *     the figure colours the pages' own rules carried kept as tones (component plan C4).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');
const TONES = new Set(['coral', 'word', 'notice', 'fine', 'warn', 'danger', 'dim', 'long']);
const has = (x) => x !== undefined && x !== null && x !== false;

function toneClass(tone) {
  if (!tone) return undefined;
  return String(tone).split(/\s+/).filter((x) => TONES.has(x)).map((x) => `og-strip-${x}`).join(' ') || undefined;
}

function Figure({ item }) {
  const inner = html`
    <b class=${toneClass(item.tone)}>${item.n}${has(item.of) ? html`<span class="og-strip-of">${item.of}</span>` : null}</b>
    <span>${item.label}</span>${has(item.sub) ? html`<small>${item.sub}</small>` : null}`;
  if (item.onClick) return html`<button type="button" title=${item.title} onClick=${item.onClick}>${inner}</button>`;
  return html`<div title=${item.title}>${inner}</div>`;
}

export function FigureStrip({ items = [], loading, wrap, flush, lead, free }) {
  // free (added by appcat detail builder B): the figures stand free in a section, no rules, each
  // number over its word in coral capitals (the old app catalogue's visitor numbers, .vis-stats).
  const cls = cx('og-strip', wrap && 'og-strip--wrap', flush && 'og-strip--flush', lead && 'og-strip--lead', free && 'og-strip--free');
  if (loading) {
    return html`<div class=${cls}>${Array.from({ length: loading }, (_, i) => html`<div key=${i}><b>…</b></div>`)}</div>`;
  }
  return html`<div class=${cls}>${(items || []).filter(Boolean).map((item, i) => html`<${Figure} key=${item.key ?? i} item=${item} />`)}</div>`;
}

export default FigureStrip;
