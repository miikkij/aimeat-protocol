/**
 * @file usage-tab.models.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sections 02 and 03 of the Usage page: what the money went on, and what it did by day.
 *
 *   WHY THE MODELS ARE ROWS AND NOT A CHART. The old page drew one stacked bar series per model
 *   into components/UsageChart.js, whose palette is twelve colours and whose colorForIndex CYCLES
 *   with `%`. On a node running eighteen models, six of them wore a colour another model already
 *   had — in a stacked bar, where two same-coloured segments inside one stack cannot be separated
 *   at all. The legend named eighteen models and could distinguish twelve.
 *
 *   A row with a bar has no such ceiling: the bar's length is the encoding, no colour is needed,
 *   and it reads the same at eight models or eighty. It is also the right figure for the question —
 *   "what is the money going on" is a ranking, never a time series.
 *
 *   THE ONE CHART THAT STAYS answers the question the page exists for, over time, with the only
 *   split that changes what an operator does: your key, and everybody else's. Two series, its own
 *   axis, and a legend because there are two (components/DayChart.js).
 * @structure
 *   - usd / compact — the two number shapes of the page
 *   - ModelRow — one model, or the folded tail, as a row of the ranked list
 *   - WhereItWent (02) — the models ranked, with the tail folded and the unpriced calls explained
 *   - ByDay (03) — one chart, two series, with a hover readout and the numbers behind a door
 * @usage Imported by views/admin/usage-tab.js.
 * @version-history
 *   v2.0.0 — 2026-09-27 — Library components only: the models are a List with the share Meter (the
 *     tail's in grey), the chart is DayChart, the numbers a List; no class written.
 *   v1.1.0 -- 2026-09-13 -- Compose shared B1 headings; SVG data carries chart ratios and readings.
 *   v1.0.0 — 2026-09-12 — Initial (the Usage page in the poster face).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num } from './shared.js';
import { Section } from '/components/Section.js';
import { List, Row as ListRow, Name, Num, Cell } from '/components/List.js';
import { Meter } from '/components/Figure.js';
import { Note } from '/components/Note.js';
import { Action } from '/components/Action.js';
import { EmptyState } from '/components/EmptyState.js';
import { Row } from '/components/Layout.js';
import { DayChart } from '/components/DayChart.js';

const S = (key, params) => t('admin.usage.' + key, params);

/** Money, in the shape a person reads: cents below a dollar, never four decimal places of nothing. */
export function usd(n) {
  const v = Number(n) || 0;
  if (v === 0) return '$0.00';
  if (v < 0.01) return '<$0.01';
  return '$' + v.toFixed(2);
}

/** A token count at a glance. The exact number is in the table behind the door. */
export function compact(n) {
  const v = Number(n) || 0;
  if (v < 1000) return String(Math.round(v));
  if (v < 1_000_000) return (v / 1000).toFixed(v < 10_000 ? 1 : 0) + 'k';
  return (v / 1_000_000).toFixed(1) + 'M';
}

const pct = (share) => Math.round((Number(share) || 0) * 100);

/** One model, or the folded tail. `tail` greys the bar: it is many models, not one. */
function ModelRow({ name, why, cost, calls, unpriced, share, widest, tail }) {
  // A floor, but only above zero: `Math.max(2, …)` on its own drew a visible bar for a row that
  // spent nothing, which is the same lie as a chart drawing axes over no data.
  const width = cost > 0 && widest > 0 ? Math.max(2, Math.round((cost / widest) * 100)) : 0;
  return html`
    <${ListRow}>
      <${Name} code=${!tail} meta=${why || undefined}>${name}<//>
      <${Num} strong>${usd(cost)}<//>
      <${Num}>${num(calls)}<//>
      <${Num}>${unpriced ? num(unpriced) : '—'}<//>
      <${Cell}>
        <${Row} gap="medium">
          <${Meter} fill thin pct=${width} tone=${tail ? 'dim' : undefined} />
          <${Note} kind="meta" inline mono>${pct(share)}%<//>
        <//>
      <//>
    <//>`;
}

