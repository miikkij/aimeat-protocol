/**
 * @file public/components/SlotBars.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Counts over a window of days as one row of bars, one slot per day (per week past 120
 *   days), each bar stacked from up to three named parts, drawn in CSS pixels and never stretched:
 *   the bars are 2 to 28px wide whatever the window, so three busy days in a quiet year still read as
 *   three days. Every bar says its dates and its parts as its tooltip. Over the bars the chart's title
 *   and its peak line ("most in a day: 12"), under them the first and the last date, and a key when
 *   there is more than one part. A page passes the counts and never a class. The look is
 *   css/components/slot-bars.css (the old app catalogue's version chart, .version-chart, and the
 *   visitor charts that reused it).
 *
 *   SlotBars({ title, peak, bars, parts, from, to, label, keyed })
 *   - bars: [{ from, to, total, <part key>: n }], from slotsFromSeries.
 *   - parts: [{ key, label, tone }], drawn bottom up; tone = 'ink' | 'dim' | 'coral' (the default, the
 *     one-part chart's colour). A part's colour is its meaning, the same in both themes' tokens.
 *   - peak: the words over the right end ("most in a day: 12"). from, to: the axis words.
 *   - label: the chart's name for a screen reader (the title by default). keyed: draw the key.
 *   - tip(bar): the tooltip of one bar; by default "dates · part n · part n".
 *   - summary: one typewriter line over the chart that says what the bars add up to ("4 versions
 *     stored · …"); caveat: the small grey line under it that says how to read it. Either one makes
 *     the chart a block of its own, with the air the old version chart had around it.
 *   - fitAxis: the dates stand under the bars and not under the whole width, and a chart too short
 *     to hold two dates says the span in one ("9/1/2026 – 9/3/2026", or the one day).
 *   slotsFromSeries(series, from, to, keys): folds a sparse day series ([{ day, <key>: n }])
 *   into evenly spaced slots over [from, to]; past 120 days each slot is a week. Returns
 *   { bars, max, grain: 'day' | 'week' }.
 * @structure SlotBars(props) · Chart(props) · slotsFromSeries(series, from, to, keys)
 * @usage const s = slotsFromSeries(o.series, r.from, r.to, ['signed_in', 'anonymous']);
 *        html`<${SlotBars} title=${x('opensChart')} peak=${x('maxPerDay', { n: s.max })} bars=${s.bars}
 *          parts=${[{ key: 'signed_in', label: x('signedIn'), tone: 'ink' }, { key: 'anonymous', label: x('anon'), tone: 'dim' }]}
 *          from=${day(r.from)} to=${day(r.to)} keyed />`
 * @version-history
 *   v1.1.0 — 2026-09-27 — `summary`, `caveat` and `fitAxis` (the old version chart's .version-span,
 *     .version-span-hint and its axis as wide as the bars, one line under 240px); the greys read the
 *     site's --text-muted, which is the old page's --text-dim (appcat parity, sections-b). Additive.
 *   v1.0.0 — 2026-09-27 — Initial: the old app catalogue's version chart and its stacked visitor
 *     charts (js/visitors.js chartHtml, js/visitors-model.js barsFromSeries) as one component
 *     (appcat detail builder B).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);
const TONES = new Set(['ink', 'dim', 'coral']);
const toneOf = (tone) => (TONES.has(tone) ? tone : 'coral');

/** The chart's box, in CSS pixels. */
const W = 720;
const H = 96;
const PAD = 2;
const BASE = H - 1;
/** The longest window the folding walks (a year and a day). */
const MAX_DAYS = 361;

function addDays(day, n) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Fold a sparse day series into evenly spaced slots over [from, to]. The node answers only the days
 * that had something; every day in the window gets a slot, and past 120 days the slots are weeks.
 * @param {Array<Record<string, any>>} series  rows { day: 'YYYY-MM-DD', <key>: n }
 * @param {string} from @param {string} to @param {string[]} keys
 */
export function slotsFromSeries(series, from, to, keys) {
  const byDay = {};
  for (const row of series || []) byDay[row.day] = row;
  const days = [];
  if (from && to) for (let d = from; d <= to && days.length <= MAX_DAYS; d = addDays(d, 1)) days.push(d);
  const step = days.length > 120 ? 7 : 1;
  const bars = [];
  for (let i = 0; i < days.length; i += step) {
    const slice = days.slice(i, i + step);
    const bar = { from: slice[0], to: slice[slice.length - 1], total: 0 };
    for (const k of keys) bar[k] = 0;
    for (const day of slice) {
      const row = byDay[day];
      if (!row) continue;
      for (const k of keys) { const v = Number(row[k]) || 0; bar[k] += v; bar.total += v; }
    }
    bars.push(bar);
  }
  const max = bars.reduce((m, b) => Math.max(m, b.total), 0);
  return { bars, max, grain: step === 7 ? 'week' : 'day' };
}

