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
 *   axis, and a legend because there are two.
 * @structure
 *   - WhereItWent (02) — the models ranked, with the tail folded and the unpriced calls explained
 *   - ByDay (03) — one chart, two series, with a hover readout and the numbers behind a door
 * @usage Imported by views/admin/usage-tab.js.
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial (the Usage page in the poster face).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num } from './shared.js';

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
function ModelRow({ name, why, cost, calls, unpriced, share, widest, tail, last }) {
  const width = widest > 0 ? Math.max(2, Math.round((cost / widest) * 100)) : 0;
  return html`
    <div class="adm-us-brow ${last ? 'adm-us-brow--last' : ''}">
      <span>${tail ? html`<b>${name}</b>` : html`<span class="adm-us-mono">${name}</span>`}
        ${why ? html`<span class="adm-why">${why}</span>` : null}</span>
      <span class="adm-us-num adm-us-num--strong">${usd(cost)}</span>
      <span class="adm-us-num">${num(calls)}</span>
      <span class="adm-us-num">${unpriced ? num(unpriced) : '—'}</span>
      <span class="adm-us-bar">
        <i class=${tail ? 'adm-us-bar-fill adm-us-bar-fill--tail' : 'adm-us-bar-fill'}
           style=${`width:${width}%`}></i>
        <span>${pct(share)}%</span>
      </span>
    </div>`;
}

/** Section 02: where the money went. */
export function WhereItWent({ models }) {
  const rows = models?.rows || [];
  const other = models?.other || null;
  const unpriced = models?.unpriced || {};
  const widest = rows.length ? rows[0].cost_usd : 0;

  if (!rows.length) {
    return html`
      <section class="og-sec" id="adm-us-02">
        <div class="og-sec-h"><h2>${S('went.title')}<small>02</small></h2></div>
        <div class="adm-us-empty">${S('went.empty')}</div>
      </section>`;
  }

  return html`
    <section class="og-sec" id="adm-us-02">
      <div class="og-sec-h">
        <h2>${S('went.title')}<small>02</small></h2>
      </div>
      <p class="adm-us-lead">${S('went.lead', { n: rows.length })}</p>

      <div class="adm-us-brow adm-us-brow--head">
        <span>${S('went.model')}</span>
        <span class="adm-us-num">${S('went.cost')}</span>
        <span class="adm-us-num">${S('went.calls')}</span>
        <span class="adm-us-num">${S('went.noPrice')}</span>
        <span>${S('went.share')}</span>
      </div>

      ${rows.map((m, i) => html`<${ModelRow}
        name=${m.model}
        why=${m.providers?.length ? m.providers.join(' · ') : null}
        cost=${m.cost_usd} calls=${m.calls} unpriced=${m.unpriced_calls} share=${m.share}
        widest=${widest} last=${!other && i === rows.length - 1} />`)}

      ${other ? html`<${ModelRow}
        name=${S('went.otherTitle', { n: other.models })}
        why=${other.names.slice(0, 6).join(' · ')}
        cost=${other.cost_usd} calls=${other.calls} unpriced=${other.unpriced_calls}
        share=${other.share} widest=${widest} tail=${true} last=${true} />` : null}

      ${unpriced.calls
    ? html`<p class="adm-us-note">${
      unpriced.on_models_that_charge
        ? S('went.unpricedSome', {
          n: num(unpriced.calls),
          tail: num(unpriced.in_the_tail),
          missing: usd(unpriced.estimated_missing_usd),
        })
        : S('went.unpricedFree', { n: num(unpriced.calls), tail: num(unpriced.in_the_tail) })
    }</p>`
    : null}
    </section>`;
}

/** Section 03: one chart, two series, its own axis. */
export function ByDay({ days }) {
  const [hover, setHover] = useState(null);
  const [numbers, setNumbers] = useState(false);
  const list = days || [];
  const peak = list.reduce((m, d) => Math.max(m, d.house_usd + d.own_usd), 0);
  const anything = peak > 0;

  const reading = hover === null || !list[hover]
    ? S('day.axis', { n: usd(peak) })
    : S('day.reading', {
      day: list[hover].date,
      house: usd(list[hover].house_usd),
      own: usd(list[hover].own_usd),
    });

  const height = (v) => (!v || !peak ? 0 : Math.max(3, Math.round((v / peak) * 100)));

  return html`
    <section class="og-sec" id="adm-us-03">
      <div class="og-sec-h">
        <h2>${S('day.title')}<small>03</small></h2>
        <div class="og-doors">
          <button type="button" class="og-door og-door--quiet" onClick=${() => setNumbers(v => !v)}>
            ${numbers ? S('day.showChart') : S('day.showNumbers')}
          </button>
        </div>
      </div>
      <p class="adm-us-lead">${S('day.lead')}</p>

      ${!anything ? html`<div class="adm-us-empty">${S('day.empty')}</div>`
    : numbers ? html`
      <div class="adm-us-scroll">
        <table class="adm-us-tbl">
          <thead><tr>
            <th>${S('day.day')}</th>
            <th class="num">${S('day.house')}</th>
            <th class="num">${S('day.own')}</th>
          </tr></thead>
          <tbody>
            ${list.map(d => html`<tr>
              <td><b>${d.date}</b></td>
              <td class="num">${usd(d.house_usd)}</td>
              <td class="num">${usd(d.own_usd)}</td>
            </tr>`)}
          </tbody>
        </table>
      </div>`
    : html`
      <div class="adm-us-chart">
        <div class="adm-us-chart-h">
          <span class="adm-us-chart-t">${S('day.chartTitle')}</span>
          <span class="adm-us-legend">
            <span><i class="adm-us-key adm-us-key--house"></i>${S('day.house')}</span>
            <span><i class="adm-us-key adm-us-key--own"></i>${S('day.own')}</span>
          </span>
        </div>
        <span class="adm-us-yhint ${hover === null ? '' : 'adm-us-yhint--on'}">${reading}</span>
        <div class="adm-us-plot">
          ${list.map((d, i) => html`
            <div class="adm-us-day" onMouseEnter=${() => setHover(i)} onMouseLeave=${() => setHover(null)}>
              <div class="adm-us-pair">
                <i class="adm-us-bar-house" style=${`height:${height(d.house_usd)}%`}
                   title=${`${d.date} · ${S('day.house')} ${usd(d.house_usd)}`}></i>
                <i class="adm-us-bar-own" style=${`height:${height(d.own_usd)}%`}
                   title=${`${d.date} · ${S('day.own')} ${usd(d.own_usd)}`}></i>
              </div>
            </div>`)}
        </div>
        <div class="adm-us-xaxis">
          ${list.map(d => html`<span>${String(d.date).slice(5)}</span>`)}
        </div>
        <p class="adm-us-note">${S('day.note')}</p>
      </div>`}
    </section>`;
}
