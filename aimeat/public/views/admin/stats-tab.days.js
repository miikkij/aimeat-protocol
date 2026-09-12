/**
 * @file stats-tab.days.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sections 02 and 03 of the Statistics page: one row per counter with a sparkline of
 *   the period, and the two day-by-day charts.
 *
 *   TWO CHARTS, NEVER ONE WITH TWO SCALES. Memory runs in the hundreds a day and refusals in the
 *   tens of thousands; on one plot with two y axes the memory bars are a flat line at the bottom
 *   and the reader concludes nothing happened. Two plots, each owning its axis, is the whole reason
 *   the old page's three Chart.js canvases went: two of them had nothing to draw and drew axes
 *   anyway, and the third put unrelated magnitudes side by side.
 *
 *   NO CHART LIBRARY. These are bars in a flex row. The page used to pull Chart.js from a CDN on
 *   every visit to draw four canvases, one of which was always empty.
 *
 *   THE COLOURS ARE DATA, so they are classes here and literal values in admin-stats.css rather
 *   than theme tokens: reads and writes keep their identity when the theme flips, and a refusal
 *   wears the reserved critical red because it IS a status.
 * @structure
 *   - Spark — one counter's period, thin bars, a title per day
 *   - WhatMoved (02) — the catalogue read, live rows first, the untouched ones named in one line
 *   - Plot — one chart: its own axis, a legend when it has two series, a hover readout
 *   - TheDays (03) — the two charts, and the numbers behind them
 * @usage Imported by stats-tab.js.
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial (the Statistics page in the poster face).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num } from './shared.js';
import { seriesFor } from './stats-tab.data.js';

const S = (key, params) => t('admin.stats.' + key, params);

/** A day as the axis writes it: "09-12", which is short enough to fit thirty of them. */
const short = (day) => String(day).slice(5);

/** A bar's height as a percentage of the tallest in its own plot; never zero-height when non-zero. */
function barHeight(value, peak) {
  if (!value) return 0;
  if (!peak) return 0;
  return Math.max(3, Math.round((value / peak) * 100));
}

/** One counter's period as thin bars. The title is the hover reading for a single row. */
function Spark({ row, days }) {
  if (row.state !== 'live') return null;
  return html`
    <span class="adm-st-spark">
      ${row.series.map((v, i) => html`
        <i class="adm-st-bar adm-st-bar--${row.role}"
           style=${`height:${barHeight(v, row.peak)}%`}
           title=${`${days[i]} · ${num(v)}`}></i>`)}
    </span>`;
}

/** The value column of a row, which says what state the counter is in rather than printing a zero. */
function CounterValue({ row }) {
  if (row.state === 'never') return html`<span class="adm-st-num adm-st-num--none">—</span>`;
  return html`<span class="adm-st-num">${num(row.total)}</span>`;
}

/** Section 02: what moved, one row per counter that has ever moved. */
export function WhatMoved({ rows, days, onShowNumbers }) {
  const live = rows.filter(r => r.state !== 'never');
  const never = rows.filter(r => r.state === 'never');
  const ordered = [...live].sort((a, b) => b.total - a.total);

  return html`
    <section class="og-sec" id="adm-st-02">
      <div class="og-sec-h">
        <h2>${S('moved.title')}<small>02</small></h2>
        <div class="og-doors">
          <button type="button" class="og-door og-door--quiet" onClick=${onShowNumbers}>${S('moved.numbers')}</button>
        </div>
      </div>
      <p class="adm-st-lead">${S('moved.lead')}</p>

      ${ordered.map((row, i) => html`
        <div class="adm-st-crow ${i === ordered.length - 1 && !never.length ? 'adm-st-crow--last' : ''}">
          <span>
            <b>${S('counter.' + row.name)}</b>
            <span class="adm-why">
              ${row.key}${row.fail && row.state === 'live' ? ' · ' + S('moved.failed', { n: num(row.failed) }) : ''}
            </span>
          </span>
          <span>
            ${row.state === 'quiet'
    ? html`<span class="adm-st-chip adm-st-chip--muted">${S('moved.quiet')}</span>`
    : html`<span class="adm-st-chip adm-st-chip--${row.role === 'critical' ? 'bad' : 'ok'}">${S('moved.perDay')}</span>`}
          </span>
          <${CounterValue} row=${row} />
          ${row.state === 'quiet'
    ? html`<span class="adm-st-aside">${S('moved.everInstead', { n: num(row.ever) })}</span>`
    : html`<${Spark} row=${row} days=${days} />`}
        </div>`)}

      ${never.length ? html`
        <div class="adm-st-crow adm-st-crow--last">
          <span>
            <b>${S('moved.neverTitle')}</b>
            <span class="adm-why">${never.map(r => S('counter.' + r.name)).join(' · ')}</span>
          </span>
          <span><span class="adm-st-chip adm-st-chip--muted">${S('moved.neverChip')}</span></span>
          <span class="adm-st-num adm-st-num--none">—</span>
          <span class="adm-st-aside">${S('moved.neverWhy')}</span>
        </div>` : null}
    </section>`;
}

