/**
 * @file public/views/admin/agents-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin Agents page in the poster face (design canvas "AIMEAT Admin Agents"). Three
 *   numbered sections in the order an operator asks: how many agents are awake and how many have
 *   been left running with their permissions, then every agent behind a search and five filter
 *   chips that carry the counts, then whose they are, because one person can hold half the node.
 *
 *   What changed against the table this replaces: a search, a sort and five filters where there
 *   were none; what an agent MAY DO on the screen for the first time (the scopes have come back
 *   with this read since 2026-08-18 and no surface showed them); the morsel column gone, because
 *   the balance belongs to the owner and was being repeated on every row of that owner; and the
 *   trust column dimmed at 50.0, the figure an agent is registered with, which only changes when
 *   somebody opens its profile and the route recomputes it.
 *
 * @structure
 *   - AgentsTab({ data, switchPage }) — the sections, the derived counts, the opened record
 *   - RightNow: section 01, the status word, the four metric rows and the numeral strip
 *   - Fleets: section 03, the owners by how many agents they hold
 *   - agents-tab.derive.js does the counting, .list.js is section 02, .record.js is an opened row
 *
 * @version-history
 *   v2.0.0 — 2026-09-12 — The poster face: one table of 143 unsearchable rows becomes three
 *     sections, a search, five filter chips and a record that says what an agent may do and where
 *     it may be called from. The morsel column is gone and the trust column is read rather than
 *     printed.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { num, Empty, Badge, Row } from './shared.js';
import { getAgentDetail } from '/js/services/admin.js';
import { swallowed } from '/js/swallowed.js';
import {
  countAgents, inFilter, matches, sortAgents, byOwner, trustText,
} from './agents-tab.derive.js';
import AgentsList, { PAGE } from './agents-tab.list.js';
import { shortDate } from './agents-tab.record.js';

const A = (key, params) => t('dashboard.agentsTab.' + key, params);

/** Section 01: the word, the sentence, the machine line, the four rows and the strip. */
function RightNow({ counts, fleets, nodeId, owners, onOwners }) {
  const share = counts.total ? Math.round((counts.awake / counts.total) * 100) : 0;
  const fleetShare = counts.total && fleets.biggest
    ? Math.round((fleets.biggest.count / counts.total) * 100)
    : 0;
  return html`
    <section class="og-sec og-sec--first">
      <div class="og-sec-h">
        <h2>${A('nowTitle')}<small>01</small></h2>
        <div class="og-doors">
          <button type="button" class="og-door og-door--quiet" onClick=${onOwners}>${A('toOwners')}</button>
        </div>
      </div>
      <div class="adm-ov-grid">
        <div>
          <div class="adm-ov-status">${A('awakeWord', { n: num(counts.awake) })}</div>
          <p class="adm-alert-line">${A('nowLine', { awake: num(counts.awake), silent: num(counts.silent) })}</p>
          <div class="adm-ov-up">${nodeId}<br />${A('nowMeta', {
    total: num(counts.total), owners: num(fleets.owners), registered: num(owners),
  })}</div>
        </div>
        <div>
          <${Row} title=${A('rowAwake')} why=${A('rowAwakeWhy')}
            chip=${html`<${Badge} type="healthy" label=${num(counts.awake)} />`}
            value=${A('valShare', { pct: share })} />
          <${Row} title=${A('rowSilent')} why=${A('rowSilentWhy')}
            chip=${html`<${Badge} type=${counts.silent ? 'warning' : 'muted'} label=${num(counts.silent)} />`}
            value=${counts.oldestSilent ? A('valOldest', { date: shortDate(counts.oldestSilent) }) : ''} />
          <${Row} title=${A('rowNode')} why=${A('rowNodeWhy')}
            chip=${html`<${Badge} type="muted" label=${num(counts.nodeMade)} />`}
            value=${A('valSplit', { app: num(counts.app), chat: num(counts.chat) })} />
          <${Row} title=${A('rowLow')} why=${A('rowLowWhy')} last=${true}
            chip=${html`<${Badge} type=${counts.low ? 'warning' : 'muted'} label=${num(counts.low)} />`}
            value=${counts.lowest !== null ? A('valLowest', { score: trustText(counts.lowest, getLocale()) }) : ''} />
        </div>
      </div>
      <div class="og-strip">
        <div><b>${num(counts.total)}</b><span>${A('stripAgents')}</span><small>${A('stripAgentsSub')}</small></div>
        <div><b>${num(counts.awake)}</b><span>${A('stripAwake')}</span><small>${A('stripAwakeSub')}</small></div>
        <div><b class="og-coral-num">${num(counts.silent)}</b><span>${A('stripSilent')}</span><small>${A('stripSilentSub')}</small></div>
        <div><b>${num(fleets.biggest?.count ?? 0)}</b><span>${A('stripFleet')}</span>
          <small>${fleets.biggest ? A('stripFleetSub', { owner: fleets.biggest.owner, pct: fleetShare }) : ''}</small></div>
      </div>
    </section>`;
}

