/**
 * @file stats-tab.live.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sections 04 and 05 of the Statistics page: what is true at this second, and whether
 *   what the node sent out arrived.
 *
 *   WHY 04 IS ITS OWN SECTION AND SAYS SO OUT LOUD. Uptime, owners, agents, open connections and
 *   the mailboxes are gauges: a reading taken now, not a count over a period. The old page put them
 *   in the same row of cards as the counters, under one period picker, so "7 days" appeared to
 *   govern "61 owners". It never did. Separating them is the fix, and the lead sentence saying they
 *   are not counted over anything is the other half of it — a reader should not have to infer which
 *   half of a row the control above reaches.
 * @structure
 *   - LiveNow (04) — the place itself, and the things waiting
 *   - Rate — a landed rate, in the danger colour when too little arrived
 *   - DidItArrive (05) — email, push and mailbox as one table with a landing rate
 * @usage Imported by stats-tab.js.
 * @version-history
 *   v2.0.0 — 2026-09-27 — Library components only: Section, Columns of Label and Readings, the
 *     delivery table as a List with its column names on a phone; no class written.
 *   v1.1.0 — 2026-09-13 — Compose existing section headings from shared poster B1.
 *   v1.0.0 — 2026-09-12 — Initial (the Statistics page in the poster face).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, fmtUp, fmtBytes, Badge } from './shared.js';
import { DELIVERY } from './stats-tab.data.js';
import { Section } from '/components/Section.js';
import { Readings } from '/components/Readings.js';
import { List, Row, Name, Desc, Num } from '/components/List.js';
import { Label } from '/components/Mark.js';
import { Tinted } from '/components/Figure.js';
import { Note } from '/components/Note.js';
import { EmptyState } from '/components/EmptyState.js';
import { Columns, Stack } from '/components/Layout.js';

const S = (key, params) => t('admin.stats.' + key, params);

/** A day of waiting is the line where an uncollected mailbox stops being normal. */
const OLD_SECONDS = 86400;

/** A landed rate under this reads as "not all of it arrived". */
const LANDED_WELL = 95;

/** How much of what was sent landed, or null when nothing was sent at all. */
function landed(sent, failed) {
  if (!sent && !failed) return null;
  return (sent / (sent + failed)) * 100;
}

/**
 * Section 04: the gauges, said plainly to be gauges.
 *
 * `live` is the CURRENT read, not the dashboard shell's one-time fetch. Every gauge here rides
 * along on the ranged response unchanged, which is what lets this section refresh with the rest of
 * the page while owing nothing to the period picker. Reading the shell's copy instead would freeze
 * uptime at whatever it was when the tab opened, on a section whose first sentence promises the
 * opposite.
 */
