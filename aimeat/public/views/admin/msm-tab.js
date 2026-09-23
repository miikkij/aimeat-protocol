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
 *   v3.0.0 -- 2026-09-22 -- Composed from the shared component set: sections, the numeral band, the
 *     shared table (stacking on a phone), sets and ready-made ones as list rows, the shared dialog
 *     with its aside and field. The page's own sheet is gone.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v2.1.0 — 2026-09-13 — Compose shared B1 headings and stylesheet-owned layout.
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
import { Section, Columns, Stack, ListRow, KeyValue, NumeralBand, Table, Toolbar, Field, Dialog, Action, Surface, Text } from '/components/poster-parts.js';
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
    return html`<${Section} id="adm-msm-now" title=${M('now.title')} count=${number}
      actions=${html`<${Action} kind="primary" onClick=${onWrite}>${M('writeNew')}<//>`}>
      <${Stack}>
        <${NumeralBand} tone="plain" items=${[
          { label: M('strip.registered'), value: num(facts.all), note: M('strip.registeredSub') },
          { label: M('strip.needKey'), value: num(facts.needKey), note: M('strip.needKeySub') },
          { label: M('strip.repeated'), value: num(facts.biggestSet), note: facts.biggestSetWhat || M('strip.repeatedNone'), tone: 'coral' },
          { label: M('strip.quiet'), value: num(facts.daysQuiet), note: M('strip.quietSub') },
        ]} />
        <${Text} kind="lead">${M('now.line')}<//>
      <//>
    <//>`;
}

/** Section 04: the ten that ship with the software, and the fact that none of them is in use. */
function ReadyMade({ templates, number, onPick }) {
    const list = Array.isArray(templates) ? templates : [];
    const half = Math.ceil(list.length / 2);
    const row = (ft) => html`<${ListRow} key=${ft.type} name=${ft.name} detail=${ft.description} detailKind="text"
      actions=${html`<${Action} onClick=${() => onPick(ft.type)}>${M('write.start')}<//>`} />`;
    return html`<${Section} id="adm-msm-ready" title=${M('ready.title')} count=${number} description=${M('ready.lead')}
      actions=${html`<${Text} kind="caption" tone="muted">${M('ready.count', { n: num(list.length) })}<//>`}>
      ${list.length === 0
        ? html`<${Text} kind="caption" tone="muted">${M('write.noTemplates')}<//>`
        : html`<${Columns} collapse=${900}>
            <div>${list.slice(0, half).map(row)}</div>
            <div>${list.slice(half).map(row)}</div>
          <//>`}
    <//>`;
}

