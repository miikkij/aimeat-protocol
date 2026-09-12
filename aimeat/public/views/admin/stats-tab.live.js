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
 *   - DidItArrive (05) — email, push and mailbox as one table with a landing rate
 * @usage Imported by stats-tab.js.
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial (the Statistics page in the poster face).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, fmtUp, fmtBytes, Badge, Row } from './shared.js';
import { DELIVERY } from './stats-tab.data.js';

const S = (key, params) => t('admin.stats.' + key, params);

/** A day of waiting is the line where an uncollected mailbox stops being normal. */
const OLD_SECONDS = 86400;

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
    <section class="og-sec" id="adm-st-04">
      <div class="og-sec-h">
        <h2>${S('live.title')}<small>04</small></h2>
      </div>
      <p class="adm-st-lead">${S('live.lead')}</p>

      <div class="adm-st-two">
        <div>
          <div class="adm-st-lbl">${S('live.place')}</div>
          ${Row({ title: S('live.up'), why: S('live.upWhy'), chip: null, value: fmtUp(live.uptime_seconds || 0) })}
          ${Row({ title: S('live.people'), why: S('live.peopleWhy'), chip: null, value: num(live.active_owners || 0) })}
          ${Row({ title: S('live.agents'), why: S('live.agentsWhy'), chip: null, value: num(live.active_agents || 0) })}
          ${Row({
    title: S('live.cache'), why: S('live.cacheWhy'), chip: null, last: true,
    value: S('live.cacheValue', { entries: num(gauges.cache_entries || 0), dropped: num(gauges.cache_evictions_total || 0) }),
  })}
        </div>
        <div>
          <div class="adm-st-lbl">${S('live.waiting')}</div>
          ${Row({
    title: S('live.open'), why: S('live.openWhy'),
    chip: html`<${Badge} type=${open > 0 ? 'success' : 'muted'} label=${S('live.openChip', { n: num(open) })} />`,
    value: num(open),
  })}
          ${Row({
    title: S('live.held'), why: S('live.heldWhy'), chip: null,
    value: S('live.heldValue', { n: num(items), size: fmtBytes(bytes) }),
  })}
          ${Row({
    title: S('live.oldest'), why: S('live.oldestWhy'),
    chip: html`<${Badge} type=${oldest > OLD_SECONDS ? 'warning' : 'success'}
      label=${oldest > OLD_SECONDS ? S('live.oldestStale') : S('live.oldestFresh')} />`,
    value: items ? fmtUp(oldest) : '—',
  })}
          ${Row({
    title: S('live.delivery'), why: S('live.deliveryWhy'), chip: null, last: true,
    value: S('live.deliveryValue', {
      avg: (tunnel.delivery_latency_avg_ms || 0).toFixed(1),
      p95: (tunnel.delivery_latency_p95_ms || 0).toFixed(1),
    }),
  })}
        </div>
      </div>
    </section>`;
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
    <section class="og-sec" id="adm-st-05">
      <div class="og-sec-h">
        <h2>${S('arrive.title')}<small>05</small></h2>
      </div>
      <p class="adm-st-lead">${S('arrive.lead')}</p>

      ${anything ? html`
        <div class="adm-st-scroll">
          <table class="adm-st-tbl">
            <thead><tr>
              <th>${S('arrive.channel')}</th>
              <th>${S('arrive.what')}</th>
              <th class="num">${S('arrive.sent')}</th>
              <th class="num">${S('arrive.failed')}</th>
              <th class="num">${S('arrive.also')}</th>
              <th class="num">${S('arrive.rate')}</th>
            </tr></thead>
            <tbody>
              ${rows.map(r => html`
                <tr>
                  <td><b>${S('arrive.name.' + r.id)}</b></td>
                  <td>${S('arrive.for.' + r.id)}</td>
                  <td class="num">${num(r.sent)}</td>
                  <td class="num">${num(r.fail)}</td>
                  <td class="num">${S('arrive.alsoValue.' + r.id, { n: num(r.also) })}</td>
                  <td class="num ${r.rate !== null && r.rate < 95 ? 'adm-st-bad' : ''}">
                    ${r.rate === null ? '—' : r.rate.toFixed(1) + ' %'}
                  </td>
                </tr>`)}
            </tbody>
          </table>
        </div>
        <p class="adm-st-note">${worst < 100 ? S('arrive.noteSome', { rate: worst.toFixed(1) }) : S('arrive.noteAll')}</p>
      ` : html`<div class="adm-st-empty">${S('arrive.empty')}</div>`}
    </section>`;
}
