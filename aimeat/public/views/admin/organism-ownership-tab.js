/**
 * @file organism-ownership-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's break-glass over an organism's ownership, in the poster face (design
 *   canvas "AIMEAT Admin Organism Ownership"). Four sections in the order an operator asks: is
 *   anything stuck, every organism and who holds it, the one that is open, and what this door costs.
 *
 *   Why an operator screen exists for this at all: every gate inside an organism defers to its
 *   owners, so an organism whose owners are unreachable cannot be repaired from the inside, and the
 *   node operator had no override either. The repair used to be a hand-written SQL transaction
 *   against the production database.
 *
 *   IT USED TO BE UNUSABLE WITHOUT AN ANSWER YOU ALREADY HAD. The page was one field that wanted an
 *   organism id, and no operator surface on this node could tell anybody one. It reads the listing
 *   now, crosses it against the owner list the dashboard already fetched, and says which organisms
 *   nobody inside can repair — before anyone writes in to report it.
 *
 *   IT IS ADDITIVE. Adding an owner takes nothing from the people already there, so the operator
 *   never has to decide who loses their organism in order to fix it.
 * @structure
 *   - OrganismOwnershipTab({ data, reload }) — the four sections and the one write
 *   - askAdd — the question, which names who hears about it
 *   - the opened organism is organism-ownership-tab.detail.js
 * @usage registered in views/admin.js under the Identity group
 * @version-history
 *   2026-09-22 -- Composed from the shared component set (Section, NumeralBand, Toolbar, Table,
 *     Surface asides): no page sheet and no class of its own, so a theme change reaches it.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v2.1.0 — 2026-09-13 — Compose shared poster headings and externalize column alignment.
 *   v2.0.0 — 2026-09-12 — The poster face, and the listing that makes the page usable: sections
 *     that say whether anything is stuck, every organism with the state of each owner, filters, and
 *     a new owner picked from this node's own people rather than typed. The cross-account write
 *     asks first and says who is told.
 *   v1.0.0 — 2026-08-15 — Initial, beside POST /v1/admin/organisms/:id/ownership.
 */
