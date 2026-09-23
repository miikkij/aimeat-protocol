/**
 * @file public/views/admin/owners-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin Owners page in the poster face (design canvas "AIMEAT Admin Owners"). Three
 *   sections in the order an operator asks: who can act as operator, every owner, and what the two
 *   acts cost. The four writes go through the same routes as before.
 *
 *   THE ROLE COLUMN IS GONE. Every one of the sixty-one rows said "owner", so the name cell now
 *   carries only the exception — the operator chip, the deactivation stamp, the directory that
 *   manages the account.
 *
 *   THE DOORS OF A ROW SIT BEHIND THAT ROW'S MENU. The page used to paint two buttons on every row,
 *   a hundred and twenty-two of them, the destructive one no louder than the other. One menu per
 *   row holds them, the same gesture on a pointer, a keyboard and a phone.
 *
 *   A DOOR IS ABSENT WHERE THE NODE WOULD REFUSE IT: see owners-tab.model.js.
 *
 * @structure
 *   - OwnersTab({ data, session, reload, switchPage }) — the three sections
 *   - ownerCells — one row of the list: the numeral, the name with its chips, the agents, the day, the menu
 *   - askGrant / askRevoke / askDisable / askEnable — the question each act asks first
 *
 * @version-history
 *   2026-09-22 -- Composed from the shared component set (Section, NumeralBand, Toolbar, Table,
 *     Menu, Surface): no page sheet and no class of its own, so a theme change reaches it. The
 *     list is the shared table and each row's doors sit behind its menu instead of appearing on hover.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v2.1.0 — 2026-09-13 — Compose section headings from the shared poster B1 shape.
 *   v2.0.0 — 2026-09-12 — The poster face: the flat six-column table becomes a section that names
 *     the operators, a strip of four figures, a searchable list with five filters, and the two
 *     acts said out loud. The role column goes, the doors follow the row, and the doors the node
 *     refuses (your own revoke, the last operator, deactivating yourself) are no longer drawn.
 *   v1.3.0 — 2026-08-24 — Deactivate/reactivate actions + the deactivated and managed-by badges
 *     (BR-04): the operator's manual offboarding door, same service as SCIM's active flag.
 *   v1.2.0 — 2026-08-14 — Revoke Operator action next to Grant Operator.
 *   v1.1.0 — 2026-07-18 — Vaihe 2d: hand-rolled <table> → canonical admin <DataTable> (rows/headers
 *     model); cell content preserved verbatim.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { date as fmtDate } from '/js/format.js';
import { num, dt, Row, Badge, Empty, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { Section, Columns, Stack, NumeralBand, Toolbar, Table, Menu, Chip, Action, Surface, KeyValue, Text, scrollToId } from '/components/poster-parts.js';
import { grantRole, revokeRole, disableOwner, enableOwner } from '/js/services/admin.js';
import { decorate, summarise, counts, search, FILTERS, PAGE } from './owners-tab.model.js';

const R = (key, params) => t('dashboard.roster.' + key, params);

/** The five chips, keyed by the filter ids FILTERS orders and counts() counts. */
const FILTER_LABEL = { all: 'fAll', operators: 'fOperators', agents: 'fAgents', quiet: 'fQuiet', off: 'fOff' };

/** The day alone. The clock time moves to the cell's title, where a date's hour is worth having. */
const day = (iso) => (iso ? fmtDate(iso) : '—');

/** "72 agents", "1 agent", "no agent" — the phrase, not a bare number. */
function agentWords(count) {
  if (!count) return R('agentsNone');
  return count === 1 ? R('agentVal') : R('agentsVal', { count: num(count) });
}

