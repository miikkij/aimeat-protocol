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
 *   NO CHART LIBRARY. The bars are components/DayChart.js (DayChart, DaySpark). The page used to
 *   pull Chart.js from a CDN on every visit to draw four canvases, one of which was always empty.
 *
 *   THE COLOURS ARE DATA: a counter's `role` picks the series tone of the chart component, so reads
 *   and writes keep their identity when the theme flips, and a refusal wears the reserved critical
 *   red because it IS a status.
 * @structure
 *   - TONE — a counter's role as the chart's series tone
 *   - WhatMoved (02) — the catalogue read, live rows first, the untouched ones named in one line
 *   - Numbers — the two plots as one table
 *   - TheDays (03) — the two charts, and the numbers behind them
 * @usage Imported by stats-tab.js.
 * @version-history
 *   v2.0.0 — 2026-09-27 — Library components only: the counters are a List with the state Mark, the
 *     Figure and the DaySpark; the charts are DayChart; the numbers a List; no class written.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v1.1.0 -- 2026-09-13 -- Compose shared B1 headings; SVG data carries bar heights and readings.
 *   v1.0.0 — 2026-09-12 — Initial (the Statistics page in the poster face).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num } from './shared.js';
import { seriesFor } from './stats-tab.data.js';
import { Section } from '/components/Section.js';
import { List, Row, Name, Cell, Num } from '/components/List.js';
import { Mark } from '/components/Mark.js';
import { Figure } from '/components/Figure.js';
import { Note } from '/components/Note.js';
import { Action } from '/components/Action.js';
import { EmptyState } from '/components/EmptyState.js';
import { Columns } from '/components/Layout.js';
import { DayChart, DaySpark } from '/components/DayChart.js';

const S = (key, params) => t('admin.stats.' + key, params);

/** A counter's role as the series tone of the chart component (the same counter, the same colour). */
const TONE = { critical: 'critical', reads: 'first', writes: 'second', plain: 'plain' };

/** Section 02: what moved, one row per counter that has ever moved. */
export function WhatMoved({ rows, days, onShowNumbers }) {
  const live = rows.filter(r => r.state !== 'never');
  const never = rows.filter(r => r.state === 'never');
  const ordered = [...live].sort((a, b) => b.total - a.total);

  return html`
    <${Section} id="adm-st-02" num="02" title=${S('moved.title')}
      doors=${html`<${Action} small soft onClick=${onShowNumbers}>${S('moved.numbers')}<//>`}>
      <${Note} kind="lead">${S('moved.lead')}<//>

      <${List} cols="name-state-n-trend">
        ${ordered.map((row) => html`
          <${Row} key=${row.key}>
            <${Name} meta=${`${row.key}${row.fail && row.state === 'live' ? ' · ' + S('moved.failed', { n: num(row.failed) }) : ''}`}>
              ${S('counter.' + row.name)}
            <//>
            <${Cell}>${row.state === 'quiet'
    ? html`<${Mark} kind="status" tone="off">${S('moved.quiet')}<//>`
    : html`<${Mark} kind="status" tone=${row.role === 'critical' ? 'danger' : 'fine'}>${S('moved.perDay')}<//>`}<//>
            <${Num}><${Figure} small end n=${num(row.total)} /><//>
            <${Cell}>${row.state === 'quiet'
    ? html`<${Note} kind="meta" inline mono>${S('moved.everInstead', { n: num(row.ever) })}<//>`
    : row.state === 'live' ? html`<${DaySpark} values=${row.series} days=${days} tone=${TONE[row.role]} />` : null}<//>
          <//>`)}

        ${never.length ? html`
          <${Row} key="never">
            <${Name} meta=${never.map(r => S('counter.' + r.name)).join(' · ')}>${S('moved.neverTitle')}<//>
            <${Cell}><${Mark} kind="status" tone="off">${S('moved.neverChip')}<//><//>
            <${Num}><${Figure} small end tone="dim" n="—" /><//>
            <${Cell}><${Note} kind="meta" inline mono>${S('moved.neverWhy')}<//><//>
          <//>` : null}
      <//>
    <//>`;
}

/** The two plots as one table, for reading an exact number or copying the lot. */
function Numbers({ series, days }) {
  return html`
    <${List} cols="name-n-n-n" labels
      head=${[S('days.day'), ...series.map(s => ({ label: s.label, num: true }))]}>
      ${days.map((day, i) => html`
        <${Row} key=${day}>
          <${Name}>${day}<//>
          ${series.map((s, k) => html`<${Num} key=${k}>${num(s.values[i])}<//>`)}
        <//>`)}
    <//>`;
}

/** Section 03: the days. Two charts, or the numbers behind them. */
export function TheDays({ daily, days, showNumbers, onToggle }) {
  const memory = [
    { label: S('counter.memRead'), tone: TONE.reads, values: seriesFor(daily, days, 'memory_reads') },
    { label: S('counter.memWrite'), tone: TONE.writes, values: seriesFor(daily, days, 'memory_writes') },
  ];
  const refused = [
    { label: S('counter.refused'), tone: TONE.critical, values: seriesFor(daily, days, 'auth_failures_total') },
  ];
  const nothing = ![...memory, ...refused].some(s => s.values.some(v => v > 0));
  // The line over each plot says what its tallest bar is worth, so a reader can put a number on any
  // of them; the axis is that plot's own.
  const axisOf = (series) => S('days.axis', { n: num(series.reduce((m, s) => Math.max(m, ...s.values), 0)) });

  return html`
    <${Section} id="adm-st-03" num="03" title=${S('days.title')}
      doors=${html`<${Action} small soft onClick=${onToggle}>${showNumbers ? S('days.showCharts') : S('days.showNumbers')}<//>`}>
      <${Note} kind="lead">${S('days.lead')}<//>

      ${nothing ? html`<${EmptyState} text=${S('days.empty')} />`
    : showNumbers
      ? html`<${Numbers} series=${[...memory, ...refused]} days=${days} />`
      : html`
        <${Columns}>
          <${DayChart} title=${S('days.memory')} series=${memory} days=${days} axis=${axisOf(memory)} note=${S('days.memoryNote')} />
          <${DayChart} title=${S('days.refused')} series=${refused} days=${days} axis=${axisOf(refused)} note=${S('days.refusedNote')} />
        <//>`}
    <//>`;
}
