/**
 * @file usage-tab.people.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sections 04 and 05 of the Usage page: who spent the money, and what was actually
 *   called.
 *
 *   THEY ARE NOT THE SAME QUESTION and they are never summed. 04 counts money through the LLM
 *   ledger; 05 counts INVOCATIONS through the usage-telemetry stream, including the ones this node
 *   declined. A refusal is the fence working and an error is the node failing, so they keep separate
 *   columns — one number covering both is useless for either.
 *
 *   05 REPLACES THREE TABLES WITH TWO COLUMNS. The old section listed every surface, the top fifty
 *   tools and the top fifty apps, which is a lot of rows for a question that is usually "is anything
 *   being turned away, and is that a problem". The surfaces answer the first; the most-refused tools
 *   answer the second, because a refusal concentrated on one tool is a permission somebody has not
 *   been granted rather than an attack. The full lists stay a door away.
 * @structure
 *   - WhoSpent (04) — people and their agents, with a column saying whose key paid
 *   - WhatWasCalled (05) — the surfaces, and what was refused
 * @usage Imported by views/admin/usage-tab.js.
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial (the Usage page in the poster face).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, Badge, Row } from './shared.js';
import { usd, compact } from './usage-tab.models.js';

const S = (key, params) => t('admin.usage.' + key, params);

/** How many people get a row before the rest fold into one. */
const TOP_PEOPLE = 6;

/** A percentage that stays honest at small n: nothing called is a dash, never 0 %. */
function rate(part, whole) {
  const w = Number(whole) || 0;
  if (w === 0) return '—';
  return Math.round(((Number(part) || 0) / w) * 100) + '%';
}

function ms(n) {
  const v = Number(n) || 0;
  return v >= 1000 ? (v / 1000).toFixed(1) + ' s' : Math.round(v) + ' ms';
}

/** Section 04: who spent it. */
export function WhoSpent({ people, houseSpenders }) {
  const [all, setAll] = useState(false);
  const list = people || [];
  if (!list.length) {
    return html`
      <section class="og-sec" id="adm-us-04">
        <div class="og-sec-h"><h2>${S('who.title')}<small>04</small></h2></div>
        <div class="adm-us-empty">${S('who.empty')}</div>
      </section>`;
  }

  const shown = all ? list : list.slice(0, TOP_PEOPLE);
  const rest = all ? [] : list.slice(TOP_PEOPLE);
  const tail = rest.length
    ? {
      people: rest.length,
      agents: rest.reduce((a, u) => a + (u.agents || 0), 0),
      cost_usd: rest.reduce((a, u) => a + (u.cost_usd || 0), 0),
      total_tokens: rest.reduce((a, u) => a + (u.total_tokens || 0), 0),
      calls: rest.reduce((a, u) => a + (u.calls || 0), 0),
      unpriced_calls: rest.reduce((a, u) => a + (u.unpriced_calls || 0), 0),
    }
    : null;

  // A person is on the house key when the house read saw them spend on it. Everyone else brought
  // their own, which is the ordinary case and the one that costs the operator nothing.
  const onHouse = new Set((houseSpenders || []).map(u => u.owner_ghii));

  return html`
    <section class="og-sec" id="adm-us-04">
      <div class="og-sec-h">
        <h2>${S('who.title')}<small>04</small></h2>
        ${rest.length ? html`<div class="og-doors">
          <button type="button" class="og-door og-door--quiet" onClick=${() => setAll(true)}>
            ${S('who.showAll', { n: list.length })}
          </button>
        </div>` : null}
      </div>
      <p class="adm-us-lead">${S('who.lead')}</p>
      <div class="adm-us-scroll">
        <table class="adm-us-tbl">
          <thead><tr>
            <th>${S('who.person')}</th>
            <th class="num">${S('who.agents')}</th>
            <th class="num">${S('went.cost')}</th>
            <th class="num">${S('who.tokens')}</th>
            <th class="num">${S('went.calls')}</th>
            <th class="num">${S('went.noPrice')}</th>
            <th>${S('who.whoseKey')}</th>
          </tr></thead>
          <tbody>
            ${shown.map(u => html`<tr>
              <td><b>${u.owner_ghii}</b></td>
              <td class="num">${num(u.agents || 0)}</td>
              <td class="num">${usd(u.cost_usd)}</td>
              <td class="num">${compact(u.total_tokens)}</td>
              <td class="num">${num(u.calls || 0)}</td>
              <td class="num">${u.unpriced_calls ? num(u.unpriced_calls) : '—'}</td>
              <td>${onHouse.has(u.owner_ghii)
    ? html`<${Badge} type="warning" label=${S('who.house')} />`
    : html`<${Badge} type="info" label=${S('who.own')} />`}</td>
            </tr>`)}
            ${tail ? html`<tr>
              <td><b>${S('who.othersTitle', { n: tail.people })}</b></td>
              <td class="num">${num(tail.agents)}</td>
              <td class="num">${usd(tail.cost_usd)}</td>
              <td class="num">${compact(tail.total_tokens)}</td>
              <td class="num">${num(tail.calls)}</td>
              <td class="num">${tail.unpriced_calls ? num(tail.unpriced_calls) : '—'}</td>
              <td></td>
            </tr>` : null}
          </tbody>
        </table>
      </div>
      <p class="adm-us-note">${onHouse.size
    ? S('who.noteHouse', { n: onHouse.size })
    : S('who.noteAllOwn')}</p>
    </section>`;
}