/**
 * One chart. `series` is one or two entries; the axis is this chart's own, and the hint says what
 * the tallest bar is worth so a reader can put a number on any of them.
 */
function Plot({ title, series, days, note }) {
  const [hover, setHover] = useState(null);
  const peak = series.reduce((m, s) => Math.max(m, ...s.values), 0);
  const axis = S('days.axis', { n: num(peak) });
  const reading = hover === null
    ? axis
    : `${days[hover]} · ` + series.map(s => `${s.label} ${num(s.values[hover])}`).join(' · ');

  return html`
    <div class="adm-st-chart">
      <div class="adm-st-chart-h">
        <span class="adm-st-chart-t">${title}</span>
        ${series.length > 1 ? html`
          <span class="adm-st-legend">
            ${series.map(s => html`<span><i class="adm-st-key adm-st-key--${s.role}"></i>${s.label}</span>`)}
          </span>` : html`
          <span class="adm-st-legend">
            <span><i class="adm-st-key adm-st-key--${series[0].role}"></i>${series[0].label}</span>
          </span>`}
      </div>
      <span class="adm-st-yhint ${hover === null ? '' : 'adm-st-yhint--on'}">${reading}</span>
      <div class="adm-st-plot">
        ${days.map((day, i) => html`
          <div class="adm-st-day" onMouseEnter=${() => setHover(i)} onMouseLeave=${() => setHover(null)}>
            <div class="adm-st-pair">
              ${series.map(s => html`
                <i class="adm-st-bar adm-st-bar--${s.role}"
                   style=${`height:${barHeight(s.values[i], peak)}%`}
                   title=${`${day} · ${s.label} ${num(s.values[i])}`}></i>`)}
            </div>
          </div>`)}
      </div>
      <div class="adm-st-xaxis">
        ${days.map(day => html`<span>${short(day)}</span>`)}
      </div>
      ${note ? html`<p class="adm-st-note">${note}</p>` : null}
    </div>`;
}

/** The two plots as one table, for reading an exact number or copying the lot. */
function Numbers({ series, days }) {
  return html`
    <div class="adm-st-scroll">
      <table class="adm-st-tbl">
        <thead><tr>
          <th>${S('days.day')}</th>
          ${series.map(s => html`<th class="num">${s.label}</th>`)}
        </tr></thead>
        <tbody>
          ${days.map((day, i) => html`
            <tr>
              <td><b>${day}</b></td>
              ${series.map(s => html`<td class="num">${num(s.values[i])}</td>`)}
            </tr>`)}
        </tbody>
      </table>
    </div>`;
}

/** Section 03: the days. Two charts, or the numbers behind them. */
export function TheDays({ daily, days, showNumbers, onToggle }) {
  const memory = [
    { label: S('counter.memRead'), role: 'reads', values: seriesFor(daily, days, 'memory_reads') },
    { label: S('counter.memWrite'), role: 'writes', values: seriesFor(daily, days, 'memory_writes') },
  ];
  const refused = [
    { label: S('counter.refused'), role: 'critical', values: seriesFor(daily, days, 'auth_failures_total') },
  ];
  const nothing = ![...memory, ...refused].some(s => s.values.some(v => v > 0));

  return html`
    <section class="og-sec" id="adm-st-03">
      <div class="og-sec-h">
        <h2>${S('days.title')}<small>03</small></h2>
        <div class="og-doors">
          <button type="button" class="og-door og-door--quiet" onClick=${onToggle}>
            ${showNumbers ? S('days.showCharts') : S('days.showNumbers')}
          </button>
        </div>
      </div>
      <p class="adm-st-lead">${S('days.lead')}</p>

      ${nothing ? html`<div class="adm-st-empty">${S('days.empty')}</div>`
    : showNumbers
      ? html`<${Numbers} series=${[...memory, ...refused]} days=${days} />`
      : html`
        <div class="adm-st-charts">
          <${Plot} title=${S('days.memory')} series=${memory} days=${days} note=${S('days.memoryNote')} />
          <${Plot} title=${S('days.refused')} series=${refused} days=${days} note=${S('days.refusedNote')} />
        </div>`}
    </section>`;
}
