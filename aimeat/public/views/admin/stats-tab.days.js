/**
 * @file stats-tab.days.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sections 02 and 03 of the Statistics page: one row per counter, and the two
 *   day-by-day charts.
 *
 *   TWO CHARTS, NEVER ONE WITH TWO SCALES. Memory runs in the hundreds a day and refusals in the
 *   tens of thousands; on one plot with two y axes the memory bars are a flat line at the bottom
 *   and the reader concludes nothing happened. Two plots, each owning its axis, is the whole reason
 *   the old page's three Chart.js canvases went: two of them had nothing to draw and drew axes
 *   anyway, and the third put unrelated magnitudes side by side.
 *
 *   THE SHARED CHART draws them (components/UsageChart.js, the vendored Chart.js, loaded once
 *   and only when a chart is on screen). The page used to pull Chart.js from a CDN on every visit
 *   to draw four canvases, one of which was always empty; then it drew bars by hand, in a sheet of
 *   its own, which no theme or part could reach.
 *
 *   THE COLOURS ARE DATA: reads and writes keep their identity when the theme flips, and a refusal
 *   wears the red slot because it IS a status.
 * @structure
 *   - Spark — one counter's period as the shared chart's spark
 *   - WhatMoved (02) — the catalogue read, live rows first, the untouched ones named in one line
 *   - Plot — one chart: its own axis, a legend, the tooltip as the hover readout
 *   - TheDays (03) — the two charts, and the numbers behind them
 * @usage Imported by stats-tab.js.
 * @version-history
 *   v1.2.0 -- 2026-09-22 -- Composed from the shared component set: sections, counter rows as
 *     shared list rows with chips, the charts drawn by the shared chart, the numbers as a shared
 *     table; the page's own sheet is gone. The per-row sparkline is the shared chart's spark.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v1.1.0 -- 2026-09-13 -- Compose shared B1 headings; SVG data carries bar heights and readings.
 *   v1.0.0 — 2026-09-12 — Initial (the Statistics page in the poster face).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, Empty } from './shared.js';
import { seriesFor } from './stats-tab.data.js';
import { Section, Columns, Stack, Text, Action, Chip, ListRow, Table } from '/components/poster-parts.js';
import { UsageChart, colorForIndex } from '/components/UsageChart.js';

const S = (key, params) => t('admin.stats.' + key, params);

/** A day as the axis writes it: "09-12", which is short enough to fit thirty of them. */
const short = (day) => String(day).slice(5);

/**
 * The chart colour of each series role. A series colour is data: reads and writes keep their
 * identity whatever the theme, and a refusal wears the red slot because it IS a status.
 */
const ROLE_COLOUR = { reads: colorForIndex(1), writes: colorForIndex(10), critical: colorForIndex(0), plain: colorForIndex(5) };

/** The value column of a row, which says what state the counter is in rather than printing a zero. */
function CounterValue({ row, chip }) {
  return html`<${Stack} direction="horizontal" align="center" density="compact">
    ${chip}
    <${Text} kind="number" size="small" tone=${row.state === 'never' ? 'muted' : 'plain'}>${row.state === 'never' ? '—' : num(row.total)}<//>
  <//>`;
}

/**
 * One counter's period as a sparkline: the shared chart's small line, no axes; its tooltip gives
 * each day's reading. A refusal keeps the red slot because it is a status; the rest take the
 * chart's own coral.
 */
function Spark({ row, days }) {
  const datasets = [{
    label: S('counter.' + row.name),
    data: row.series,
    ...(row.role === 'critical' ? { borderColor: ROLE_COLOUR.critical, backgroundColor: ROLE_COLOUR.critical } : {}),
  }];
  return html`<${UsageChart} type="spark" labels=${days} datasets=${datasets} height=${36} yFormat=${(v) => num(v)} />`;
}

