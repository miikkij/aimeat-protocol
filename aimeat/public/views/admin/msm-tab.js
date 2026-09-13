/**
 * @file msm-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin MSM page in the poster face (design canvas "MSM Management Page",
 *   direction A): what a machine service manifest is, what is registered and where each one points,
 *   which of them describe the same thing, the ready-made ones nobody has used, and what it takes
 *   to use one.
 *
 *   THE PAGE SHOWED NOTHING WHILE TEN WERE REGISTERED. The shell fetched the listing into
 *   `data.msmIntegrations` and this tab read `data.msm`, so an operator with ten manifests met
 *   "No MSM integrations registered" under a sidebar that said 10. It loads its own listing now,
 *   which is what every page in this face does and what makes that class of bug impossible.
 *
 *   WHAT AN MSM IS NOT was the other half of the thinness. The one explanation on the page
 *   described a retry policy, scheduling, webhook delivery and event-driven workflows, none of
 *   which exists: a manifest holds a service, an auth type, actions and an optional health block.
 *   Nothing on this site ever calls one. It is a description an AI reads before calling the service
 *   itself, and the page now leads with that.
 *
 *   FIVE OF THE TEN ON AIMEAT.IO DESCRIBE ONE RSS FEED. Section 03 says so, from the addresses the
 *   listing now carries, and names the fact that joined each set.
 * @structure MsmTab (default) · RightNow · ReadyMade · WhatItTakes
 * @usage Mounted by the admin dashboard tab router (views/admin.js).
 * @version-history
 *   v2.0.1 — 2026-09-13 — The delete dialog's actions sit in the dialog's footer.
 *   v2.0.0 — 2026-09-12 — The poster face: five numbered sections, its own listing (the tab and the
 *     shell had disagreed on the key since the tab was written), where each manifest points, the
 *     sets that describe one service, the ready-made ones first on the writing screen, and an
 *     explanation that matches the schema.
 *   v1.3.0 — 2026-06-02 — Admin design unification: inline danger styles to adm-btn-danger.
 *   v1.2.0 — 2026-06-02 — Delete-confirm uses the canonical <Modal>.
 *   v1.1.0 — 2026-06-02 — Delete-confirm overlay uses .modal-overlay from theme.css.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useMemo } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { num, dt, Badge, Spinner, ErrorBox, useToast, Toast } from './shared.js';
import { Modal } from '/components/Modal.js';
import { swallowed } from '/js/swallowed.js';
import {
    listMsms, getMsmDetail, createMsm, updateMsm, deleteMsm, getMsmTemplates, getMsmTemplate,
} from '/js/services/admin.js';
import { relatedSets, loneOnes, hostsOf, actionsOf } from './msm-tab.groups.js';
import MsmDetail from './msm-tab.detail.js';
import MsmWrite from './msm-tab.write.js';

const html = htm.bind(h);
const M = (key, params) => t('admin.msm.' + key, params);

/** Whole days since an ISO stamp, which is how long nobody has touched anything here. */
function daysSince(iso) {
    if (!iso) return 0;
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return 0;
    return Math.max(0, Math.floor((Date.now() - then) / 86400000));
}

/** Section 01: four numbers, and the sentence that says what registering one does not do. */
function RightNow({ facts, number, onWrite }) {
    return html`
    <section class="og-sec og-sec--first" id="adm-msm-now">
      <div class="og-sec-h"><h2>${M('now.title')}<small>${number}</small></h2>
        <div class="og-doors"><button type="button" class="og-slab" onClick=${onWrite}>${M('writeNew')}</button></div></div>
      <div class="og-strip">
        <div><b>${num(facts.all)}</b><span>${M('strip.registered')}</span><small>${M('strip.registeredSub')}</small></div>
        <div><b>${num(facts.needKey)}</b><span>${M('strip.needKey')}</span><small>${M('strip.needKeySub')}</small></div>
        <div><b class="og-coral-num">${num(facts.biggestSet)}</b><span>${M('strip.repeated')}</span>
          <small>${facts.biggestSetWhat || M('strip.repeatedNone')}</small></div>
        <div><b>${num(facts.daysQuiet)}</b><span>${M('strip.quiet')}</span><small>${M('strip.quietSub')}</small></div>
      </div>
      <p class="adm-alert-line">${M('now.line')}</p>
    </section>`;
}

