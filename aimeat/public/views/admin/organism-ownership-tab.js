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
 *
 *   Every part is a library component; the page passes data and writes no class.
 * @structure
 *   - OrganismOwnershipTab({ data, reload }) — the four sections and the one write
 *   - askAdd — the question, which names who hears about it
 *   - the opened organism is organism-ownership-tab.detail.js
 * @usage registered in views/admin.js under the Identity group
 * @version-history
 *   v3.0.0 — 2026-09-27 — Library components only (the admin pages on the shared set): Section,
 *     Verdict, FigureStrip, the List, the filter Tabs, TextField, More, SettingBox; the question's
 *     rows are Facts in a Box. The page sheet admin-organism-ownership.css goes.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v2.1.0 — 2026-09-13 — Compose shared poster headings and externalize column alignment.
 *   v2.0.0 — 2026-09-12 — The poster face, and the listing that makes the page usable: sections
 *     that say whether anything is stuck, every organism with the state of each owner, filters, and
 *     a new owner picked from this node's own people rather than typed. The cross-account write
 *     asks first and says who is told.
 *   v1.0.0 — 2026-08-15 — Initial, beside POST /v1/admin/organisms/:id/ownership.
 */
import { h, Fragment } from 'preact';
import { useState, useEffect, useMemo, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { date as fmtDate } from '/js/format.js';
import { num, Row, Badge, Empty, Spinner, ErrorBox, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { Section } from '/components/Section.js';
import { Verdict } from '/components/Readings.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Figure } from '/components/Figure.js';
import { List, Row as Item, Name, Num, When, Cell, Doors, More } from '/components/List.js';
import { Action } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Box, SettingBox } from '/components/Box.js';
import { CardGrid } from '/components/Card.js';
import { Facts } from '/components/Facts.js';
import { TextField } from '/components/TextField.js';
import { Tabs } from '/components/Tabs.js';
import { Row as Line, Stack } from '/components/Layout.js';
import { getAdminOrganisms, getOrganismOwnership, addOrganismOwner } from '/js/services/admin.js';
import { decorate, summarise, counts, search, FILTERS, PAGE } from './organism-ownership-tab.model.js';
import OrganismDetail, { ownerMarks } from './organism-ownership-tab.detail.js';

const O = (key, params) => t('admin.orgOwnership.' + key, params);
const day = (iso) => (iso ? fmtDate(iso) : '—');

/** The anchor of the last section, which section 01's door scrolls to. */
const ACTS_ID = 'adm-oo-acts';

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
    const body = html`<${Stack}>
      ${holding.length
    ? O('askBody', { name, owners: holding.join(', ') })
    : O('askBodyAlone', { name })}
      <${Box}><${Facts} flush rows=${[
    holding.length && { k: O('askRowKeeps'), v: O('askRowKeepsVal') },
    { k: O('askRowNew', { name }), v: O('askRowNewVal') },
    { k: O('askRowTold'), v: O('askRowToldVal') },
    { k: O('askRowLog'), v: O('askRowLogVal') },
  ]} /><//>
      <${Note} kind="hint">${O('askNote')}<//>
    <//>`;
    confirm(body, () => doAdd(name),
      { title: O('askTitle'), confirmLabel: O('makeOwner', { name }) });
  }

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
    <${Fragment}>
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

      <${Section} first num="01" title=${O('stuckQ')}
        doors=${html`<${Action} small soft onClick=${() => {
    document.getElementById(ACTS_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }}>${O('whatDoor')}<//>`}>
        <${Verdict}
          word=${figures.stuck === 0
    ? O('stuckWordNone')
    : figures.stuck === 1 ? O('stuckWordOne') : O('stuckWord', { count: figures.stuck })}
          tone=${figures.stuck ? 'danger' : undefined}
          line=${O('lead')}
          stamp=${html`
            ${O('leadCount', { total: num(figures.total) })}<br />
            ${O('leadOff', { count: rows.filter(r => r.stuck && r.ownerStates.some(o => o.state === 'off')).length })}<br />
            ${O('leadGone', { count: rows.filter(r => r.ownerStates.some(o => o.state === 'gone')).length })}`}>
          ${figures.stuckRows.map((r, i) => html`
            <${Row} key=${r.id}
              title=${r.name}
              why=${stuckWhy(r)}
              chip=${html`<${Badge} type="danger" label=${O('stuckBadge')} />`}
              value=${html`<${Action} small tone="notice" onClick=${() => open(r.id)}>${O('putBack')}<//>`}
              last=${i === figures.stuckRows.length - 1 && figures.stuck === figures.total} />`)}
          ${figures.stuck < figures.total && html`
            <${Row}
              title=${figures.stuck ? O('allFine') : O('nothingStuck')}
              why=${figures.stuck
    ? O('allFineWhy', { count: num(figures.total - figures.stuck) })
    : O('nothingStuckWhy')}
              value=${num(figures.total - figures.stuck) + ' / ' + num(figures.total)}
              last=${true} />`}
        <//>
      <//>

      <${FigureStrip} wrap items=${[
    { key: 'orgs', n: num(figures.total), label: O('stripOrganisms'), sub: O('stripOrganismsSub') },
    { key: 'stuck', n: num(figures.stuck), tone: figures.stuck ? 'notice' : undefined, label: O('stripStuck'), sub: O('stripStuckSub') },
    { key: 'seats', n: num(figures.seats), label: O('stripSeats'), sub: O('stripSeatsSub') },
    { key: 'single', n: num(figures.single), label: O('stripSingle'), sub: O('stripSingleSub') },
  ]} />

      <${Section} num="02" title=${O('every')}
        doors=${html`<${Action} small soft onClick=${() => setOldestFirst(v => !v)}>
          ${oldestFirst ? O('orderNewest') : O('orderOldest')}<//>`}>

        ${listing && listing.complete === false && html`
          <${Note} kind="aside">${O('partial', { count: num(listing.count) })}<//>`}

        <${Line} wrap align="end" gap="large" below="medium">
          <${TextField} search label=${O('find')} value=${query} placeholder=${O('findPlaceholder')}
            onInput=${(v) => { setQuery(v); setAll(false); }} />
          <${Tabs} tone="filter" value=${filter} label=${O('find')}
            onSelect=${(id) => { setFilter(id); setAll(false); }}
            items=${FILTERS.map(id => ({ value: id, label: O(FILTER_LABEL[id], { count: num(chips[id]) }) }))} />
        <//>

        ${shown.length === 0
    ? html`<${Empty} text=${O('none')} />`
    : html`
        <${List} cols="n-name-tags-n-when-doors" keepCols
          head=${[{ label: '#', num: true }, O('colOrganism'), O('colHeld'), { label: O('colPeople'), num: true }, O('colCreated'), '']}>
          ${shown.map((r, i) => html`
            <${Item} key=${r.id} hover selected=${r.id === openId}>
              <${Num}><${Figure} small n=${String(oldestFirst ? found.length - i : i + 1).padStart(2, '0')} /><//>
              <${Name} onOpen=${() => open(r.id)} attention=${r.stuck} meta=${r.id.split('-')[0]}>${r.name}<//>
              <${Cell} line>${ownerMarks(r.ownerStates)}<//>
              <${Num}>${r.members}<//>
              <${When}>${day(r.createdAt)}<//>
              <${Doors}>
                ${r.stuck
    ? html`<${Action} small tone="notice" onClick=${() => open(r.id)}>${O('putBack')}<//>`
    : html`<${Action} small onClick=${() => open(r.id)}>${O('open')}<//>`}
              <//>
            <//>`)}
        <//>`}

        ${found.length > PAGE && html`
          <${More} note=${O('shown', { shown: num(shown.length), total: num(found.length) })}
            label=${O('showRest')} onMore=${!all ? () => setAll(true) : null} />`}
      <//>

      ${openRow && html`
        <${OrganismDetail}
          row=${openRow}
          ownership=${ownership}
          owners=${owners}
          busy=${busy}
          onClose=${() => { setOpenId(null); setOwnership(null); }}
          onAdd=${askAdd} />`}

      <${Section} id=${ACTS_ID} num=${openRow ? '04' : '03'} title=${O('actsTitle')}>
        <${CardGrid} cols="sections">
          <${SettingBox} label=${O('crossLabel')}>
            <p>${O('crossBody')}</p>
            <p><b>${O('crossRule')}</b></p>
          <//>
          <${SettingBox} label=${O('addsLabel')} irreversible>
            <p>${O('addsBody')}</p>
            <p><b>${O('addsRule')}</b></p>
          <//>
        <//>
      <//>

      <${ConfirmUI} />
    <//>`;
}