/** Section 02: what moved, one row per counter that has ever moved. */
export function WhatMoved({ rows, days, onShowNumbers }) {
  const live = rows.filter(r => r.state !== 'never');
  const never = rows.filter(r => r.state === 'never');
  const ordered = [...live].sort((a, b) => b.total - a.total);

  return html`
    <${Section} id="adm-st-02" title=${S('moved.title')} count="02" description=${S('moved.lead')}
      actions=${html`<${Action} onClick=${onShowNumbers}>${S('moved.numbers')}<//>`}>
      <div>
        ${ordered.map((row) => html`<${ListRow} key=${row.key} density="compact"
          name=${S('counter.' + row.name)}
          detail=${row.key + (row.fail && row.state === 'live' ? ' · ' + S('moved.failed', { n: num(row.failed) }) : '')}
          value=${html`<${CounterValue} row=${row} chip=${row.state === 'quiet'
    ? html`<${Chip} tone="muted">${S('moved.quiet')}<//>`
    : html`<${Chip} tone=${row.role === 'critical' ? 'danger' : 'success'}>${S('moved.perDay')}<//>`} />`}>
          ${row.state === 'quiet' ? html`<${Text} kind="mono" tone="muted">${S('moved.everInstead', { n: num(row.ever) })}<//>`
    : row.state === 'live' ? html`<${Spark} row=${row} days=${days} />` : null}
        <//>`)}

        ${never.length ? html`<${ListRow} density="compact"
          name=${S('moved.neverTitle')}
          detail=${never.map(r => S('counter.' + r.name)).join(' · ')} detailKind="text"
          value=${html`<${CounterValue} row=${{ state: 'never' }} chip=${html`<${Chip} tone="muted">${S('moved.neverChip')}<//>`} />`}>
          <${Text} kind="mono" tone="muted">${S('moved.neverWhy')}<//>
        <//>` : null}
      </div>
    <//>`;
}

/**
 * One chart, drawn by the shared chart. `series` is one or two entries; the axis is this chart's
 * own, and the line above says what the tallest bar is worth. The tooltip reads the day under the
 * cursor, which the hand-drawn chart showed in that line.
 */
function Plot({ title, series, days, note }) {
  const peak = series.reduce((m, s) => Math.max(m, ...s.values), 0);
  const datasets = series.map(s => ({ label: s.label, data: s.values, backgroundColor: ROLE_COLOUR[s.role] || ROLE_COLOUR.plain }));
  return html`
    <${Stack} density="compact">
      <${Stack} direction="wrap" align="between">
        <${Text} kind="label">${title}<//>
        <${Text} kind="mono" tone="muted">${S('days.axis', { n: num(peak) })}<//>
      <//>
      <${UsageChart} labels=${days.map(short)} datasets=${datasets} height=${170} yFormat=${(v) => num(v)} />
      ${note ? html`<${Text} kind="caption" tone="muted">${note}<//>` : null}
    <//>`;
}

/** The two plots as one table, for reading an exact number or copying the lot. */
function Numbers({ series, days }) {
  return html`<${Table} density="compact" label=${S('days.title')}
    headers=${[S('days.day'), ...series.map(s => s.label)]}
    rows=${days.map((day, i) => [html`<strong>${day}</strong>`, ...series.map(s => ({ text: num(s.values[i]), align: 'end' }))])} />`;
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
    <${Section} id="adm-st-03" title=${S('days.title')} count="03" description=${S('days.lead')}
      actions=${html`<${Action} onClick=${onToggle} expanded=${!!showNumbers}>
        ${showNumbers ? S('days.showCharts') : S('days.showNumbers')}
      <//>`}>
      ${nothing ? html`<${Empty} text=${S('days.empty')} />`
    : showNumbers
      ? html`<${Numbers} series=${[...memory, ...refused]} days=${days} />`
      : html`
        <${Columns} layout="equal" collapse=${900} density="roomy">
          <${Plot} title=${S('days.memory')} series=${memory} days=${days} note=${S('days.memoryNote')} />
          <${Plot} title=${S('days.refused')} series=${refused} days=${days} note=${S('days.refusedNote')} />
        <//>`}
    <//>`;
}