/** Section 03: who holds what. The bar is the owner's share of the whole node. */
function Fleets({ fleets, total, onOwners }) {
  const pct = n => (total ? Math.round((n / total) * 100) : 0);
  const bar = n => html`<div class="adm-ag-bar"><i style=${`width: ${pct(n)}%`}></i></div>`;
  return html`
    <section class="og-sec">
      <div class="og-sec-h">
        <h2>${A('fleetsTitle')}<small>03</small></h2>
        <div class="og-doors">
          <button type="button" class="og-door og-door--quiet" onClick=${onOwners}>${A('toOwners')}</button>
        </div>
      </div>
      <p class="adm-ag-lead">${fleets.biggest
    ? A('fleetsLead', { pct: pct(fleets.biggest.count), owners: num(fleets.owners) })
    : ''}</p>
      <div class="adm-ag-orow adm-ag-orow--head">
        <div>${A('colOwner')}</div><div>${A('colAgents')}</div><div>${A('colAwake')}</div>
        <div class="adm-ag-c-share">${A('colShare')}</div><div></div>
      </div>
      ${fleets.top.map(o => html`
        <div class="adm-ag-orow">
          <div class="adm-ag-onm">${o.owner}</div>
          <div><span class="adm-ag-onum ${o.count === fleets.biggest.count ? 'adm-ag-onum--coral' : ''}">${num(o.count)}</span></div>
          <div><span class="adm-ag-osm">${num(o.awake)}</span></div>
          ${bar(o.count)}
          <div class="adm-ag-go"><button type="button" class="og-door og-door--quiet" onClick=${onOwners}>${A('open')}</button></div>
        </div>`)}
      ${fleets.rest && html`
        <div class="adm-ag-orow">
          <div class="adm-ag-onm">${A('restOwners', { n: num(fleets.rest.owners) })}<small>${A('restWhy', { most: num(fleets.rest.most) })}</small></div>
          <div><span class="adm-ag-onum">${num(fleets.rest.count)}</span></div>
          <div><span class="adm-ag-osm">${num(fleets.rest.awake)}</span></div>
          ${bar(fleets.rest.count)}
          <div class="adm-ag-go"><button type="button" class="og-door og-door--quiet" onClick=${onOwners}>${A('open')}</button></div>
        </div>`}
    </section>`;
}

export default function AgentsTab({ data, switchPage }) {
  useViewCSS('/css/views/admin-agents.css');
  // Hooks run unconditionally before any early return (Rules of Hooks).
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [openGaii, setOpenGaii] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  /** Opening a record reads GET /v1/agents/:gaii, which recomputes the trust score and stores it. */
  const toggle = useCallback(async (gaii) => {
    if (openGaii === gaii) { setOpenGaii(null); setDetail(null); return; }
    setOpenGaii(gaii);
    setDetail(null);
    setDetailLoading(true);
    try {
      const r = await getAgentDetail(gaii);
      setDetail(r.data);
    } catch (err) {
      swallowed('agents-tab: agent detail', err);
    } finally {
      setDetailLoading(false);
    }
  }, [openGaii]);

  const pick = useCallback((next) => { setFilter(next); setLimit(PAGE); }, []);
  const type = useCallback((next) => { setQuery(next); setLimit(PAGE); }, []);
  const toOwners = useCallback(() => switchPage('owners'), [switchPage]);
  const toCors = useCallback(() => switchPage('cors'), [switchPage]);

  const agents = data.agents?.agents ?? [];
  if (!agents.length) return html`<${Empty} text=${t('dashboard.noAgentsRegistered')} />`;

  const now = Date.now();
  const counts = countAgents(agents, now);
  const fleets = byOwner(agents, now);
  const rows = sortAgents(
    agents.filter(a => inFilter(a, filter, now) && matches(a, query)),
    filter === 'silent',
  );

  return html`
    <div class="og adm-ag">
      <${RightNow} counts=${counts} fleets=${fleets} nodeId=${data.dash?.node_id || ''}
        owners=${data.dash?.counts?.owners ?? fleets.owners} onOwners=${toOwners} />

      <${AgentsList} rows=${rows} total=${counts.total} counts=${counts} now=${now}
        filter=${filter} onFilter=${pick} query=${query} onQuery=${type}
        limit=${limit} onMore=${() => setLimit(l => l + PAGE)}
        openGaii=${openGaii} onToggle=${toggle} detail=${detail} detailLoading=${detailLoading}
        onOwner=${toOwners} onOrigins=${toCors} />

      <${Fleets} fleets=${fleets} total=${counts.total} onOwners=${toOwners} />

      <div class="og-box">
        <b>${A('asideLead')}</b> ${A('aside', { n: num(counts.silent) })}
      </div>
      <p class="adm-ag-note">${A('asideNote')}</p>
    </div>`;
}