export function LiveNow({ live, gauges }) {
  const tunnel = live.tunnel || {};
  const mailbox = live.mailbox || {};
  const open = gauges.tunnel_connections_active ?? tunnel.connections_active ?? 0;
  const items = gauges.mailbox_items_total ?? mailbox.items_total ?? 0;
  const bytes = gauges.mailbox_bytes_total ?? mailbox.bytes_total ?? 0;
  const oldest = gauges.mailbox_oldest_item_age_seconds ?? mailbox.oldest_item_age_seconds ?? 0;

  return html`
    <${Section} id="adm-st-04" num="04" title=${S('live.title')}>
      <${Note} kind="lead">${S('live.lead')}<//>

      <${Columns}>
        <${Stack} gap="none">
          <${Label} block>${S('live.place')}<//>
          <${Readings} rows=${[
    { key: 'up', name: S('live.up'), why: S('live.upWhy'), mark: null, value: fmtUp(live.uptime_seconds || 0) },
    { key: 'people', name: S('live.people'), why: S('live.peopleWhy'), mark: null, value: num(live.active_owners || 0) },
    { key: 'agents', name: S('live.agents'), why: S('live.agentsWhy'), mark: null, value: num(live.active_agents || 0) },
    {
      key: 'cache', name: S('live.cache'), why: S('live.cacheWhy'), mark: null, last: true,
      value: S('live.cacheValue', { entries: num(gauges.cache_entries || 0), dropped: num(gauges.cache_evictions_total || 0) }),
    },
  ]} />
        <//>
        <${Stack} gap="none">
          <${Label} block>${S('live.waiting')}<//>
          <${Readings} rows=${[
    {
      key: 'open', name: S('live.open'), why: S('live.openWhy'),
      mark: html`<${Badge} type=${open > 0 ? 'success' : 'muted'} label=${S('live.openChip', { n: num(open) })} />`,
      value: num(open),
    },
    {
      key: 'held', name: S('live.held'), why: S('live.heldWhy'), mark: null,
      value: S('live.heldValue', { n: num(items), size: fmtBytes(bytes) }),
    },
    {
      key: 'oldest', name: S('live.oldest'), why: S('live.oldestWhy'),
      mark: html`<${Badge} type=${oldest > OLD_SECONDS ? 'warning' : 'success'}
        label=${oldest > OLD_SECONDS ? S('live.oldestStale') : S('live.oldestFresh')} />`,
      value: items ? fmtUp(oldest) : '—',
    },
    {
      key: 'delivery', name: S('live.delivery'), why: S('live.deliveryWhy'), mark: null, last: true,
      value: S('live.deliveryValue', {
        avg: (tunnel.delivery_latency_avg_ms || 0).toFixed(1),
        p95: (tunnel.delivery_latency_p95_ms || 0).toFixed(1),
      }),
    },
  ]} />
        <//>
      <//>
    <//>`;
}

/** A landed rate: a dash when nothing was sent, the danger colour when too little arrived. */
function Rate({ rate }) {
  if (rate === null) return '—';
  const words = rate.toFixed(1) + ' %';
  return rate < LANDED_WELL ? html`<${Tinted} tone="danger" strong>${words}<//>` : words;
}

/** Section 05: everything sent out in the period, and how much of it landed. */
export function DidItArrive({ period }) {
  const rows = DELIVERY.map(c => {
    const sent = Number(period?.[c.sent] ?? 0);
    const fail = Number(period?.[c.fail] ?? 0);
    const also = Number(period?.[c.also] ?? 0);
    return { ...c, sent, fail, also, rate: landed(sent, fail) };
  });
  const anything = rows.some(r => r.sent || r.fail);
  const worst = rows.reduce((m, r) => (r.rate !== null && r.rate < m ? r.rate : m), 100);

  return html`
    <${Section} id="adm-st-05" num="05" title=${S('arrive.title')}>
      <${Note} kind="lead">${S('arrive.lead')}<//>

      ${anything ? html`
        <${List} cols="name-desc-n-n-n-n" labels head=${[
    S('arrive.channel'), S('arrive.what'),
    { label: S('arrive.sent'), num: true }, { label: S('arrive.failed'), num: true },
    { label: S('arrive.also'), num: true }, { label: S('arrive.rate'), num: true },
  ]}>
          ${rows.map(r => html`
            <${Row} key=${r.id}>
              <${Name}>${S('arrive.name.' + r.id)}<//>
              <${Desc}>${S('arrive.for.' + r.id)}<//>
              <${Num}>${num(r.sent)}<//>
              <${Num}>${num(r.fail)}<//>
              <${Num}>${S('arrive.alsoValue.' + r.id, { n: num(r.also) })}<//>
              <${Num}><${Rate} rate=${r.rate} /><//>
            <//>`)}
        <//>
        <${Note}>${worst < 100 ? S('arrive.noteSome', { rate: worst.toFixed(1) }) : S('arrive.noteAll')}<//>
      ` : html`<${EmptyState} text=${S('arrive.empty')} />`}
    <//>`;
}
