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
 *   v2.0.0 — 2026-09-27 — Library components only: the people are a List with their column names on
 *     a phone, the call stream Columns of Label and Readings; no class written.
 *   v1.1.0 — 2026-09-13 — Compose existing section headings from shared poster B1.
 *   v1.0.0 — 2026-09-12 — Initial (the Usage page in the poster face).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, Badge } from './shared.js';
import { usd, compact } from './usage-tab.models.js';
import { Section } from '/components/Section.js';
import { Readings } from '/components/Readings.js';
import { List, Row, Name, Num, Cell } from '/components/List.js';
import { Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Action } from '/components/Action.js';
import { EmptyState } from '/components/EmptyState.js';
import { Columns, Stack } from '/components/Layout.js';

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
      <${Section} id="adm-us-04" num="04" title=${S('who.title')}>
        <${EmptyState} text=${S('who.empty')} />
      <//>`;
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
    <${Section} id="adm-us-04" num="04" title=${S('who.title')}
      doors=${rest.length ? html`<${Action} small soft onClick=${() => setAll(true)}>${S('who.showAll', { n: list.length })}<//>` : null}>
      <${Note} kind="lead">${S('who.lead')}<//>
      <${List} cols="name-n-n-n-n-n-state" labels head=${[
    S('who.person'),
    { label: S('who.agents'), num: true },
    { label: S('went.cost'), num: true },
    { label: S('who.tokens'), num: true },
    { label: S('went.calls'), num: true },
    { label: S('went.noPrice'), num: true },
    S('who.whoseKey'),
  ]}>
        ${shown.map(u => html`<${Row} key=${u.owner_ghii}>
          <${Name}>${u.owner_ghii}<//>
          <${Num}>${num(u.agents || 0)}<//>
          <${Num}>${usd(u.cost_usd)}<//>
          <${Num}>${compact(u.total_tokens)}<//>
          <${Num}>${num(u.calls || 0)}<//>
          <${Num}>${u.unpriced_calls ? num(u.unpriced_calls) : '—'}<//>
          <${Cell}>${onHouse.has(u.owner_ghii)
    ? html`<${Badge} type="warning" label=${S('who.house')} />`
    : html`<${Badge} type="info" label=${S('who.own')} />`}<//>
        <//>`)}
        ${tail ? html`<${Row} key="others">
          <${Name}>${S('who.othersTitle', { n: tail.people })}<//>
          <${Num}>${num(tail.agents)}<//>
          <${Num}>${usd(tail.cost_usd)}<//>
          <${Num}>${compact(tail.total_tokens)}<//>
          <${Num}>${num(tail.calls)}<//>
          <${Num}>${tail.unpriced_calls ? num(tail.unpriced_calls) : '—'}<//>
          <${Cell} />
        <//>` : null}
      <//>
      <${Note}>${onHouse.size
    ? S('who.noteHouse', { n: onHouse.size })
    : S('who.noteAllOwn')}<//>
    <//>`;
}

/** Section 05: what was called, and what was turned away. */
export function WhatWasCalled({ calls }) {
  const surface = calls?.surface;
  const tool = calls?.tool;
  const totals = surface?.totals;

  if (!totals || (totals.calls || 0) === 0) {
    return html`
      <${Section} id="adm-us-05" num="05" title=${S('called.title')}>
        <${EmptyState} text=${S('called.empty')} />
      <//>`;
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
    <${Section} id="adm-us-05" num="05" title=${S('called.title')}>
      <${Note} kind="lead">${S('called.lead')}<//>

      <${Columns}>
        <${Stack} gap="none">
          <${Label} block>${S('called.byWayIn')}<//>
          <${Readings} rows=${surfaces.map((g, i) => ({
    key: g.key,
    name: g.key,
    why: S('called.surfaceWhy', { errors: num(g.errors || 0) }),
    mark: (g.refusals || 0) > 0
      ? html`<${Badge} type="warning" label=${S('called.refusedN', { n: num(g.refusals) })} />`
      : html`<${Badge} type="success" label=${S('called.refusedNone')} />`,
    value: S('called.callsAndRate', { n: num(g.calls || 0), rate: rate(g.refusals, g.calls) }),
    last: i === surfaces.length - 1,
  }))} />
        <//>
        <${Stack} gap="none">
          <${Label} block>${S('called.mostRefused')}<//>
          <${Readings} rows=${[
    ...(refused.length ? refused.map(g => ({
      key: g.key,
      name: g.key,
      why: S('called.refusedWhy'),
      mark: html`<${Badge} type="warning" label=${num(g.refusals)} />`,
      value: g.dims?.surface || '',
    })) : [{
      key: 'none',
      name: S('called.nothingRefused'),
      why: S('called.nothingRefusedWhy'),
      mark: html`<${Badge} type="success" label=${S('called.refusedNone')} />`,
      value: '',
    }]),
    slowest ? {
      key: 'slowest',
      name: S('called.slowest'),
      why: S('called.slowestWhy'),
      mark: html`<${Badge} type="muted" label=${ms(slowest.duration_ms_max)} />`,
      value: slowest.key,
      last: true,
    } : null,
  ]} />
        <//>
      <//>
    <//>`;
}
