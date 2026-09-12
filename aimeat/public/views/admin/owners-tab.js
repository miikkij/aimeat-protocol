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
 *   its name, which is the same gesture on a phone.
 *
 *   A DOOR IS ABSENT WHERE THE NODE WOULD REFUSE IT: see owners-tab.model.js.
 *
 * @structure
 *   - OwnersTab({ data, session, reload, switchPage }) — the three sections
 *   - OwnerRow — one row of the list, its chips and its doors
 *   - askGrant / askRevoke / askDisable / askEnable — the question each act asks first
 *
 * @version-history
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
import { useViewCSS } from '/components/useViewCSS.js';
import { num, dt, Row, Badge, Empty, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { grantRole, revokeRole, disableOwner, enableOwner } from '/js/services/admin.js';
import { decorate, summarise, counts, search, FILTERS, PAGE } from './owners-tab.model.js';

const R = (key, params) => t('dashboard.roster.' + key, params);

/** The question this page asks wears the poster face; admin-owners.css dresses this class. */
const DLG = 'adm-own-dlg';

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
  if (row.canGrant) doors.push(html`<button type="button" class="adm-own-act" onClick=${() => onGrant(row)}>${R('grantLabel')}</button>`);
  if (row.canRevoke) doors.push(html`<button type="button" class="adm-own-act" onClick=${() => onRevoke(row)}>${R('askRevokeBtn')}</button>`);
  if (row.canDisable) doors.push(html`<button type="button" class="adm-own-act adm-own-act--hot" onClick=${() => onDisable(row)}>${R('offLabel')}</button>`);
  if (row.canEnable) doors.push(html`<button type="button" class="adm-own-act" onClick=${() => onEnable(row)}>${R('askOnBtn')}</button>`);

  return html`
    <div class="adm-own-tr ${open ? 'is-open' : ''} ${row.disabledAt ? 'is-off' : ''}">
      <div class="adm-own-n">${String(index).padStart(2, '0')}</div>
      <div class="adm-own-nm">
        <button type="button" class="adm-own-name" onClick=${onOpen}>${row.name}</button>
        ${row.display && html`<span class="adm-own-sub">${row.display}</span>`}
        <span class="adm-own-marks">
          ${row.you && html`<span class="adm-own-chip adm-own-chip--you">${R('you').toLowerCase()}</span>`}
          ${row.operator && html`<span class="adm-own-chip adm-own-chip--op">${R('operator').toLowerCase()}</span>`}
          ${row.disabledAt && html`<span class="adm-own-chip adm-own-chip--op" title=${dt(row.disabledAt)}>${R('offChip', { date: day(row.disabledAt) })}</span>`}
          ${row.managedBy && html`<span class="adm-own-chip" title=${t('dashboard.ownerManagedHint')}>${row.managedBy}</span>`}
        </span>
      </div>
      <div class="adm-own-ag ${row.agents ? '' : 'is-zero'}">${row.agents}</div>
      <div class="adm-own-day" title=${dt(row.createdAt)}>${day(row.createdAt)}</div>
      ${doors.length
    ? html`<div class="adm-own-acts">${doors}</div>`
    : html`<div class="adm-own-held">${row.you ? R('yours') : ''}</div>`}
    </div>`;
}