/** Section 05: the key, who may read them, who may write one, and what travels. */
function WhatItTakes({ facts, number }) {
    const row = (key) => html`<${KeyValue} label=${M('takes.' + key)} value=${M('takes.' + key + 'Why')} />`;
    return html`<${Section} id="adm-msm-takes" title=${M('takes.title')} count=${number}>
      <${Stack}>
        <div>${row('key')}${row('public')}${row('write')}${row('travel')}</div>
        <${Surface} kind="aside"><${Stack} density="compact">
          <${Text} kind="label">${M('takes.boxLabel')}<//>
          <${Text}>${M('takes.box', { days: num(facts.daysQuiet) })}<//>
        <//><//>
      <//>
    <//>`;
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
      <${Dialog} open=${!!removing} onClose=${() => setRemoving(null)}
        title=${removing ? M('dialog.deleteTitle', { name: removing.name }) : ''}
        actions=${removing && html`
          <${Action} kind="text" onClick=${() => setRemoving(null)}>${t('common.cancel')}<//>
          <${Action} kind="primary" tone="danger"
            disabled=${busy || removing.typed !== removing.name} onClick=${doDelete}>${M('deleteIt')}<//>`}>
        ${removing && html`<${Stack}>
          <${Surface} kind="aside" tone="danger"><${Stack} density="compact">
            <${Text} kind="label">${M('dialog.deleteWarnLabel')}<//>
            <${Text}>${M('dialog.deleteWarn')}<//>
          <//><//>
          <${Field} label=${M('dialog.deleteTypeLabel', { name: removing.name })} value=${removing.typed}
            placeholder=${removing.name} passwordManager=${false}
            onInput=${ev => setRemoving({ ...removing, typed: ev.target.value })} />
        <//>`}
      <//>`;

    if (list === null) {
        return html`<${Stack}>
      ${msg && html`<${Toast} type=${msg.type} text=${msg.text} onDismiss=${clearMsg} />`}
      <${Spinner} text=${t('dashboard.loading')} />
    <//>`;
    }

    if (view === 'write') {
        return html`<${Stack}>
      ${msg && html`<${Toast} type=${msg.type} text=${msg.text} onDismiss=${clearMsg} />`}
      <${MsmWrite} templates=${templates} picked=${picked} yaml=${yaml} federate=${federate}
        busy=${busy} err=${writeErr}
        onPick=${pickTemplate} onYaml=${setYaml} onFederate=${setFederate}
        onSave=${doSave} onCancel=${() => setView('list')} />
    <//>`;
    }

    if (view === 'detail' && detail) {
        return html`<${Stack}>
      ${msg && html`<${Toast} type=${msg.type} text=${msg.text} onDismiss=${clearMsg} />`}
      <${MsmDetail} msm=${detail.msm} row=${detail.row} busy=${busy} editing=${editing} draft=${draft}
        onBack=${() => { setView('list'); setEditing(false); }}
        onEditOpen=${() => { setDraft(detail.msm.definition?.service?.description || ''); setEditing(true); }}
        onEditChange=${setDraft}
        onEditSave=${doEditSave}
        onEditCancel=${() => setEditing(false)}
        onFederate=${doFederate}
        onDelete=${() => setRemoving({ name: detail.msm.name, typed: '' })} />
      ${removeDialog()}
    <//>`;
    }

    let counter = 0;
    const n = () => String(++counter).padStart(2, '0');

    const row = (m) => [
      html`<${Stack} density="compact">
        <${Stack} direction="wrap" align="center" density="compact">
          <${Action} kind="text" onClick=${() => openDetail(m)}>${m.name}<//>
          ${m.auth_type && m.auth_type !== 'none' && html`<${Badge} type="watch" label=${M('auth.' + m.auth_type)} />`}
          ${m.federate && html`<${Badge} type="info" label=${M('detail.federatedBadge')} />`}
        <//>
        ${m.description && html`<${Text} kind="caption" tone="muted">${m.description}<//>`}
      <//>`,
      { text: hostsOf(m).join(', ') || M('detail.noHost'), mono: true },
      { text: actionsOf(m).join(', ') || '—', mono: true },
      m.registered_by || '?',
      { text: dt(m.registered_at), mono: true },
      html`<${Action} onClick=${() => openDetail(m)}>${M('open')}<//>`,
    ];

    const table = (rows) => html`<${Table} collapse=${900} label=${M('list.title')}
      headers=${[M('col.name'), M('col.calls'), M('col.actions'), M('col.by'), M('col.registered'), '']}
      rows=${rows.map(row)} />`;

    const setBlock = (s) => {
        const open = openSet === s.key;
        const title = s.sharedHosts.length > 0
            ? M('sets.byHost', { n: num(s.items.length), host: s.sharedHosts[0] })
            : s.sharedActions.length > 0
                ? M('sets.byAction', { n: num(s.items.length), action: s.sharedActions[0] })
                : M('sets.byBoth', { n: num(s.items.length) });
        const why = s.sharedHosts.length > 0 ? M('sets.byHostWhy')
            : s.sharedActions.length > 0 ? M('sets.byActionWhy')
                : M('sets.byBothWhy');
        return html`<${ListRow} key=${s.key} name=${title} open=${open}
          detail=${s.items.map(m => m.name).join(' · ')}
          actions=${html`<${Action} expanded=${open} onClick=${() => setOpenSet(open ? '' : s.key)}>${open ? M('sets.hide') : M('sets.compare')}<//>`}>
          <${Stack}>
            <${Text} kind="caption" tone="muted">${why}<//>
            ${open && table(s.items)}
          <//>
        <//>`;
    };

    const alone = loneOnes(shown, shownSets);
    const copies = shownSets.reduce((acc, x) => acc + x.items.length - 1, 0);

    return html`<${Stack}>
      ${msg && html`<${Toast} type=${msg.type} text=${msg.text} onDismiss=${clearMsg} />`}
      <${Text} kind="lead">${M('intro')}<//>
      ${error && html`<${ErrorBox} message=${error} />`}

      <${RightNow} facts=${facts} number=${n()} onWrite=${openWrite} />

      <${Section} id="adm-msm-list" title=${M('list.title')} count=${n()}
        actions=${html`<${Text} kind="caption" tone="muted">${M('list.count', { n: num(shown.length), total: num(facts.all) })}<//>`}>
        <${Stack}>
          <${Toolbar} search=${{ ariaLabel: M('list.find'), placeholder: M('list.find'), value: query, onInput: ev => setQuery(ev.target.value) }} />
          ${shown.length === 0
            ? html`<${Text} kind="caption" tone="muted">${query ? M('list.noMatch') : M('list.none')}<//>`
            : table(shown)}
        <//>
      <//>

      <${Section} id="adm-msm-sets" title=${M('sets.title')} count=${n()}
        description=${shownSets.length ? M('sets.lead', { n: num(shownSets.reduce((acc, x) => acc + x.items.length, 0)), total: num(shown.length) }) : null}
        actions=${html`<${Text} kind="caption" tone="muted">${copies === 0 ? M('sets.countNone')
          : copies === 1 ? M('sets.countOne')
            : M('sets.count', { n: num(copies) })}<//>`}>
        ${shownSets.length === 0
          ? html`<${Text} kind="caption" tone="muted">${M('sets.none')}<//>`
          : html`<div>
            ${shownSets.map((s) => setBlock(s))}
            ${alone.length > 0 && html`<${ListRow} name=${alone.length === 1 ? M('sets.aloneOne') : M('sets.alone', { n: num(alone.length) })}
              detail=${alone.map(m => m.name).join(' · ')}>
              <${Text} kind="caption" tone="muted">${alone.length === 1 ? M('sets.aloneOneWhy') : M('sets.aloneWhy')}<//>
            <//>`}
          </div>`}
      <//>

      <${ReadyMade} templates=${templates} number=${n()} onPick=${pickTemplate} />
      <${WhatItTakes} facts=${facts} number=${n()} />

      ${removeDialog()}
    <//>`;
}