/** Section 04: the ten that ship with the software, and the fact that none of them is in use. */
function ReadyMade({ templates, number, onPick }) {
    const list = Array.isArray(templates) ? templates : [];
    const half = Math.ceil(list.length / 2);
    const row = (ft, last) => html`
      <div class=${'adm-msm-tpl' + (last ? ' adm-msm-tpl--last' : '')} key=${ft.type}>
        <span><b>${ft.name}</b><span class="adm-why">${ft.description}</span></span>
        <span><button type="button" class="og-door og-door--quiet" onClick=${() => onPick(ft.type)}>${M('write.start')}</button></span>
      </div>`;
    return html`
    <section class="og-sec" id="adm-msm-ready">
      <div class="og-sec-h"><h2>${M('ready.title')}<small>${number}</small></h2>
        <div class="og-doors"><span class="adm-msm-note">${M('ready.count', { n: num(list.length) })}</span></div></div>
      <p class="adm-msm-lead">${M('ready.lead')}</p>
      ${list.length === 0
        ? html`<p class="adm-msm-note">${M('write.noTemplates')}</p>`
        : html`<div class="adm-msm-tpls">
            <div>${list.slice(0, half).map((ft, i) => row(ft, i === half - 1))}</div>
            <div>${list.slice(half).map((ft, i) => row(ft, i === list.length - half - 1))}</div>
          </div>`}
    </section>`;
}

/** Section 05: the key, who may read them, who may write one, and what travels. */
function WhatItTakes({ facts, number }) {
    const row = (key, last) => html`
    <div class=${'adm-msm-krow adm-msm-krow--wide' + (last ? ' adm-msm-krow--last' : '')}>
      <span><b>${M('takes.' + key)}</b></span>
      <span>${M('takes.' + key + 'Why')}</span>
    </div>`;
    return html`
    <section class="og-sec" id="adm-msm-takes">
      <div class="og-sec-h"><h2>${M('takes.title')}<small>${number}</small></h2></div>
      ${row('key')}
      ${row('public')}
      ${row('write')}
      ${row('travel', true)}
      <div class="og-box" style="margin-top: 16px">
        <span class="og-box-label">${M('takes.boxLabel')}</span>
        ${M('takes.box', { days: num(facts.daysQuiet) })}
      </div>
    </section>`;
}