/** One row of the table: the numeral, the name with its chips, the agent count, the day, the menu. */
function ownerCells(row, index, { onGrant, onRevoke, onDisable, onEnable }) {
  const items = [
    row.canGrant && { label: R('grantLabel'), onClick: () => onGrant(row) },
    row.canRevoke && { label: R('askRevokeBtn'), onClick: () => onRevoke(row) },
    row.canEnable && { label: R('askOnBtn'), onClick: () => onEnable(row) },
    row.canDisable && { label: R('offLabel'), onClick: () => onDisable(row), danger: true },
  ].filter(Boolean);
  const name = html`<${Stack} direction="wrap" align="center" density="compact">
    <${Text} tone=${row.disabledAt ? 'muted' : 'plain'}><strong>${row.name}</strong><//>
    ${row.display && html`<${Text} kind="caption" tone="muted">${row.display}<//>`}
    ${row.you && html`<${Chip} tone="sun">${R('you').toLowerCase()}<//>`}
    ${row.operator && html`<${Chip} tone="coral">${R('operator').toLowerCase()}<//>`}
    ${row.disabledAt && html`<${Chip} tone="coral" title=${dt(row.disabledAt)}>${R('offChip', { date: day(row.disabledAt) })}<//>`}
    ${row.managedBy && html`<${Chip} title=${t('dashboard.ownerManagedHint')}>${row.managedBy}<//>`}
  <//>`;
  return [
    html`<${Text} kind="number" size="small">${String(index).padStart(2, '0')}<//>`,
    name,
    { text: html`<${Text} kind="mono" tone=${row.agents ? 'plain' : 'muted'}>${row.agents}<//>`, align: 'end' },
    html`<${Text} kind="mono" tone="muted" title=${dt(row.createdAt)}>${day(row.createdAt)}<//>`,
    items.length
      ? html`<${Menu} label=${row.name} items=${items} />`
      : html`<${Text} kind="caption" tone="muted">${row.you ? R('yours') : ''}<//>`,
  ];
}

