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
 *   2026-09-22 -- Composed from the shared component set (Section, Columns, NumeralBand, Table,
 *     Meter, Surface): no page sheet and no class of its own, so a theme change reaches it.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v2.1.0 — 2026-09-13 — Compose the remaining B1 headings; fleet ratios use SVG width data.
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
import { t } from '/js/i18n.js';
import { num, Empty, Badge, Row, shortDate } from './shared.js';
import { Section, Columns, Stack, NumeralBand, Table, Meter, Surface, Action, Text } from '/components/poster-parts.js';
import { getAgentDetail } from '/js/services/admin.js';
import { swallowed } from '/js/swallowed.js';
import {
  countAgents, inFilter, matches, sortAgents, byOwner, trustText,
} from './agents-tab.derive.js';
import AgentsList, { PAGE } from './agents-tab.list.js';

const A = (key, params) => t('dashboard.agentsTab.' + key, params);

/** Section 01: the word, the sentence, the machine line, the four rows and the strip. */
function RightNow({ counts, fleets, nodeId, owners, onOwners }) {
  const share = counts.total ? Math.round((counts.awake / counts.total) * 100) : 0;
  const fleetShare = counts.total && fleets.biggest
    ? Math.round((fleets.biggest.count / counts.total) * 100)
    : 0;
  return html`
    <${Section} title=${A('nowTitle')} count="01"
      actions=${html`<${Action} onClick=${onOwners}>${A('toOwners')}<//>`}>
      <${Stack}>
        <${Columns} collapse=${900}>
          <${Stack} density="compact">
            <${Text} kind="heading">${A('awakeWord', { n: num(counts.awake) })}<//>
            <${Text}>${A('nowLine', { awake: num(counts.awake), silent: num(counts.silent) })}<//>
            <${Text} kind="mono" tone="muted">${nodeId}<//>
            <${Text} kind="mono" tone="muted">${A('nowMeta', {
    total: num(counts.total), owners: num(fleets.owners), registered: num(owners),
  })}<//>
          <//>
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
            <${Row} title=${A('rowLow')} why=${A('rowLowWhy')}
              chip=${html`<${Badge} type=${counts.low ? 'warning' : 'muted'} label=${num(counts.low)} />`}
              value=${counts.lowest !== null ? A('valLowest', { score: trustText(counts.lowest) }) : ''} />
          </div>
        <//>
        <${NumeralBand} tone="plain" items=${[
    { label: A('stripAgents'), value: num(counts.total), note: A('stripAgentsSub') },
    { label: A('stripAwake'), value: num(counts.awake), note: A('stripAwakeSub') },
    { label: A('stripSilent'), value: num(counts.silent), note: A('stripSilentSub'), tone: 'coral' },
    { label: A('stripFleet'), value: num(fleets.biggest?.count ?? 0),
      note: fleets.biggest ? A('stripFleetSub', { owner: fleets.biggest.owner, pct: fleetShare }) : '' },
  ]} />
      <//>
    <//>`;
}

/** Section 03: who holds what. The bar is the owner's share of the whole node. */
function Fleets({ fleets, total, onOwners }) {
  const pct = n => (total ? Math.round((n / total) * 100) : 0);
  const bar = n => html`<${Meter} kind="progress" value=${pct(n)} label=${A('colShare')} />`;
  const open = html`<${Action} kind="text" onClick=${onOwners}>${A('open')}<//>`;
  const rows = fleets.top.map(o => [
    html`<strong>${o.owner}</strong>`,
    html`<${Text} kind="number" size="small" tone=${o.count === fleets.biggest.count ? 'coral' : 'plain'}>${num(o.count)}<//>`,
    html`<${Text} kind="mono">${num(o.awake)}<//>`,
    bar(o.count),
    open,
  ]);
  if (fleets.rest) {
    rows.push([
      html`<${Stack} density="compact"><strong>${A('restOwners', { n: num(fleets.rest.owners) })}</strong>
        <${Text} kind="caption" tone="muted">${A('restWhy', { most: num(fleets.rest.most) })}<//><//>`,
      html`<${Text} kind="number" size="small">${num(fleets.rest.count)}<//>`,
      html`<${Text} kind="mono">${num(fleets.rest.awake)}<//>`,
      bar(fleets.rest.count),
      open,
    ]);
  }
  return html`
    <${Section} title=${A('fleetsTitle')} count="03"
      actions=${html`<${Action} onClick=${onOwners}>${A('toOwners')}<//>`}
      description=${fleets.biggest
    ? A('fleetsLead', { pct: pct(fleets.biggest.count), owners: num(fleets.owners) })
    : ''}>
      <${Table} density="compact" collapse=${600} label=${A('fleetsTitle')}
        headers=${[A('colOwner'), A('colAgents'), A('colAwake'), A('colShare'), '']} rows=${rows} />
    <//>`;
}

export default function AgentsTab({ data, switchPage }) {
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
    <${Stack}>
      <${RightNow} counts=${counts} fleets=${fleets} nodeId=${data.dash?.node_id || ''}
        owners=${data.dash?.counts?.owners ?? fleets.owners} onOwners=${toOwners} />

      <${AgentsList} rows=${rows} total=${counts.total} counts=${counts} now=${now}
        filter=${filter} onFilter=${pick} query=${query} onQuery=${type}
        limit=${limit} onMore=${() => setLimit(l => l + PAGE)}
        openGaii=${openGaii} onToggle=${toggle} detail=${detail} detailLoading=${detailLoading}
        onOwner=${toOwners} onOrigins=${toCors} />

      <${Fleets} fleets=${fleets} total=${counts.total} onOwners=${toOwners} />

      <${Surface} kind="aside" density="compact">
        <${Text}><strong>${A('asideLead')}</strong> ${A('aside', { n: num(counts.silent) })}<//>
      <//>
      <${Text} kind="caption" tone="muted">${A('asideNote')}<//>
    <//>`;
}