/** One slot: a hit area the height of the chart, and its parts stacked bottom up. */
function Slot({ bar, i, bw, max, parts, tip }) {
  const x = i * (bw + PAD);
  const full = bar.total ? Math.max(4, Math.round((bar.total / max) * (H - 14))) : 0;
  let y = BASE;
  const marks = [];
  for (const p of parts) {
    const v = bar[p.key] || 0;
    if (!v) continue;
    const hgt = Math.max(1, Math.round(full * (v / bar.total)));
    y -= hgt;
    marks.push(html`<rect key=${p.key} class=${`slot-bars-mark slot-bars-mark--${toneOf(p.tone)}`} x=${x} y=${y} width=${bw} height=${hgt}></rect>`);
  }
  return html`<g class="slot-bars-bar"><title>${tip(bar)}</title>
    <rect class="slot-bars-hit" x=${x} y="0" width=${bw} height=${H}></rect>${marks}</g>`;
}

/**
 * @param {{ title?: any, peak?: any, bars: Array<any>, parts: Array<{ key: string, label: any, tone?: string }>,
 *   from?: any, to?: any, label?: string, keyed?: boolean, tip?: (bar: any) => string,
 *   summary?: any, caveat?: any, fitAxis?: boolean }} props
 */
export function SlotBars({ title, peak, bars = [], parts = [], from, to, label, keyed, tip, summary, caveat, fitAxis }) {
  const max = bars.reduce((m, b) => Math.max(m, b.total || 0), 0);
  const chart = max && bars.length ? Chart({ title, peak, bars, parts, from, to, label, keyed, tip, fitAxis, max }) : null;
  const hasSummary = summary !== undefined && summary !== null && summary !== '';
  const hasCaveat = caveat !== undefined && caveat !== null && caveat !== '';
  if (!hasSummary && !hasCaveat) return chart;
  // summary + caveat (added in the appcat parity pass): the old version chart's line over it and
  // its caveat under it, one block with the old page's air (slot-bars.css .slot-bars-summed).
  return html`<div class="slot-bars-summed">
    ${hasSummary ? html`<div class="slot-bars-summary">${summary}</div>` : null}
    ${chart}
    ${hasCaveat ? html`<div class="slot-bars-caveat">${caveat}</div>` : null}
  </div>`;
}

/** The chart itself: the head, the bars, the axis and the key. */
function Chart({ title, peak, bars, parts, from, to, label, keyed, tip, fitAxis, max }) {
  const bw = Math.min(28, Math.max(2, Math.floor((W - PAD * (bars.length - 1)) / bars.length)));
  const svgW = bars.length * bw + PAD * (bars.length - 1);
  const tipOf = tip || ((bar) => (bar.to !== bar.from ? `${bar.from} – ${bar.to}` : bar.from)
    + ' · ' + parts.map((p) => `${p.label} ${bar[p.key] || 0}`).join(' · '));
  // fitAxis (added in the appcat parity pass): the dates under the bars only; a chart too short for
  // two dates says the span in one line, as the old version chart did.
  let axis = html`<div class="slot-bars-axis"><span>${from}</span><span>${to}</span></div>`;
  if (fitAxis && svgW < 240) axis = html`<div class="slot-bars-axis"><span>${from === to ? from : `${from} – ${to}`}</span></div>`;
  else if (fitAxis) axis = html`<div class="slot-bars-axis" style=${`max-width: ${svgW}px`}><span>${from}</span><span>${to}</span></div>`;
  return html`
    <div class="slot-bars">
      <div class="slot-bars-head"><span class="slot-bars-title">${title}</span><span class="slot-bars-peak">${peak}</span></div>
      <svg class="slot-bars-svg" width=${svgW} height=${H} viewBox=${`0 0 ${svgW} ${H}`} role="img" aria-label=${label || title}>
        <line class="slot-bars-base" x1="0" y1=${BASE} x2=${svgW} y2=${BASE}></line>
        ${bars.map((bar, i) => html`<${Slot} key=${bar.from} bar=${bar} i=${i} bw=${bw} max=${max} parts=${parts} tip=${tipOf} />`)}
      </svg>
      ${axis}
      ${keyed ? html`<div class="slot-bars-keys">${parts.map((p) => html`<span class="slot-bars-key" key=${p.key}>
        <i class=${`slot-bars-swatch slot-bars-swatch--${toneOf(p.tone)}`}></i>${p.label}</span>`)}</div>` : null}
    </div>`;
}

export default SlotBars;