/** Section 05: what was called, and what was turned away. */
export function WhatWasCalled({ calls }) {
  const surface = calls?.surface;
  const tool = calls?.tool;
  const totals = surface?.totals;

  if (!totals || (totals.calls || 0) === 0) {
    return html`
      <section class="og-sec" id="adm-us-05">
        <div class="og-sec-h"><h2>${S('called.title')}<small>05</small></h2></div>
        <div class="adm-us-empty">${S('called.empty')}</div>
      </section>`;
  }

  const surfaces = (surface.groups || []).slice(0, 6);
  // The tools that were REFUSED most, not the ones called most: a refusal concentrated on one tool
  // is a person missing one permission word, which is a thing the operator can fix today.
  const refused = (tool?.groups || [])
    .filter(g => (g.refusals || 0) > 0)
    .sort((a, b) => (b.refusals || 0) - (a.refusals || 0))
    .slice(0, 3);
  const slowest = (tool?.groups || [])
    .reduce((m, g) => ((g.duration_ms_max || 0) > (m?.duration_ms_max || 0) ? g : m), null);

  return html`
    <section class="og-sec" id="adm-us-05">
      <div class="og-sec-h">
        <h2>${S('called.title')}<small>05</small></h2>
      </div>
      <p class="adm-us-lead">${S('called.lead')}</p>

      <div class="adm-us-two">
        <div>
          <div class="adm-us-lbl">${S('called.byWayIn')}</div>
          ${surfaces.map((g, i) => Row({
    title: g.key,
    why: S('called.surfaceWhy', { errors: num(g.errors || 0) }),
    chip: (g.refusals || 0) > 0
      ? html`<${Badge} type="warning" label=${S('called.refusedN', { n: num(g.refusals) })} />`
      : html`<${Badge} type="success" label=${S('called.refusedNone')} />`,
    value: S('called.callsAndRate', { n: num(g.calls || 0), rate: rate(g.refusals, g.calls) }),
    last: i === surfaces.length - 1,
  }))}
        </div>
        <div>
          <div class="adm-us-lbl">${S('called.mostRefused')}</div>
          ${refused.length ? refused.map(g => Row({
    title: g.key,
    why: S('called.refusedWhy'),
    chip: html`<${Badge} type="warning" label=${num(g.refusals)} />`,
    value: g.dims?.surface || '',
  })) : Row({
    title: S('called.nothingRefused'),
    why: S('called.nothingRefusedWhy'),
    chip: html`<${Badge} type="success" label=${S('called.refusedNone')} />`,
    value: '',
  })}
          ${slowest ? Row({
    title: S('called.slowest'),
    why: S('called.slowestWhy'),
    chip: html`<${Badge} type="muted" label=${ms(slowest.duration_ms_max)} />`,
    value: slowest.key,
    last: true,
  }) : null}
        </div>
      </div>
    </section>`;
}
