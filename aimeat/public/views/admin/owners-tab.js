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
 *   manages the account — at the far end where the chips line up down the table.
 *
 *   THE TWO DOORS ARE DRAWN ON ONE ROW AT A TIME. The page used to paint two buttons on every row,
 *   a hundred and twenty-two of them, the destructive one no louder than the other. They belong to
 *   the row under the pointer, the row with keyboard focus, or the row somebody opened by pressing
 *   its name, which is the same gesture on a phone (the List's Row quietDoors).
 *
 *   A DOOR IS ABSENT WHERE THE NODE WOULD REFUSE IT: see owners-tab.model.js.
 *
 *   Every part is a library component; the page passes data and writes no class.
 *
 * @structure
 *   - OwnersTab({ data, session, reload, switchPage }) — the three sections
 *   - OwnerRow — one row of the list, its chips and its doors
 *   - askGrant / askRevoke / askDisable / askEnable — the question each act asks first
 *
 * @version-history
 *   v3.0.0 — 2026-09-27 — Library components only (the admin pages on the shared set): Section,
 *     Verdict, FigureStrip, the List with its quiet doors, the filter Tabs, TextField, More,
 *     SettingBox; the question's rows are Facts in a Box. The page sheet admin-owners.css goes.
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
import { h, Fragment } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { date as fmtDate } from '/js/format.js';
import { num, dt, Row, Badge, Empty, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { Section } from '/components/Section.js';
import { Verdict } from '/components/Readings.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Figure } from '/components/Figure.js';
import { List, Row as Item, Name, Num, When, Cell, Doors, More } from '/components/List.js';
import { Action } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Box, SettingBox } from '/components/Box.js';
import { CardGrid } from '/components/Card.js';
import { Facts } from '/components/Facts.js';
import { TextField } from '/components/TextField.js';
import { Tabs } from '/components/Tabs.js';
import { Row as Line, Stack } from '/components/Layout.js';
import { grantRole, revokeRole, disableOwner, enableOwner } from '/js/services/admin.js';
import { decorate, summarise, counts, search, FILTERS, PAGE } from './owners-tab.model.js';

const R = (key, params) => t('dashboard.roster.' + key, params);

/** The anchor of section 03, which section 01's door scrolls to. */
const ACTS_ID = 'adm-own-acts';

/** The five chips, keyed by the filter ids FILTERS orders and counts() counts. */
const FILTER_LABEL = { all: 'fAll', operators: 'fOperators', agents: 'fAgents', quiet: 'fQuiet', off: 'fOff' };

/** The day alone. The clock time moves to the row's title, where a date's hour is worth having. */
const day = (iso) => (iso ? fmtDate(iso) : '—');

/** "72 agents", "1 agent", "no agent" — the phrase, not a bare number. */
function agentWords(count) {
  if (!count) return R('agentsNone');
  return count === 1 ? R('agentVal') : R('agentsVal', { count: num(count) });
}

/** One row: the numeral, the name with its chips, the agent count, the day, the doors. */
function OwnerRow({ row, index, open, onOpen, onGrant, onRevoke, onDisable, onEnable }) {
  const doors = [];
  if (row.canGrant) doors.push(html`<${Action} small key="grant" onClick=${() => onGrant(row)}>${R('grantLabel')}<//>`);
  if (row.canRevoke) doors.push(html`<${Action} small key="revoke" onClick=${() => onRevoke(row)}>${R('askRevokeBtn')}<//>`);
  if (row.canDisable) doors.push(html`<${Action} small key="off" tone="danger" onClick=${() => onDisable(row)}>${R('offLabel')}<//>`);
  if (row.canEnable) doors.push(html`<${Action} small key="on" onClick=${() => onEnable(row)}>${R('askOnBtn')}<//>`);

  const marks = html`
    ${row.you && html`<${Mark} tone="sun">${R('you').toLowerCase()}<//>`}
    ${row.operator && html`<${Mark} tone="coral">${R('operator').toLowerCase()}<//>`}
    ${row.disabledAt && html`<${Mark} tone="coral" title=${dt(row.disabledAt)}>${R('offChip', { date: day(row.disabledAt) })}<//>`}
    ${row.managedBy && html`<${Mark} title=${t('dashboard.ownerManagedHint')}>${row.managedBy}<//>`}`;

  return html`
    <${Item} quietDoors hover selected=${open} faded=${!!row.disabledAt}>
      <${Num}><${Figure} small n=${String(index).padStart(2, '0')} /><//>
      <${Name} onOpen=${onOpen} meta=${row.display} end=${marks}>${row.name}<//>
      <${Num} dim=${!row.agents}>${row.agents}<//>
      <${When} title=${dt(row.createdAt)}>${day(row.createdAt)}<//>
      ${doors.length
    ? html`<${Doors}>${doors}<//>`
    : html`<${Cell} meta>${row.you ? R('yours') : ''}<//>`}
    <//>`;
}

export default function OwnersTab({ data, session, reload, switchPage }) {
  const [toast, showErr, , clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [newestFirst, setNewestFirst] = useState(false);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState(null);

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
    const body = html`<${Stack}>
      ${R('askGrantBody', { name: row.name })}
      <${Note} kind="hint">${figures.operators === 1
    ? R('askGrantCountOne')
    : R('askGrantCount', { count: figures.operators, next: figures.operators + 1 })}<//>
    <//>`;
    confirm(body, () => act(() => grantRole(row.name, 'operator')),
      { title: R('askGrantTitle'), confirmLabel: R('grantLabel') });
  }

  function askRevoke(row) {
    confirm(R('askRevokeBody', { name: row.name }), () => act(() => revokeRole(row.name, 'operator')),
      { title: R('askRevokeTitle'), confirmLabel: R('askRevokeBtn') });
  }

  function askDisable(row) {
    const lead = row.agents === 0
      ? R('askOffBodyNone')
      : row.agents === 1 ? R('askOffBodyOne') : R('askOffBody', { agents: agentWords(row.agents) });
    const body = html`<${Stack}>
      <${Mark} tone="coral">${row.name}<//>
      ${lead}
      <${Box}><${Facts} flush rows=${[
    { k: R('askOffRowAgents'), v: R('askOffRowAgentsVal', { count: row.agents }) },
    { k: R('askOffRowTokens'), v: R('askOffRowTokensVal') },
    { k: R('askOffRowKeeps'), v: R('askOffRowKeepsVal') },
  ]} /><//>
      <${Note} kind="hint">${R('askOffNote')}<//>
    <//>`;
    confirm(body, () => act(() => disableOwner(row.name)),
      { title: R('askOffTitle'), confirmLabel: R('offLabel'), danger: true });
  }

  function askEnable(row) {
    confirm(R('askOnBody', { name: row.name }), () => act(() => enableOwner(row.name)),
      { title: R('askOnTitle'), confirmLabel: R('askOnBtn') });
  }

  const operatorWhy = (r) => (r.you
    ? R('youWhy')
    : r.agents === 1
      ? R('rowWhyOne', { date: day(r.createdAt) })
      : r.agents === 0
        ? R('rowWhyNone', { date: day(r.createdAt) })
        : R('rowWhy', { date: day(r.createdAt), agents: agentWords(r.agents) }));

  return html`
    <${Fragment}>
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

      <${Section} first num="01" title=${R('who')}
        doors=${html`<${Action} small soft onClick=${() => {
    document.getElementById(ACTS_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }}>${R('whoDoor')}<//>`}>
        <${Verdict}
          word=${figures.operators === 1 ? R('operatorWord') : R('operatorsWord', { count: figures.operators })}
          line=${R('lead')}
          stamp=${figures.total - figures.operators > 0
    ? R('leadRest', { total: num(figures.total), rest: num(figures.total - figures.operators) })
    : R('leadAlone', { total: num(figures.total) })}>
          ${figures.operatorRows.map((r, i) => html`
            <${Row} key=${r.name}
              title=${r.name}
              why=${operatorWhy(r)}
              chip=${html`<${Badge} type=${r.you ? 'warning' : 'healthy'} label=${r.you ? R('you') : R('operator')} />`}
              value=${r.you ? day(r.createdAt) : agentWords(r.agents)}
              last=${i === figures.operatorRows.length - 1} />`)}
        <//>
      <//>

      <${FigureStrip} wrap items=${[
    { key: 'owners', n: num(figures.total), label: R('stripOwners'), sub: R('stripOwnersSub', { count: num(figures.joinedWeek) }) },
    { key: 'with', n: num(figures.withAgents), label: R('stripWith'), sub: R('stripWithSub', { count: num(figures.quiet) }) },
    { key: 'agents', n: num(agentTotal), label: R('stripAgents'), sub: R('stripAgentsSub', { count: num(activeAgents) }), onClick: () => switchPage('agents') },
    { key: 'off', n: num(figures.off), tone: figures.off ? 'notice' : undefined, label: R('stripOff'), sub: R('stripOffSub') },
  ]} />

      <${Section} num="02" title=${R('every')}
        doors=${html`<${Action} small soft onClick=${() => setNewestFirst(v => !v)}>
          ${newestFirst ? R('orderOldest') : R('orderNewest')}<//>`}>
        <${Line} wrap align="end" gap="large" below="medium">
          <${TextField} search label=${R('find')} value=${query} placeholder=${R('findPlaceholder')}
            onInput=${(v) => { setQuery(v); setAll(false); }} />
          <${Tabs} tone="filter" value=${filter} label=${R('find')}
            onSelect=${(id) => { setFilter(id); setAll(false); }}
            items=${FILTERS.map(id => ({ value: id, label: R(FILTER_LABEL[id], { count: num(chips[id]) }) }))} />
        <//>

        <${List} cols="n-name-n-when-doors" keepCols empty=${R('none')}
          head=${[{ label: '#', num: true }, R('colName'), { label: R('colAgents'), num: true }, R('colCreated'), '']}>
          ${shown.map((row, i) => html`
            <${OwnerRow} key=${row.name}
              row=${row}
              index=${newestFirst ? found.length - i : i + 1}
              open=${open === row.name}
              onOpen=${() => setOpen(open === row.name ? null : row.name)}
              onGrant=${askGrant} onRevoke=${askRevoke} onDisable=${askDisable} onEnable=${askEnable} />`)}
        <//>

        ${found.length > PAGE && html`
          <${More} note=${R('shown', { shown: num(shown.length), total: num(found.length) })}
            label=${R('showRest')} onMore=${!all ? () => setAll(true) : null} />`}
      <//>

      <${Section} id=${ACTS_ID} num="03" title=${R('acts')}>
        <${CardGrid} cols="sections">
          <${SettingBox} label=${R('grantLabel')}>
            <p>${R('grantBody')}</p>
            <p><b>${R('grantRule')}</b></p>
          <//>
          <${SettingBox} label=${R('offLabel')} irreversible>
            <p>${R('offBody')}</p>
            <p><b>${R('offRule')}</b></p>
          <//>
        <//>
      <//>

      <${ConfirmUI} />
    <//>
  `;
}