export default function MsmTab() {
    const [msg, showErr, showOk, clearMsg] = useToast();
    const [list, setList] = useState(null);
    const [templates, setTemplates] = useState(null);
    const [error, setError] = useState('');
    const [view, setView] = useState('list');
    const [detail, setDetail] = useState(null);
    const [query, setQuery] = useState('');
    const [busy, setBusy] = useState(false);
    const [openSet, setOpenSet] = useState('');
    const [removing, setRemoving] = useState(null);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [picked, setPicked] = useState('');
    const [yaml, setYaml] = useState('');
    const [federate, setFederate] = useState(false);
    const [writeErr, setWriteErr] = useState('');

    const load = useCallback(async () => {
        try {
            const resp = await listMsms();
            setList(resp?.data?.integrations ?? []);
            setError('');
        } catch (err) {
            swallowed('msm-tab: list', err);
            setError(err?.message || String(err));
            setList([]);
        }
    }, []);

    // The ten that ship are a fact about the software, not about this site, so they are read once
    // and shown in section 04 whether or not anybody ever opens the writing screen.
    const loadTemplates = useCallback(async () => {
        try {
            const resp = await getMsmTemplates();
            setTemplates(resp?.data?.templates ?? []);
        } catch (err) { swallowed('msm-tab: templates', err); setTemplates([]); }
    }, []);

    useEffect(() => { load(); loadTemplates(); }, [load, loadTemplates]);
    useEffect(() => onLiveUpdate(['msm', 'features'], () => load()), [load]);

    const all = useMemo(() => list ?? [], [list]);
    const sets = useMemo(() => relatedSets(all), [all]);

    const facts = useMemo(() => {
        const newest = all.reduce((best, m) => {
            const at = m.updated_at || m.registered_at || '';
            return at > best ? at : best;
        }, '');
        const biggest = sets[0];
        return {
            all: all.length,
            needKey: all.filter(m => m.auth_type && m.auth_type !== 'none').length,
            biggestSet: biggest ? biggest.items.length : 0,
            biggestSetWhat: biggest
                ? (biggest.sharedHosts[0] || biggest.sharedActions[0] || '')
                : '',
            daysQuiet: daysSince(newest),
            copies: sets.reduce((s, x) => s + x.items.length - 1, 0),
        };
    }, [all, sets]);

    const matches = useCallback((m) => {
        const q = query.trim().toLowerCase();
        if (!q) return true;
        return [m.name, m.description, m.registered_by, m.category, m.auth_type, ...hostsOf(m), ...actionsOf(m)]
            .filter(Boolean).some(s => String(s).toLowerCase().includes(q));
    }, [query]);

    const shown = useMemo(() => all.filter(matches), [all, matches]);
    const shownSets = useMemo(() => relatedSets(shown), [shown]);

    const openDetail = useCallback(async (row) => {
        try {
            const resp = await getMsmDetail(row.name);
            const d = resp?.data;
            if (!d) { showErr(M('toast.noDetail', { name: row.name })); return; }
            setDetail({ msm: d, row });
            setEditing(false);
            setView('detail');
        } catch (err) { swallowed('msm-tab: detail', err); showErr(err?.message || String(err)); }
    }, [showErr]);

    const runAndReload = useCallback(async (fn, okText) => {
        setBusy(true);
        try {
            await fn();
            showOk(okText);
            await load();
            if (detail) {
                const resp = await getMsmDetail(detail.msm.name)
                    .catch((err) => { swallowed('msm-tab: detail refresh', err); return null; });
                setDetail(resp?.data ? { msm: resp.data, row: detail.row } : null);
                if (!resp?.data) setView('list');
            }
        } catch (err) { swallowed('msm-tab: action', err); showErr(err?.message || String(err)); }
        finally { setBusy(false); }
    }, [load, showOk, showErr, detail]);

    const doFederate = useCallback(() => {
        const m = detail?.msm;
        if (!m) return undefined;
        const next = !m.federate;
        return runAndReload(() => updateMsm(m.name, { federate: next }),
            next ? M('toast.federating', { name: m.name }) : M('toast.notFederating', { name: m.name }));
    }, [detail, runAndReload]);

    const doEditSave = useCallback(() => {
        const m = detail?.msm;
        if (!m) return undefined;
        setEditing(false);
        return runAndReload(() => updateMsm(m.name, { description: draft }),
            M('toast.described', { name: m.name }));
    }, [detail, draft, runAndReload]);

    const doDelete = useCallback(() => {
        const r = removing;
        if (!r || r.typed !== r.name) return undefined;
        setRemoving(null);
        setDetail(null);
        setView('list');
        return runAndReload(() => deleteMsm(r.name), M('toast.deleted', { name: r.name }));
    }, [removing, runAndReload]);

    const pickTemplate = useCallback(async (type) => {
        setBusy(true);
        setWriteErr('');
        try {
            const text = await getMsmTemplate(type);
            setYaml(text);
            setPicked(type);
            setView('write');
        } catch (err) { swallowed('msm-tab: template', err); showErr(err?.message || String(err)); }
        finally { setBusy(false); }
    }, [showErr]);

    const openWrite = useCallback(() => {
        setYaml('');
        setPicked('');
        setFederate(false);
        setWriteErr('');
        setView('write');
    }, []);

    const doSave = useCallback(async () => {
        if (!yaml.trim()) return;
        setBusy(true);
        setWriteErr('');
        try {
            await createMsm(yaml, federate);
            showOk(M('toast.written'));
            setYaml('');
            setPicked('');
            setFederate(false);
            setView('list');
            await load();
        } catch (err) {
            swallowed('msm-tab: create', err);
            setWriteErr(err?.message || String(err));
        } finally { setBusy(false); }
    }, [yaml, federate, load, showOk]);

    const removeDialog = () => html`
      <${Modal} open=${!!removing} onClose=${() => setRemoving(null)}
        title=${removing ? M('dialog.deleteTitle', { name: removing.name }) : ''}
        footer=${removing && html`
          <button type="button" class="og-door og-door--quiet" onClick=${() => setRemoving(null)}>${t('common.cancel')}</button>
          <button type="button" class="og-door og-door--quiet og-door--danger"
            disabled=${busy || removing.typed !== removing.name} onClick=${doDelete}>${M('deleteIt')}</button>`}>
        ${removing && html`
          <div class="og-box">
            <span class="og-box-label">${M('dialog.deleteWarnLabel')}</span>
            ${M('dialog.deleteWarn')}
          </div>
          <label class="adm-msm-field">
            <span>${M('dialog.deleteTypeLabel', { name: removing.name })}</span>
            <input class="adm-input mono" type="text" value=${removing.typed} placeholder=${removing.name}
              onInput=${ev => setRemoving({ ...removing, typed: ev.target.value })} />
          </label>`}
      <//>`;

    if (list === null) {
        return html`
      ${msg && html`<${Toast} type=${msg.type} text=${msg.text} onDismiss=${clearMsg} />`}
      <${Spinner} text=${t('dashboard.loading')} />`;
    }

    if (view === 'write') {
        return html`
      ${msg && html`<${Toast} type=${msg.type} text=${msg.text} onDismiss=${clearMsg} />`}
      <${MsmWrite} templates=${templates} picked=${picked} yaml=${yaml} federate=${federate}
        busy=${busy} err=${writeErr}
        onPick=${pickTemplate} onYaml=${setYaml} onFederate=${setFederate}
        onSave=${doSave} onCancel=${() => setView('list')} />`;
    }

    if (view === 'detail' && detail) {
        return html`
      ${msg && html`<${Toast} type=${msg.type} text=${msg.text} onDismiss=${clearMsg} />`}
      <${MsmDetail} msm=${detail.msm} row=${detail.row} busy=${busy} editing=${editing} draft=${draft}
        onBack=${() => { setView('list'); setEditing(false); }}
        onEditOpen=${() => { setDraft(detail.msm.definition?.service?.description || ''); setEditing(true); }}
        onEditChange=${setDraft}
        onEditSave=${doEditSave}
        onEditCancel=${() => setEditing(false)}
        onFederate=${doFederate}
        onDelete=${() => setRemoving({ name: detail.msm.name, typed: '' })} />
      ${removeDialog()}`;
    }

    let counter = 0;
    const n = () => String(++counter).padStart(2, '0');

    const row = (m) => html`
      <tr key=${m.name}>
        <td data-label=${M('col.name')}>
          <span class="adm-msm-name">
            <button type="button" onClick=${() => openDetail(m)}>${m.name}</button>
            <span class="adm-msm-chips">
              ${m.auth_type && m.auth_type !== 'none' && html`<${Badge} type="watch" label=${M('auth.' + m.auth_type)} />`}
              ${m.federate && html`<${Badge} type="info" label=${M('detail.federatedBadge')} />`}
            </span>
          </span>
          ${m.description && html`<span class="adm-msm-sub">${m.description}</span>`}
        </td>
        <td class="r" data-label=${M('col.calls')}>${hostsOf(m).join(', ') || M('detail.noHost')}</td>
        <td class="r" data-label=${M('col.actions')}>${actionsOf(m).join(', ') || '—'}</td>
        <td class="r" data-label=${M('col.by')}>${m.registered_by || '?'}</td>
        <td class="r" data-label=${M('col.registered')}>${dt(m.registered_at)}</td>
        <td>
          <div class="adm-msm-acts">
            <button type="button" class="og-door og-door--quiet" onClick=${() => openDetail(m)}>${M('open')}</button>
          </div>
        </td>
      </tr>`;

    const table = (rows) => html`
    <div class="adm-msm-scroll">
      <table class="adm-msm-tbl">
        <thead><tr>
          <th style="width: 36%">${M('col.name')}</th>
          <th class="r">${M('col.calls')}</th>
          <th class="r">${M('col.actions')}</th>
          <th class="r">${M('col.by')}</th>
          <th class="r">${M('col.registered')}</th>
          <th></th>
        </tr></thead>
        <tbody>${rows.map(row)}</tbody>
      </table>
    </div>`;

    const setBlock = (s, last) => {
        const open = openSet === s.key;
        const title = s.sharedHosts.length > 0
            ? M('sets.byHost', { n: num(s.items.length), host: s.sharedHosts[0] })
            : s.sharedActions.length > 0
                ? M('sets.byAction', { n: num(s.items.length), action: s.sharedActions[0] })
                : M('sets.byBoth', { n: num(s.items.length) });
        const why = s.sharedHosts.length > 0 ? M('sets.byHostWhy')
            : s.sharedActions.length > 0 ? M('sets.byActionWhy')
                : M('sets.byBothWhy');
        return html`
      <div class=${'adm-msm-set' + (last ? ' adm-msm-set--last' : '')} key=${s.key}>
        <div class="adm-msm-seth">
          <b>${title}</b>
          <span class="adm-msm-setacts">
            <button type="button" class="og-door og-door--quiet"
              onClick=${() => setOpenSet(open ? '' : s.key)}>${open ? M('sets.hide') : M('sets.compare')}</button>
          </span>
        </div>
        <span class="adm-msm-setnames">${s.items.map((m, i) => html`${i > 0 ? ' · ' : ''}${m.name}`)}</span>
        <span class="adm-msm-setwhy">${why}</span>
        ${open && html`<div class="adm-msm-open">${table(s.items)}</div>`}
      </div>`;
    };

    const alone = loneOnes(shown, shownSets);

    return html`
    <div class="adm-msm">
      ${msg && html`<${Toast} type=${msg.type} text=${msg.text} onDismiss=${clearMsg} />`}
      <p class="adm-msm-intro">${M('intro')}</p>
      ${error && html`<${ErrorBox} message=${error} />`}

      <${RightNow} facts=${facts} number=${n()} onWrite=${openWrite} />

      <section class="og-sec" id="adm-msm-list">
        <div class="og-sec-h"><h2>${M('list.title')}<small>${n()}</small></h2>
          <div class="og-doors"><span class="adm-msm-note">${M('list.count', { n: num(shown.length), total: num(facts.all) })}</span></div></div>

        <div class="adm-msm-tools">
          <span class="adm-msm-find">
            <svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" /></svg>
            <input type="text" value=${query} placeholder=${M('list.find')}
              onInput=${ev => setQuery(ev.target.value)} />
          </span>
        </div>

        ${shown.length === 0
          ? html`<p class="adm-msm-note">${query ? M('list.noMatch') : M('list.none')}</p>`
          : table(shown)}
      </section>

      <section class="og-sec" id="adm-msm-sets">
        <div class="og-sec-h"><h2>${M('sets.title')}<small>${n()}</small></h2>
          <div class="og-doors"><span class="adm-msm-note">${(() => {
            const copies = shownSets.reduce((s, x) => s + x.items.length - 1, 0);
            return copies === 0 ? M('sets.countNone')
              : copies === 1 ? M('sets.countOne')
                : M('sets.count', { n: num(copies) });
          })()}</span></div></div>
        ${shownSets.length === 0
          ? html`<p class="adm-msm-note">${M('sets.none')}</p>`
          : html`
            <p class="adm-msm-lead">${M('sets.lead', { n: num(shownSets.reduce((s, x) => s + x.items.length, 0)), total: num(shown.length) })}</p>
            ${shownSets.map((s, i) => setBlock(s, i === shownSets.length - 1 && alone.length === 0))}
            ${alone.length > 0 && html`
              <div class="adm-msm-set adm-msm-set--last">
                <div class="adm-msm-seth"><b>${alone.length === 1 ? M('sets.aloneOne') : M('sets.alone', { n: num(alone.length) })}</b></div>
                <span class="adm-msm-setnames">${alone.map((m, i) => html`${i > 0 ? ' · ' : ''}${m.name}`)}</span>
                <span class="adm-msm-setwhy">${alone.length === 1 ? M('sets.aloneOneWhy') : M('sets.aloneWhy')}</span>
              </div>`}`}
      </section>

      <${ReadyMade} templates=${templates} number=${n()} onPick=${pickTemplate} />
      <${WhatItTakes} facts=${facts} number=${n()} />

      ${removeDialog()}
    </div>`;
}