/** Section 02: where the money went. */
export function WhereItWent({ models }) {
  const rows = models?.rows || [];
  const other = models?.other || null;
  const unpriced = models?.unpriced || {};
  const widest = rows.length ? rows[0].cost_usd : 0;

  if (!rows.length) {
    return html`
      <${Section} id="adm-us-02" num="02" title=${S('went.title')}>
        <${EmptyState} text=${S('went.empty')} />
      <//>`;
  }

  return html`
    <${Section} id="adm-us-02" num="02" title=${S('went.title')}>
      <${Note} kind="lead">${S('went.lead', { n: rows.length })}<//>

      <${List} cols="name-n-n-n-bar" labels head=${[
    S('went.model'),
    { label: S('went.cost'), num: true },
    { label: S('went.calls'), num: true },
    { label: S('went.noPrice'), num: true },
    S('went.share'),
  ]}>
        ${rows.map((m) => html`<${ModelRow} key=${m.model}
          name=${m.model}
          why=${m.providers?.length ? m.providers.join(' · ') : null}
          cost=${m.cost_usd} calls=${m.calls} unpriced=${m.unpriced_calls} share=${m.share}
          widest=${widest} />`)}

        ${other ? html`<${ModelRow} key="other"
          name=${S('went.otherTitle', { n: other.models })}
          why=${other.names.slice(0, 6).join(' · ')}
          cost=${other.cost_usd} calls=${other.calls} unpriced=${other.unpriced_calls}
          share=${other.share} widest=${widest} tail=${true} />` : null}
      <//>

      ${unpriced.calls
    ? html`<${Note}>${
      unpriced.on_models_that_charge
        ? S('went.unpricedSome', {
          n: num(unpriced.calls),
          tail: num(unpriced.in_the_tail),
          missing: usd(unpriced.estimated_missing_usd),
        })
        : S('went.unpricedFree', { n: num(unpriced.calls), tail: num(unpriced.in_the_tail) })
    }<//>`
    : null}
    <//>`;
}

/** Section 03: one chart, two series, its own axis. */
export function ByDay({ days }) {
  const [numbers, setNumbers] = useState(false);
  const list = days || [];
  const peak = list.reduce((m, d) => Math.max(m, d.house_usd + d.own_usd), 0);
  const anything = peak > 0;
  const dates = list.map(d => d.date);

  return html`
    <${Section} id="adm-us-03" num="03" title=${S('day.title')}
      doors=${html`<${Action} small soft onClick=${() => setNumbers(v => !v)}>${numbers ? S('day.showChart') : S('day.showNumbers')}<//>`}>
      <${Note} kind="lead">${S('day.lead')}<//>

      ${!anything ? html`<${EmptyState} text=${S('day.empty')} />`
    : numbers ? html`
      <${List} cols="name-n-n" labels
        head=${[S('day.day'), { label: S('day.house'), num: true }, { label: S('day.own'), num: true }]}>
        ${list.map(d => html`<${ListRow} key=${d.date}>
          <${Name}>${d.date}<//>
          <${Num}>${usd(d.house_usd)}<//>
          <${Num}>${usd(d.own_usd)}<//>
        <//>`)}
      <//>`
    : html`
      <${DayChart} title=${S('day.chartTitle')} days=${dates} format=${usd} peak=${peak}
        series=${[
    { label: S('day.house'), tone: 'second', values: list.map(d => d.house_usd) },
    { label: S('day.own'), tone: 'first', values: list.map(d => d.own_usd) },
  ]}
        axis=${S('day.axis', { n: usd(peak) })}
        readAt=${(i) => S('day.reading', { day: list[i].date, house: usd(list[i].house_usd), own: usd(list[i].own_usd) })}
        note=${S('day.note')} />`}
    <//>`;
}
