/**
 * @file public/views/home/overview-band.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The home's Overview band (accepted canvas "Kokonaiskuva", board 2): five figures for
 *   the account read left to right (computers, agents, apps, knowledge, offerings), a line on what
 *   has gone quiet, and the way to the Overview page. The figures are the totals of GET /v1/overview,
 *   the same answer the page draws; the block asks with a small limit, because the band shows only
 *   the busiest name of two lanes.
 *
 *   NOTHING FOR AN EMPTY ACCOUNT. With no agent, computer or app the band renders nothing: an empty
 *   picture says nothing, and the guided steps stand where it would be.
 * @structure OverviewBand({ data, navigate })
 * @usage html`<${OverviewBand} data=${data} navigate=${navigate} />`
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (wish-kokonaiskuva-koneet-agentit-sovellukset-tieto-ja-tarjoukset-).
 */
import { h } from 'preact';
import htm from 'htm';
import { tOr } from '/js/i18n.js';
import { Band } from '/components/Band.js';
import { Loud } from '/components/Action.js';
import { HelpTip } from '/components/HelpTip.js';

const html = htm.bind(h);
const o = (key, fallback, vars) => tOr('home.overview.' + key, fallback, vars);
const PAGE = '/v1/home?overview=1';

/** The busiest item of a lane in a limited answer, or null. */
function busiest(items, lane) {
  const top = items.filter((i) => i.lane === lane && i.kind !== 'workspace' && i.use > 0).sort((a, b) => b.use - a.use)[0];
  return top ? top.name : null;
}

export function OverviewBand({ data, navigate }) {
  const t = data?.totals;
  if (!t || (t.agents === 0 && t.machines === 0 && t.apps === 0)) return null;
  const items = data.items || [];
  const columns = [
    { lane: 'machines', n: t.machines, a: o('block.machines', '{c} connected', { c: t.online }) },
    { lane: 'agents', n: t.agents, a: o('block.agents', '{u} at work', { u: t.used.agents }), b: busiest(items, 'agents') },
    { lane: 'apps', n: t.apps, a: o('block.apps', '{u} opened', { u: t.used.apps }), b: busiest(items, 'apps') },
    { lane: 'knowledge', n: t.organisms, a: o('block.knowledge', '{u} written to', { u: t.used.knowledge }) },
    { lane: 'offerings', n: t.offerings, a: o('block.offerings', '{u} used', { u: t.used.offerings }) },
  ];
  const go = (ev) => { ev.preventDefault(); navigate?.(PAGE); };
  const title = o('block.title', 'Overview');
  return html`
    <${Band} title=${html`${title} <${HelpTip} term="overview.model" label=${title} />`}>
      <div class="ovb">
        <p class="ovb-period">${o('block.period', 'last 7 days')}</p>
        <div class="ovb-grid">
          ${columns.map((c) => html`
            <div class="ovb-col" key=${c.lane}>
              <span class="poster-label">${o(`lane.${c.lane}`, c.lane)}</span>
              <span class="poster-stat-number ovb-num">${c.n}</span>
              <span class="ovb-line">${c.a}</span>
              ${t.quiet_by_lane[c.lane] ? html`<span class="ovb-line ovb-dim">${o('block.quiet', '{n} quiet', { n: t.quiet_by_lane[c.lane] })}</span>` : null}
              ${c.b ? html`<span class="ovb-line ovb-dim">${o('block.busiest', 'busiest: {name}', { name: c.b })}</span>` : null}
            </div>`)}
        </div>
        <div class="ovb-foot">
          <p>${t.quiet ? o('block.attention', '{n} things have been quiet for 30 days or more. You can tidy them away on the overview.', { n: t.quiet }) : o('block.allFine', 'Nothing has gone quiet.')}</p>
          <${Loud} href=${PAGE} onClick=${go}>${o('block.open', 'Open the overview')} →<//>
        </div>
      </div>
    <//>`;
}

export default OverviewBand;