import { h } from 'preact';
import { useState, useEffect, useMemo, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { date as fmtDate } from '/js/format.js';
import { num, Row, Badge, Empty, Spinner, ErrorBox, useToast, Toast } from './shared.js';
import { Section, Columns, Stack, NumeralBand, Toolbar, Table, Chip, Action, Surface, KeyValue, Text, scrollToId } from '/components/poster-parts.js';
import { useConfirm } from '/components/Modal.js';
import { getAdminOrganisms, getOrganismOwnership, addOrganismOwner } from '/js/services/admin.js';
import { decorate, summarise, counts, search, FILTERS, PAGE } from './organism-ownership-tab.model.js';
import OrganismDetail from './organism-ownership-tab.detail.js';

const O = (key, params) => t('admin.orgOwnership.' + key, params);
const day = (iso) => (iso ? fmtDate(iso) : '—');

/** The five chips, keyed by the filter ids FILTERS orders and counts() counts. */
const FILTER_LABEL = { all: 'fAll', stuck: 'fStuck', single: 'fSingle', archived: 'fArchived' };

export default function OrganismOwnershipTab({ data, reload }) {
  const [toast, showErr, showOk, clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();

  const [listing, setListing] = useState(null);   // { organisms, count, complete }
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [oldestFirst, setOldestFirst] = useState(false);
  const [all, setAll] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [ownership, setOwnership] = useState(null);
  const [busy, setBusy] = useState(false);

  // Memoised because every fold below depends on it, and `data.owners || []` would be a new array
  // on every render of the shell, which re-runs all four of them for nothing.
  const owners = useMemo(() => data.owners || [], [data.owners]);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const r = await getAdminOrganisms();
      setListing(r?.data || null);
      if (!r?.data) setFailed(true);
    } catch { setFailed(true); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  // The shell re-reads on a live update; this page's own door is not in that sweep.
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  const rows = useMemo(() => decorate(listing?.organisms, owners), [listing, owners]);
  const figures = useMemo(() => summarise(rows), [rows]);
  const chips = useMemo(() => counts(rows), [rows]);
  const found = useMemo(() => {
    const list = search(rows, filter, query);
    return oldestFirst ? [...list].reverse() : list;
  }, [rows, filter, query, oldestFirst]);

  /** Open one organism: the listing has no roster, so this is the second door. */
  const open = useCallback(async (id) => {
    setOpenId(id);
    setOwnership(null);
    try {
      const r = await getOrganismOwnership(id);
      if (r?.data) setOwnership(r.data);
      else showErr(r?.error?.message || O('notFound'));
    } catch (e) { showErr(e?.message || O('notFound')); }
  }, [showErr]);

  if (loading) return html`<${Spinner} text=${O('loading')} />`;
  if (failed) return html`<${ErrorBox} message=${O('loadFailed')} />`;

  const shown = all ? found : found.slice(0, PAGE);
  const openRow = rows.find(r => r.id === openId) || null;

  async function doAdd(name) {
    setBusy(true);
    try {
      const r = await addOrganismOwner(openRow.id, name);
      if (r?.data) {
        showOk(O('added', { name }));
        await load();
        const fresh = await getOrganismOwnership(openRow.id);
        if (fresh?.data) setOwnership(fresh.data);
        reload();
      } else { showErr(r?.error?.message || 'Failed'); }
    } catch (e) { showErr(e?.message || 'Failed'); }
    setBusy(false);
  }

  /** The one question. A cross-account write used to happen on a single press. */
  function askAdd(name) {
    const holding = ownership?.owners || [];
    const body = html`<${Stack} density="compact">
      <${Text}>${holding.length
    ? O('askBody', { name, owners: holding.join(', ') })
    : O('askBodyAlone', { name })}<//>
      <${Surface} kind="box" density="compact">
        ${holding.length ? html`<${KeyValue} mono label=${O('askRowKeeps')} value=${O('askRowKeepsVal')} />` : null}
        <${KeyValue} mono label=${O('askRowNew', { name })} value=${O('askRowNewVal')} />
        <${KeyValue} mono label=${O('askRowTold')} value=${O('askRowToldVal')} />
        <${KeyValue} mono label=${O('askRowLog')} value=${O('askRowLogVal')} />
      <//>
      <${Text} kind="caption" tone="muted">${O('askNote')}<//>
    <//>`;
    confirm(body, () => doAdd(name),
      { title: O('askTitle'), confirmLabel: O('makeOwner', { name }) });
  }

  const filters = FILTERS.map(id => ({ id, label: O(FILTER_LABEL[id], { count: num(chips[id]) }),
    selected: filter === id, onClick: () => { setFilter(id); setAll(false); } }));

  /** The way in: "Put an owner back" on a stuck one, "Open" on the rest. */
  const door = (r) => (r.stuck
    ? html`<${Action} kind="text" tone="danger" onClick=${() => open(r.id)}>${O('putBack')}<//>`
    : html`<${Action} kind="text" onClick=${() => open(r.id)}>${O('open')}<//>`);

  /** One row of the table: the numeral, the name and its id, who holds it, how many, when, the way in. */
  const cells = (r, i) => [
    html`<${Text} kind="number" size="small">${String(oldestFirst ? found.length - i : i + 1).padStart(2, '0')}<//>`,
    html`<${Stack} density="compact">
      <${Action} kind="text" onClick=${() => open(r.id)} expanded=${r.id === openId}>${r.name}<//>
      <${Text} kind="mono" tone="muted">${r.id.split('-')[0]}<//>
    <//>`,
    html`<${Stack} direction="wrap" density="compact">
      ${r.ownerStates.map(o => html`<${Chip} key=${o.name} tone=${o.state === 'ok' ? 'plain' : 'coral'}>${o.name}<//>`)}
    <//>`,
    { text: html`<${Text} kind="mono">${r.members}<//>`, align: 'end' },
    html`<${Text} kind="mono" tone="muted">${day(r.createdAt)}<//>`,
    door(r),
  ];

  /** Why this organism is stuck, in the words of what is actually wrong with it. */
  const stuckWhy = (r) => {
    const off = r.ownerStates.filter(o => o.state === 'off');
    const gone = r.ownerStates.filter(o => o.state === 'gone');
    if (gone.length && !off.length) return O('stuckWhyGone', { names: gone.map(o => o.name).join(', ') });
    if (off.length === 1 && !gone.length) {
      const owner = owners.find(o => o.name === off[0].name);
      return O('stuckWhyOff', { name: off[0].name, date: day(owner?.disabled_at) });
    }
    return O('stuckWhyOffMany', { names: r.ownerStates.map(o => o.name).join(', ') });
  };

  return html`
    <${Stack}>
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

      <${Section} title=${O('stuckQ')} count="01"
        actions=${html`<${Action} onClick=${() => scrollToId('adm-oo-acts')}>${O('whatDoor')}<//>`}>
        <${Columns} collapse=${900}>
          <${Stack} density="compact">
            <${Text} kind="heading" tone=${figures.stuck ? 'danger' : 'plain'}>${figures.stuck === 0
    ? O('stuckWordNone')
    : figures.stuck === 1 ? O('stuckWordOne') : O('stuckWord', { count: figures.stuck })}<//>
            <${Text}>${O('lead')}<//>
            <${Text} kind="mono" tone="muted">${O('leadCount', { total: num(figures.total) })}<//>
            <${Text} kind="mono" tone="muted">${O('leadOff', { count: rows.filter(r => r.stuck && r.ownerStates.some(o => o.state === 'off')).length })}<//>
            <${Text} kind="mono" tone="muted">${O('leadGone', { count: rows.filter(r => r.ownerStates.some(o => o.state === 'gone')).length })}<//>
          <//>
          <div>
            ${figures.stuckRows.map((r) => html`
              <${Row} key=${r.id}
                title=${r.name}
                why=${stuckWhy(r)}
                chip=${html`<${Badge} type="danger" label=${O('stuckBadge')} />`}
                value=${html`<${Action} kind="text" tone="danger" onClick=${() => open(r.id)}>${O('putBack')}<//>`} />`)}
            ${figures.stuck < figures.total && html`
              <${Row}
                title=${figures.stuck ? O('allFine') : O('nothingStuck')}
                why=${figures.stuck
    ? O('allFineWhy', { count: num(figures.total - figures.stuck) })
    : O('nothingStuckWhy')}
                value=${num(figures.total - figures.stuck) + ' / ' + num(figures.total)} />`}
          </div>
        <//>
      <//>

      <${NumeralBand} tone="plain" items=${[
    { label: O('stripOrganisms'), value: num(figures.total), note: O('stripOrganismsSub') },
    { label: O('stripStuck'), value: num(figures.stuck), note: O('stripStuckSub'), tone: figures.stuck ? 'coral' : undefined },
    { label: O('stripSeats'), value: num(figures.seats), note: O('stripSeatsSub') },
    { label: O('stripSingle'), value: num(figures.single), note: O('stripSingleSub') },
  ]} />

      <${Section} title=${O('every')} count="02"
        actions=${html`<${Action} onClick=${() => setOldestFirst(v => !v)}>${oldestFirst ? O('orderNewest') : O('orderOldest')}<//>`}>
        <${Stack}>
          ${listing && listing.complete === false && html`
            <${Surface} kind="aside" density="compact"><${Text}>${O('partial', { count: num(listing.count) })}<//><//>`}

          <${Toolbar} label=${O('every')} filters=${filters}
            search=${{ label: O('find'), placeholder: O('findPlaceholder'), value: query, onInput: e => { setQuery(e.target.value); setAll(false); } }} />

          ${shown.length === 0
    ? html`<${Empty} text=${O('none')} />`
    : html`<${Table} density="compact" collapse=${600} label=${O('every')}
              headers=${['#', O('colOrganism'), O('colHeld'), O('colPeople'), O('colCreated'), '']}
              rows=${shown.map(cells)} />`}

          ${found.length > PAGE && html`
            <${Stack} direction="horizontal" align="between">
              <${Text} kind="caption" tone="muted">${O('shown', { shown: num(shown.length), total: num(found.length) })}<//>
              ${!all && html`<${Action} onClick=${() => setAll(true)}>${O('showRest')}<//>`}
            <//>`}
        <//>
      <//>

      ${openRow && html`
        <${OrganismDetail}
          row=${openRow}
          ownership=${ownership}
          owners=${owners}
          busy=${busy}
          onClose=${() => { setOpenId(null); setOwnership(null); }}
          onAdd=${askAdd} />`}

      <${Section} id="adm-oo-acts" title=${O('actsTitle')} count=${openRow ? '04' : '03'}>
        <${Columns} collapse=${640}>
          <${Surface} kind="aside" density="compact"><${Stack} density="compact">
            <${Text} kind="label">${O('crossLabel')}<//>
            <${Text}>${O('crossBody')}<//>
            <${Text}><strong>${O('crossRule')}</strong><//>
          <//><//>
          <${Surface} kind="aside" tone="danger" density="compact"><${Stack} density="compact">
            <${Text} kind="label">${O('addsLabel')}<//>
            <${Text}>${O('addsBody')}<//>
            <${Text}><strong>${O('addsRule')}</strong><//>
          <//><//>
        <//>
      <//>

      <${ConfirmUI} />
    <//>`;
}
