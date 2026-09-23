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
 *   split that changes what an operator does: your key, and everybody else's. Two series, so the
 *   shared chart's palette never cycles; its tooltip carries the day's reading that the hand-drawn
 *   chart showed above the plot.
 * @structure
 *   - WhereItWent (02) — the models ranked in a table, a meter per row for the share
 *   - ByDay (03) — one chart, two series, with the numbers behind a door
 * @usage Imported by views/admin/usage-tab.js.
 * @version-history
 *   v1.2.0 -- 2026-09-22 -- Composed from the shared component set: the models are a shared table
 *     with a progress meter for the share, and the by-day chart is the shared UsageChart with two
 *     series, so the page needs no sheet of its own.
 *   v1.1.0 -- 2026-09-13 -- Compose shared B1 headings; SVG data carries chart ratios and readings.
 *   v1.0.0 — 2026-09-12 — Initial (the Usage page in the poster face).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, Empty } from './shared.js';
import { Section, Stack, Text, Action, Table, Meter } from '/components/poster-parts.js';
import { UsageChart, colorForIndex } from '/components/UsageChart.js';

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

/**
 * One model, or the folded tail, as a table row. `tail` sets the name in bold: it is many models, not one.
 * @param {{ name: any, why: any, cost: any, calls: any, unpriced: any, share: any, widest: any, tail?: boolean }} row
 */
function modelRow({ name, why, cost, calls, unpriced, share, widest, tail = false }) {
  // A floor, but only above zero: `Math.max(2, …)` on its own drew a visible bar for a row that
  // spent nothing, which is the same lie as a chart drawing axes over no data.
  const width = cost > 0 && widest > 0 ? Math.max(2, Math.round((cost / widest) * 100)) : 0;
  return [
    html`<${Stack} density="compact">
      ${tail ? html`<strong>${name}</strong>` : html`<${Text} kind="mono">${name}<//>`}
      ${why ? html`<${Text} kind="caption" tone="muted">${why}<//>` : null}
    <//>`,
    { text: usd(cost), align: 'end' },
    { text: num(calls), align: 'end' },
    { text: unpriced ? num(unpriced) : '—', align: 'end' },
    html`<${Stack} density="compact">
      <${Meter} kind="progress" value=${width} max=${100} label=${pct(share) + '%'} />
      <${Text} kind="caption" tone="muted">${pct(share)}%<//>
    <//>`,
  ];
}

/** Section 02: where the money went. */
export function WhereItWent({ models }) {
  const rows = models?.rows || [];
  const other = models?.other || null;
  const unpriced = models?.unpriced || {};
  const widest = rows.length ? rows[0].cost_usd : 0;

  if (!rows.length) {
    return html`
      <${Section} id="adm-us-02" title=${S('went.title')} count="02">
        <${Empty} text=${S('went.empty')} />
      <//>`;
  }

  return html`
    <${Section} id="adm-us-02" title=${S('went.title')} count="02" description=${S('went.lead', { n: rows.length })}>
      <${Stack}>
        <${Table} density="compact" label=${S('went.title')}
          headers=${[S('went.model'), S('went.cost'), S('went.calls'), S('went.noPrice'), S('went.share')]}
          rows=${[
    ...rows.map((m) => modelRow({
      name: m.model,
      why: m.providers?.length ? m.providers.join(' · ') : null,
      cost: m.cost_usd, calls: m.calls, unpriced: m.unpriced_calls, share: m.share, widest,
    })),
    ...(other ? [modelRow({
      name: S('went.otherTitle', { n: other.models }),
      why: other.names.slice(0, 6).join(' · '),
      cost: other.cost_usd, calls: other.calls, unpriced: other.unpriced_calls,
      share: other.share, widest, tail: true,
    })] : []),
  ]} />
        ${unpriced.calls
    ? html`<${Text} kind="caption" tone="muted">${
      unpriced.on_models_that_charge
        ? S('went.unpricedSome', {
          n: num(unpriced.calls),
          tail: num(unpriced.in_the_tail),
          missing: usd(unpriced.estimated_missing_usd),
        })
        : S('went.unpricedFree', { n: num(unpriced.calls), tail: num(unpriced.in_the_tail) })
    }<//>`
    : null}
      <//>
    <//>`;
}

/** Section 03: one chart, two series, its own axis. */
export function ByDay({ days }) {
  const [numbers, setNumbers] = useState(false);
  const list = days || [];
  const peak = list.reduce((m, d) => Math.max(m, d.house_usd + d.own_usd), 0);
  const anything = peak > 0;

  const datasets = [
    { label: S('day.house'), data: list.map(d => d.house_usd || 0), backgroundColor: colorForIndex(0) },
    { label: S('day.own'), data: list.map(d => d.own_usd || 0), backgroundColor: colorForIndex(1) },
  ];

  return html`
    <${Section} id="adm-us-03" title=${S('day.title')} count="03" description=${S('day.lead')}
      actions=${html`<${Action} onClick=${() => setNumbers(v => !v)} expanded=${numbers}>
        ${numbers ? S('day.showChart') : S('day.showNumbers')}
      <//>`}>
      ${!anything ? html`<${Empty} text=${S('day.empty')} />`
    : numbers ? html`
      <${Table} density="compact" label=${S('day.title')}
        headers=${[S('day.day'), S('day.house'), S('day.own')]}
        rows=${list.map(d => [html`<strong>${d.date}</strong>`, { text: usd(d.house_usd), align: 'end' }, { text: usd(d.own_usd), align: 'end' }])} />`
    : html`
      <${Stack}>
        <${Stack} direction="wrap" align="between">
          <${Text} kind="label">${S('day.chartTitle')}<//>
          <${Text} kind="mono" tone="muted">${S('day.axis', { n: usd(peak) })}<//>
        <//>
        <${UsageChart} labels=${list.map(d => String(d.date).slice(5))} datasets=${datasets} height=${180} yFormat=${usd} />
        <${Text} kind="caption" tone="muted">${S('day.note')}<//>
      <//>`}
    <//>`;
}
