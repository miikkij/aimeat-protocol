/**
 * @file public/components/DayChart.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Numbers by day, as bars drawn without a chart library: DayChart is one framed chart
 *   with its own axis (one or two series side by side each day, a legend, a line over the plot that
 *   says what the tallest bar is worth and, under the pointer, what that day read, the days under
 *   the plot and a note under them); DaySpark is one series as a row of thin bars, the newest day
 *   against the right edge, for a row of a list. Every bar says its day and value as its tooltip. A
 *   page passes the days and the series and never a class. The look is css/components/day-chart.css.
 *
 *   TWO CHARTS, NEVER ONE WITH TWO SCALES: a page with numbers of different sizes (hundreds of
 *   memory reads, tens of thousands of refusals) draws two DayCharts, each owning its axis, so the
 *   small series is not a flat line at the foot of the big one's.
 *
 *   A SERIES COLOUR IS DATA: `tone` names the series' colour and it stays the same when the theme
 *   flips, or the same bar would mean two things in light and dark. 'first' and 'second' are slots 1
 *   and 2 of the validated categorical palette (a blue and an orange), 'critical' is the reserved
 *   status red for a number that IS a refusal, 'plain' is the words' grey for a single unnamed series.
 *
 *   DayChart({ title, series, days, axis, readAt, format, note, label, peak })
 *   - series: [{ label, values, tone }], one value per day (1 or 2 series; a legend always).
 *   - days: the x axis as 'YYYY-MM-DD'; the axis writes 'MM-DD'.
 *   - axis: the line over the plot while the pointer is away ("tallest bar: 1 234").
 *   - readAt(i): the line while the pointer is on day i; by default "day · label value · …".
 *   - format(v): a value as words (a number by default; money on a page of spend).
 *   - note: the grey line under the chart. label: the plot's name for a screen reader.
 *   - peak: the value the plot's full height stands for (a day's two series together); the
 *     tallest bar by default.
 *   DaySpark({ values, days, tone, format }): the row of thin bars (34px high).
 * @structure DayChart(props) · DaySpark(props) · barHeight(value, peak)
 * @usage html`<${DayChart} title=${x('memory')} days=${days} axis=${x('axis', { n: peak })}
 *          series=${[{ label: x('reads'), tone: 'first', values: reads }, { label: x('writes'), tone: 'second', values: writes }]} />`
 *        html`<${DaySpark} values=${row.series} days=${days} tone="critical" />`
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial: the operator's Statistics page's Plot and Spark (stats-tab.days.js,
 *     .adm-st-chart, .adm-st-spark) and the Usage page's ByDay chart (usage-tab.models.js,
 *     .adm-us-chart), one chart with the series tones the two pages' sheets carried (admin page
 *     group G3).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { num } from '/js/format.js';

const html = htm.bind(h);
const TONES = new Set(['first', 'second', 'critical', 'plain']);
const toneOf = (tone) => (TONES.has(tone) ? tone : 'plain');
const plain = (v) => num(v || 0);

/** A bar's height as a percentage of the tallest in its own plot; never zero-height when non-zero. */
export function barHeight(value, peak) {
  if (!value || !peak) return 0;
  return Math.max(3, Math.round((value / peak) * 100));
}

/** One bar: an SVG box whose height attribute carries the value, its colour the series' tone. */
function Bar({ tone, value, peak, title }) {
  return html`<svg class=${`day-chart-bar day-chart-bar--${toneOf(tone)}`} height=${barHeight(value, peak) + '%'}><title>${title}</title></svg>`;
}

/**
 * The framed chart.
 * @param {{ title?: any, series: Array<{ label: any, values: number[], tone?: string }>, days: string[],
 *   axis?: any, readAt?: (i: number) => any, format?: (v: number) => any, note?: any, label?: string, peak?: number }} props
 */
export function DayChart({ title, series = [], days = [], axis, readAt, format = plain, note, label, peak: top }) {
  const [hover, setHover] = useState(null);
  const peak = top ?? series.reduce((m, s) => Math.max(m, ...(s.values || [0])), 0);
  const reading = hover === null || days[hover] === undefined
    ? axis
    : (readAt ? readAt(hover) : `${days[hover]} · ` + series.map((s) => `${s.label} ${format(s.values[hover])}`).join(' · '));
  return html`
    <div class="day-chart">
      <div class="day-chart-head">
        <span class="day-chart-title">${title}</span>
        <span class="day-chart-legend">
          ${series.map((s, i) => html`<span key=${i}><i class=${`day-chart-key day-chart-bar--${toneOf(s.tone)}`}></i>${s.label}</span>`)}
        </span>
      </div>
      <span class=${hover === null ? 'day-chart-read' : 'day-chart-read day-chart-read--on'}>${reading}</span>
      <div class="day-chart-plot" role="img" aria-label=${label || title}>
        ${days.map((day, i) => html`
          <div class="day-chart-day" key=${day} onMouseEnter=${() => setHover(i)} onMouseLeave=${() => setHover(null)}>
            <div class="day-chart-pair">
              ${series.map((s, k) => html`<${Bar} key=${k} tone=${s.tone} value=${s.values[i]} peak=${peak}
                title=${`${day} · ${s.label} ${format(s.values[i])}`} />`)}
            </div>
          </div>`)}
      </div>
      <div class="day-chart-x">${days.map((day) => html`<span key=${day}>${String(day).slice(5)}</span>`)}</div>
      ${note ? html`<p class="day-chart-note">${note}</p>` : null}
    </div>`;
}

/**
 * One series as thin bars, the newest against the right edge.
 * @param {{ values: number[], days: string[], tone?: string, format?: (v: number) => any }} props
 */
export function DaySpark({ values = [], days = [], tone, format = plain }) {
  const peak = values.reduce((a, b) => (b > a ? b : a), 0);
  return html`<span class="day-spark">
    ${values.map((v, i) => html`<${Bar} key=${i} tone=${tone} value=${v} peak=${peak} title=${`${days[i]} · ${format(v)}`} />`)}
  </span>`;
}

export default DayChart;