export default function OwnersTab({ data, session, reload, switchPage }) {
  const [toast, showErr, , clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [newestFirst, setNewestFirst] = useState(false);
  const [all, setAll] = useState(false);

  const me = session?.owner || null;
  const rows = useMemo(() => decorate(data.owners, me), [data.owners, me]);
  const figures = useMemo(() => summarise(rows), [rows]);
  const chips = useMemo(() => counts(rows), [rows]);
  const found = useMemo(() => {
    const list = search(rows, filter, query);
    return newestFirst ? [...list].reverse() : list;
  }, [rows, filter, query, newestFirst]);

  if (!rows.length) return html`<${Empty} text=${t('dashboard.noOwnersFound')} />`;

  const shown = all ? found : found.slice(0, PAGE);
  const activeAgents = data.dash?.counts?.active_agents_24h ?? 0;
  const agentTotal = data.dash?.counts?.agents ?? 0;

  /** Run one write, say what went wrong if it did, and let the shell re-read the list. */
  async function act(fn) {
    try { await fn(); reload(); }
    catch (e) { showErr(e.message); }
  }

  function askGrant(row) {
    const body = html`<${Stack} density="compact">
      <${Text}>${R('askGrantBody', { name: row.name })}<//>
      <${Text} kind="caption" tone="muted">${figures.operators === 1
    ? R('askGrantCountOne')
    : R('askGrantCount', { count: figures.operators, next: figures.operators + 1 })}<//>
    <//>`;
    confirm(body, () => act(() => grantRole(row.name, 'operator')),
      { title: R('askGrantTitle'), confirmLabel: R('grantLabel') });
  }

  function askRevoke(row) {
    confirm(html`<${Text}>${R('askRevokeBody', { name: row.name })}<//>`, () => act(() => revokeRole(row.name, 'operator')),
      { title: R('askRevokeTitle'), confirmLabel: R('askRevokeBtn') });
  }

  function askDisable(row) {
    const lead = row.agents === 0
      ? R('askOffBodyNone')
      : row.agents === 1 ? R('askOffBodyOne') : R('askOffBody', { agents: agentWords(row.agents) });
    const body = html`<${Stack} density="compact">
      <${Text} kind="mono" tone="coral">${row.name}<//>
      <${Text}>${lead}<//>
      <${Surface} kind="box" density="compact">
        <${KeyValue} mono label=${R('askOffRowAgents')} value=${R('askOffRowAgentsVal', { count: row.agents })} />
        <${KeyValue} mono label=${R('askOffRowTokens')} value=${R('askOffRowTokensVal')} />
        <${KeyValue} mono label=${R('askOffRowKeeps')} value=${R('askOffRowKeepsVal')} />
      <//>
      <${Text} kind="caption" tone="muted">${R('askOffNote')}<//>
    <//>`;
    confirm(body, () => act(() => disableOwner(row.name)),
      { title: R('askOffTitle'), confirmLabel: R('offLabel'), danger: true });
  }

  function askEnable(row) {
    confirm(html`<${Text}>${R('askOnBody', { name: row.name })}<//>`, () => act(() => enableOwner(row.name)),
      { title: R('askOnTitle'), confirmLabel: R('askOnBtn') });
  }

  const doors = { onGrant: askGrant, onRevoke: askRevoke, onDisable: askDisable, onEnable: askEnable };

  return html`
    <${Stack}>
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

      <${Section} title=${R('who')} count="01"
        actions=${html`<${Action} onClick=${() => scrollToId('adm-own-acts')}>${R('whoDoor')}<//>`}>
        <${Columns} collapse=${900}>
          <${Stack} density="compact">
            <${Text} kind="heading">${figures.operators === 1 ? R('operatorWord') : R('operatorsWord', { count: figures.operators })}<//>
            <${Text}>${R('lead')}<//>
            <${Text} kind="caption" tone="muted">${figures.total - figures.operators > 0
    ? R('leadRest', { total: num(figures.total), rest: num(figures.total - figures.operators) })
    : R('leadAlone', { total: num(figures.total) })}<//>
          <//>
          <div>
            ${figures.operatorRows.map((r) => html`
              <${Row} key=${r.name}
                title=${r.name}
                why=${r.you
    ? R('youWhy')
    : r.agents === 1
      ? R('rowWhyOne', { date: day(r.createdAt) })
      : r.agents === 0
        ? R('rowWhyNone', { date: day(r.createdAt) })
        : R('rowWhy', { date: day(r.createdAt), agents: agentWords(r.agents) })}
                chip=${html`<${Badge} type=${r.you ? 'warning' : 'healthy'} label=${r.you ? R('you') : R('operator')} />`}
                value=${r.you ? day(r.createdAt) : agentWords(r.agents)} />`)}
          </div>
        <//>
      <//>

      <${NumeralBand} tone="plain" items=${[
    { label: R('stripOwners'), value: num(figures.total), note: R('stripOwnersSub', { count: num(figures.joinedWeek) }) },
    { label: R('stripWith'), value: num(figures.withAgents), note: R('stripWithSub', { count: num(figures.quiet) }) },
    { label: R('stripAgents'), value: num(agentTotal), note: R('stripAgentsSub', { count: num(activeAgents) }), onClick: () => switchPage('agents') },
    { label: R('stripOff'), value: num(figures.off), note: R('stripOffSub'), tone: figures.off ? 'coral' : undefined },
  ]} />

      <${Section} title=${R('every')} count="02"
        actions=${html`<${Action} onClick=${() => setNewestFirst(v => !v)}>${newestFirst ? R('orderOldest') : R('orderNewest')}<//>`}>
        <${Stack}>
          <${Toolbar} label=${R('every')}
            search=${{ label: R('find'), placeholder: R('findPlaceholder'), value: query, onInput: (e) => { setQuery(e.target.value); setAll(false); } }}
            filters=${FILTERS.map((id) => ({ id, label: R(FILTER_LABEL[id], { count: num(chips[id]) }), selected: filter === id,
    onClick: () => { setFilter(id); setAll(false); } }))} />

          ${shown.length === 0
    ? html`<${Empty} text=${R('none')} />`
    : html`<${Table} density="compact" collapse=${600} label=${R('every')}
              headers=${['#', R('colName'), R('colAgents'), R('colCreated'), '']}
              rows=${shown.map((row, i) => ownerCells(row, newestFirst ? found.length - i : i + 1, doors))} />`}

          ${found.length > PAGE && html`
            <${Stack} direction="horizontal" align="between">
              <${Text} kind="caption" tone="muted">${R('shown', { shown: num(shown.length), total: num(found.length) })}<//>
              ${!all && html`<${Action} onClick=${() => setAll(true)}>${R('showRest')}<//>`}
            <//>`}
        <//>
      <//>

      <${Section} id="adm-own-acts" title=${R('acts')} count="03">
        <${Columns} collapse=${640}>
          <${Surface} kind="aside" density="compact">
            <${Stack} density="compact">
              <${Text} kind="label">${R('grantLabel')}<//>
              <${Text}>${R('grantBody')}<//>
              <${Text}><strong>${R('grantRule')}</strong><//>
            <//>
          <//>
          <${Surface} kind="aside" tone="danger" density="compact">
            <${Stack} density="compact">
              <${Text} kind="label">${R('offLabel')}<//>
              <${Text}>${R('offBody')}<//>
              <${Text}><strong>${R('offRule')}</strong><//>
            <//>
          <//>
        <//>
      <//>

      <${ConfirmUI} />
    <//>
  `;
}
