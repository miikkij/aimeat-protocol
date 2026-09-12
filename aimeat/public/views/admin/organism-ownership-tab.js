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
import { useViewCSS } from '/components/useViewCSS.js';
import { num, Row, Badge, Empty, Spinner, ErrorBox, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { getAdminOrganisms, getOrganismOwnership, addOrganismOwner } from '/js/services/admin.js';
import { decorate, summarise, counts, search, FILTERS, PAGE } from './organism-ownership-tab.model.js';
import OrganismDetail from './organism-ownership-tab.detail.js';

const O = (key, params) => t('admin.orgOwnership.' + key, params);
const DLG = 'adm-oo-dlg';
const day = (iso) => (iso ? fmtDate(iso) : '—');

/** The five chips, keyed by the filter ids FILTERS orders and counts() counts. */
const FILTER_LABEL = { all: 'fAll', stuck: 'fStuck', single: 'fSingle', archived: 'fArchived' };

export default function OrganismOwnershipTab({ data, reload }) {
  useViewCSS('/css/views/admin-organism-ownership.css');
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
    const body = html`<span class="adm-oo-ask">
      <span>${holding.length
    ? O('askBody', { name, owners: holding.join(', ') })
    : O('askBodyAlone', { name })}</span>
      <span class="adm-oo-ask-rows">
        ${holding.length ? html`<span class="adm-oo-ask-row">${O('askRowKeeps')}<em>${O('askRowKeepsVal')}</em></span>` : null}
        <span class="adm-oo-ask-row">${O('askRowNew', { name })}<em>${O('askRowNewVal')}</em></span>
        <span class="adm-oo-ask-row">${O('askRowTold')}<em>${O('askRowToldVal')}</em></span>
        <span class="adm-oo-ask-row">${O('askRowLog')}<em>${O('askRowLogVal')}</em></span>
      </span>
      <span class="adm-oo-ask-note">${O('askNote')}</span>
    </span>`;
    confirm(body, () => doAdd(name),
      { title: O('askTitle'), confirmLabel: O('makeOwner', { name }), className: DLG });
  }

  const chip = (id, label) => html`
    <button type="button" class="adm-oo-fchip ${filter === id ? 'on' : ''}"
      onClick=${() => { setFilter(id); setAll(false); }}>${label}</button>`;

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
    <div class="og adm-oo">
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

      <section class="og-sec og-sec--first">
        <div class="og-sec-h">
          <h2>${O('stuckQ')}<small>01</small></h2>
          <div class="og-doors">
            <button type="button" class="og-door og-door--quiet" onClick=${() => {
    document.querySelector('.adm-oo-acts-sec')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }}>${O('whatDoor')}</button>
          </div>
        </div>
        <div class="adm-ov-grid">
          <div>
            <div class="adm-ov-status ${figures.stuck ? 'danger' : ''}">${figures.stuck === 0
    ? O('stuckWordNone')
    : figures.stuck === 1 ? O('stuckWordOne') : O('stuckWord', { count: figures.stuck })}</div>
            <p class="adm-alert-line">${O('lead')}</p>
            <div class="adm-ov-up">
              ${O('leadCount', { total: num(figures.total) })}<br />
              ${O('leadOff', { count: rows.filter(r => r.stuck && r.ownerStates.some(o => o.state === 'off')).length })}<br />
              ${O('leadGone', { count: rows.filter(r => r.ownerStates.some(o => o.state === 'gone')).length })}
            </div>
          </div>
          <div>
            ${figures.stuckRows.map((r, i) => html`
              <${Row}
                title=${r.name}
                why=${stuckWhy(r)}
                chip=${html`<${Badge} type="danger" label=${O('stuckBadge')} />`}
                value=${html`<button type="button" class="adm-oo-act adm-oo-act--hot" onClick=${() => open(r.id)}>${O('putBack')}</button>`}
                last=${i === figures.stuckRows.length - 1 && figures.stuck === figures.total} />`)}
            ${figures.stuck < figures.total && html`
              <${Row}
                title=${figures.stuck ? O('allFine') : O('nothingStuck')}
                why=${figures.stuck
    ? O('allFineWhy', { count: num(figures.total - figures.stuck) })
    : O('nothingStuckWhy')}
                value=${num(figures.total - figures.stuck) + ' / ' + num(figures.total)}
                last=${true} />`}
          </div>
        </div>
      </section>

      <div class="og-strip">
        <div><b>${num(figures.total)}</b><span>${O('stripOrganisms')}</span><small>${O('stripOrganismsSub')}</small></div>
        <div><b class=${figures.stuck ? 'og-coral-num' : ''}>${num(figures.stuck)}</b><span>${O('stripStuck')}</span><small>${O('stripStuckSub')}</small></div>
        <div><b>${num(figures.seats)}</b><span>${O('stripSeats')}</span><small>${O('stripSeatsSub')}</small></div>
        <div><b>${num(figures.single)}</b><span>${O('stripSingle')}</span><small>${O('stripSingleSub')}</small></div>
      </div>

      <section class="og-sec">
        <div class="og-sec-h">
          <h2>${O('every')}<small>02</small></h2>
          <div class="og-doors">
            <button type="button" class="og-door og-door--quiet" onClick=${() => setOldestFirst(v => !v)}>
              ${oldestFirst ? O('orderNewest') : O('orderOldest')}</button>
          </div>
        </div>

        ${listing && listing.complete === false && html`
          <p class="adm-oo-warn">${O('partial', { count: num(listing.count) })}</p>`}

        <div class="adm-oo-find">
          <div class="adm-oo-fld">
            <div class="adm-oo-lbl">${O('find')}</div>
            <input type="search" class="adm-oo-input" value=${query} placeholder=${O('findPlaceholder')}
              onInput=${e => { setQuery(e.target.value); setAll(false); }} />
          </div>
          <div class="adm-oo-chips">
            ${FILTERS.map(id => chip(id, O(FILTER_LABEL[id], { count: num(chips[id]) })))}
          </div>
        </div>

        <div class="adm-oo-row adm-oo-row--head">
          <div class="adm-oo-n">#</div>
          <div>${O('colOrganism')}</div>
          <div>${O('colHeld')}</div>
          <div style="text-align: right;">${O('colPeople')}</div>
          <div>${O('colCreated')}</div>
          <div></div>
        </div>

        ${shown.length === 0
    ? html`<${Empty} text=${O('none')} />`
    : shown.map((r, i) => html`
          <div class="adm-oo-row ${r.stuck ? 'is-stuck' : ''} ${r.id === openId ? 'is-open' : ''}">
            <div class="adm-oo-n">${String(oldestFirst ? found.length - i : i + 1).padStart(2, '0')}</div>
            <div class="adm-oo-nm">
              <button type="button" class="adm-oo-name" onClick=${() => open(r.id)}>${r.name}</button>
              <em>${r.id.split('-')[0]}</em>
            </div>
            <div class="adm-oo-held">
              ${r.ownerStates.map(o => html`
                <span class="adm-oo-chip ${o.state === 'ok' ? '' : 'adm-oo-chip--bad'}">${o.name}</span>`)}
            </div>
            <div class="adm-oo-num">${r.members}</div>
            <div class="adm-oo-day">${day(r.createdAt)}</div>
            <div class="adm-oo-acts-cell">
              ${r.stuck
    ? html`<button type="button" class="adm-oo-act adm-oo-act--hot" onClick=${() => open(r.id)}>${O('putBack')}</button>`
    : html`<button type="button" class="adm-oo-act" onClick=${() => open(r.id)}>${O('open')}</button>`}
            </div>
          </div>`)}

        ${found.length > PAGE && html`
          <div class="adm-oo-more">
            <span>${O('shown', { shown: num(shown.length), total: num(found.length) })}</span>
            ${!all && html`<button type="button" class="og-door" onClick=${() => setAll(true)}>${O('showRest')}</button>`}
          </div>`}
      </section>

      ${openRow && html`
        <${OrganismDetail}
          row=${openRow}
          ownership=${ownership}
          owners=${owners}
          busy=${busy}
          onClose=${() => { setOpenId(null); setOwnership(null); }}
          onAdd=${askAdd} />`}

      <section class="og-sec adm-oo-acts-sec">
        <div class="og-sec-h"><h2>${O('actsTitle')}<small>${openRow ? '04' : '03'}</small></h2></div>
        <div class="adm-oo-two">
          <div class="og-box">
            <span class="og-box-label">${O('crossLabel')}</span>
            <p>${O('crossBody')}</p>
            <p class="adm-oo-rule">${O('crossRule')}</p>
          </div>
          <div class="og-box og-box--solid">
            <span class="og-box-label">${O('addsLabel')}</span>
            <p>${O('addsBody')}</p>
            <p class="adm-oo-rule">${O('addsRule')}</p>
          </div>
        </div>
      </section>

      <${ConfirmUI} />
    </div>`;
}