export default function OwnersTab({ data, session, reload, switchPage }) {
  useViewCSS('/css/views/admin-owners.css');
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
    const body = html`<span class="adm-own-ask">
      <span>${R('askGrantBody', { name: row.name })}</span>
      <span class="adm-own-ask-note">${figures.operators === 1
    ? R('askGrantCountOne')
    : R('askGrantCount', { count: figures.operators, next: figures.operators + 1 })}</span>
    </span>`;
    confirm(body, () => act(() => grantRole(row.name, 'operator')),
      { title: R('askGrantTitle'), confirmLabel: R('grantLabel'), className: DLG });
  }

  function askRevoke(row) {
    const body = html`<span class="adm-own-ask"><span>${R('askRevokeBody', { name: row.name })}</span></span>`;
    confirm(body, () => act(() => revokeRole(row.name, 'operator')),
      { title: R('askRevokeTitle'), confirmLabel: R('askRevokeBtn'), className: DLG });
  }

  function askDisable(row) {
    const lead = row.agents === 0
      ? R('askOffBodyNone')
      : row.agents === 1 ? R('askOffBodyOne') : R('askOffBody', { agents: agentWords(row.agents) });
    const body = html`<span class="adm-own-ask">
      <span class="adm-own-ask-who">${row.name}</span>
      <span>${lead}</span>
      <span class="adm-own-ask-rows">
        <span class="adm-own-ask-row">${R('askOffRowAgents')}<em>${R('askOffRowAgentsVal', { count: row.agents })}</em></span>
        <span class="adm-own-ask-row">${R('askOffRowTokens')}<em>${R('askOffRowTokensVal')}</em></span>
        <span class="adm-own-ask-row">${R('askOffRowKeeps')}<em>${R('askOffRowKeepsVal')}</em></span>
      </span>
      <span class="adm-own-ask-note">${R('askOffNote')}</span>
    </span>`;
    confirm(body, () => act(() => disableOwner(row.name)),
      { title: R('askOffTitle'), confirmLabel: R('offLabel'), danger: true, className: DLG });
  }

  function askEnable(row) {
    const body = html`<span class="adm-own-ask"><span>${R('askOnBody', { name: row.name })}</span></span>`;
    confirm(body, () => act(() => enableOwner(row.name)),
      { title: R('askOnTitle'), confirmLabel: R('askOnBtn'), className: DLG });
  }

  const chip = (id, label) => html`
    <button type="button" class="adm-own-fchip ${filter === id ? 'on' : ''}"
      onClick=${() => { setFilter(id); setAll(false); }}>${label}</button>`;

  return html`
    <div class="og adm-own">
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

      <section class="og-sec og-sec--first">
        <div class="og-sec-h">
          <h2>${R('who')}<small>01</small></h2>
          <div class="og-doors">
            <button type="button" class="og-door og-door--quiet" onClick=${() => {
    document.querySelector('.adm-own-acts-sec')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }}>${R('whoDoor')}</button>
          </div>
        </div>
        <div class="adm-ov-grid">
          <div>
            <div class="adm-ov-status">${figures.operators === 1 ? R('operatorWord') : R('operatorsWord', { count: figures.operators })}</div>
            <p class="adm-alert-line">${R('lead')}</p>
            <div class="adm-ov-up">${figures.total - figures.operators > 0
    ? R('leadRest', { total: num(figures.total), rest: num(figures.total - figures.operators) })
    : R('leadAlone', { total: num(figures.total) })}</div>
          </div>
          <div>
            ${figures.operatorRows.map((r, i) => html`
              <${Row}
                title=${r.name}
                why=${r.you
    ? R('youWhy')
    : r.agents === 1
      ? R('rowWhyOne', { date: day(r.createdAt) })
      : r.agents === 0
        ? R('rowWhyNone', { date: day(r.createdAt) })
        : R('rowWhy', { date: day(r.createdAt), agents: agentWords(r.agents) })}
                chip=${html`<${Badge} type=${r.you ? 'warning' : 'healthy'} label=${r.you ? R('you') : R('operator')} />`}
                value=${r.you ? day(r.createdAt) : agentWords(r.agents)}
                last=${i === figures.operatorRows.length - 1} />`)}
          </div>
        </div>
      </section>

      <div class="og-strip">
        <div><b>${num(figures.total)}</b><span>${R('stripOwners')}</span><small>${R('stripOwnersSub', { count: num(figures.joinedWeek) })}</small></div>
        <div><b>${num(figures.withAgents)}</b><span>${R('stripWith')}</span><small>${R('stripWithSub', { count: num(figures.quiet) })}</small></div>
        <button type="button" onClick=${() => switchPage('agents')}>
          <b>${num(agentTotal)}</b><span>${R('stripAgents')}</span><small>${R('stripAgentsSub', { count: num(activeAgents) })}</small></button>
        <div><b class=${figures.off ? 'og-coral-num' : ''}>${num(figures.off)}</b><span>${R('stripOff')}</span><small>${R('stripOffSub')}</small></div>
      </div>

      <section class="og-sec">
        <div class="og-sec-h">
          <h2>${R('every')}<small>02</small></h2>
          <div class="og-doors">
            <button type="button" class="og-door og-door--quiet" onClick=${() => setNewestFirst(v => !v)}>
              ${newestFirst ? R('orderOldest') : R('orderNewest')}</button>
          </div>
        </div>

        <div class="adm-own-find">
          <div class="adm-own-fld">
            <div class="adm-own-lbl">${R('find')}</div>
            <input type="search" class="adm-own-input" value=${query} placeholder=${R('findPlaceholder')}
              onInput=${e => { setQuery(e.target.value); setAll(false); }} />
          </div>
          <div class="adm-own-chips">
            ${FILTERS.map(id => chip(id, R(FILTER_LABEL[id], { count: num(chips[id]) })))}
          </div>
        </div>

        <div class="adm-own-tr adm-own-tr--head">
          <div class="adm-own-n">#</div>
          <div>${R('colName')}</div>
          <div class="adm-own-ag">${R('colAgents')}</div>
          <div>${R('colCreated')}</div>
          <div></div>
        </div>

        ${shown.length === 0
    ? html`<${Empty} text=${R('none')} />`
    : shown.map((row, i) => html`
          <${OwnerRow}
            row=${row}
            index=${newestFirst ? found.length - i : i + 1}
            open=${open === row.name}
            onOpen=${() => setOpen(open === row.name ? null : row.name)}
            onGrant=${askGrant} onRevoke=${askRevoke} onDisable=${askDisable} onEnable=${askEnable} />`)}

        ${found.length > PAGE && html`
          <div class="adm-own-more">
            <span>${R('shown', { shown: num(shown.length), total: num(found.length) })}</span>
            ${!all && html`<button type="button" class="og-door" onClick=${() => setAll(true)}>${R('showRest')}</button>`}
          </div>`}
      </section>

      <section class="og-sec adm-own-acts-sec">
        <div class="og-sec-h"><h2>${R('acts')}<small>03</small></h2></div>
        <div class="adm-own-two">
          <div class="og-box">
            <span class="og-box-label">${R('grantLabel')}</span>
            <p>${R('grantBody')}</p>
            <p class="adm-own-rule">${R('grantRule')}</p>
          </div>
          <div class="og-box og-box--solid">
            <span class="og-box-label">${R('offLabel')}</span>
            <p>${R('offBody')}</p>
            <p class="adm-own-rule">${R('offRule')}</p>
          </div>
        </div>
      </section>

      <${ConfirmUI} />
    </div>
  `;
}
