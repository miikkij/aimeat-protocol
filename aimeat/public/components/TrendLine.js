/**
 * @file public/components/TrendLine.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One number over time as a line, drawn inline as SVG with no chart library: its name
 *   and a small note over it, the line (one series, one hue), the newest reading marked with a coral
 *   tick, and the reading nearest the pointer written in a small box at the top right while a
 *   vertical cursor marks it; the two ends written under it. A page passes the readings and what
 *   they say, never a class. The look is css/components/trend-line.css.
 *
 *   TrendLine({ label, note, points, readAt, ends, mid, area, ariaLabel })
 *   - points: the readings, oldest first (numbers).
 *   - readAt(i): the words of reading i in the box (a value, a date and a value).
 *   - ends: [left, right], the words under the two ends ("12 · oldest", "14 · now").
 *   - mid: the words of the one dashed line across the middle (the value it marks); no line without.
 *   - area: a sun ground under the line (readings that sit in a narrow band read as a surface).
 *   - label: the name over the line, as a row label; note: the small mono words at its right.
 *   The box scales to its column, so a circle would draw as an ellipse: the newest reading is a
 *   tick whose stroke does not scale.
 * @structure TrendLine(props)
 * @usage html`<${TrendLine} label=${x('chartLabel')} note=${x('range')} points=${values}
 *          readAt=${(i) => `${when(at[i])} · ${num(values[i])}`} ends=${[first, last]} mid=${num(middle)} />`
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial: the operator's Database page's seven-day line (database-tab.js Line,
 *     .adm-db-chart) and the Metrics page's session line (metrics-tab.js Line, .adm-mx-chart) as one
 *     component; the midline and the sun ground are its options (admin page group G3).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);
const W = 720;
const H = 160;
const has = (x) => x !== undefined && x !== null && x !== false && x !== '';

/**
 * @param {{ label?: any, note?: any, points: number[], readAt?: (i: number) => any, ends?: any[], mid?: any,
 *   area?: boolean, ariaLabel?: string }} props
 */
export function TrendLine({ label, note, points = [], readAt, ends, mid, area, ariaLabel }) {
  const [at, setAt] = useState(null);
  if (points.length < 1) return null;
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const span = Math.max(1, hi - lo);
  const last = points.length - 1;
  // The newest point carries a 3px tick, so the series stops two units short of the right edge
  // and the tick is not sliced in half by the viewBox.
  const x = (i) => (points.length < 2 ? W - 2 : (i / last) * (W - 2));
  const y = (v) => H - 12 - ((v - lo) / span) * (H - 24);
  const line = points.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const ground = `0,${H} ${line} ${x(last).toFixed(1)},${H}`;
  const pick = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - box.left) / Math.max(1, box.width);
    setAt(Math.min(last, Math.max(0, Math.round(rel * last))));
  };
  const cur = at !== null && points[at] !== undefined;
  return html`
    <div class="trend-line">
      ${has(label) || has(note) ? html`<div class="trend-line-head">
        <span class="poster-label">${label}</span>
        ${has(note) ? html`<small>${note}</small>` : null}
      </div>` : null}
      <div class="trend-line-plot">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label=${ariaLabel || label}>
          ${area ? html`<polygon class="trend-line-area" points=${ground} />` : null}
          ${has(mid) ? html`<line class="trend-line-mid" x1="0" y1=${H / 2} x2=${W} y2=${H / 2} vector-effect="non-scaling-stroke" />
            <text class="trend-line-midlabel" x="4" y=${H / 2 - 5}>${mid}</text>` : null}
          <polyline class="trend-line-path" points=${line} vector-effect="non-scaling-stroke" />
          ${cur ? html`<line class="trend-line-cursor" x1=${x(at)} y1="0" x2=${x(at)} y2=${H} vector-effect="non-scaling-stroke" />` : null}
          <line class="trend-line-now" x1=${x(last)} y1=${y(points[last]) - 7} x2=${x(last)} y2=${y(points[last]) + 7}
            vector-effect="non-scaling-stroke" />
          <rect class="trend-line-hit" x="0" y="0" width=${W} height=${H} onMouseMove=${pick} onMouseLeave=${() => setAt(null)} />
        </svg>
        ${cur && readAt ? html`<span class="trend-line-read">${readAt(at)}</span>` : null}
      </div>
      ${ends ? html`<div class="trend-line-ends"><span>${ends[0]}</span><span>${ends[1]}</span></div>` : null}
    </div>`;
}

export default TrendLine;
