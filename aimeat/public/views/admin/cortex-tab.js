/**
 * @file cortex-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin Cortex extensions page in the poster face (design canvas "Cortex Extensions
 *   Page", direction A): what is installed, what any app actually loads, what nothing loads, what
 *   turning one off costs, and who may read the insides.
 *
 *   THE PAGE IS ARRANGED BY WHAT SWITCHING SOMETHING OFF WOULD COST. The old one counted 70
 *   installed, 70 active, 0 inactive, which is three numbers that never move and no question
 *   anybody has, and then listed seventy rows alphabetically.
 *
 *   THE DEPENDANT COUNT WAS IN THE ANSWER ALL ALONG. `GET /v1/cortex` has carried `used_by` since
 *   September, and this page threw it away while offering Deactivate as a one-click button on
 *   every row. Twelve apps load the busiest one and they break on their next open, with no warning
 *   to them and none to the operator. The count is now the column the list is sorted by, and the
 *   confirmation names the apps before it does anything.
 *
 *   TWENTY-SEVEN OF SIXTY-ONE ARE LOADED BY NOTHING. Section 03 arranges them by facts the
 *   operator can check: names that look like the same thing twice, batches put here by one person
 *   on one day, and the kit this site ships and nobody asked for, where doing nothing is right.
 * @structure CortexTab (default) · RightNow · WhatOffDoes · WhoCanRead
 * @usage Mounted by the admin dashboard tab router (views/admin.js).
 * @version-history
 *   v2.0.1 — 2026-09-13 — The turn-off, remove and remove-all dialogs' actions sit in the dialog's footer.
 *   v2.0.0 — 2026-09-12 — The poster face: five numbered sections, the dependant count the page had
 *     been discarding, the unused ones grouped, a confirmation that names what breaks, and removal
 *     behind the typed name. Values reach the template unescaped: htm escapes every interpolation
 *     on render, so the escHtml() the old tab wrapped names in showed a literal &amp; to anyone
 *     whose cortex description had an ampersand in it.
 *   v1.1.0 — 2026-09-05 — The per-component emoji icons go; the type word carries the row.
 *   v1.0.0 — 2026-03-17 — Initial admin cortex management tab
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useMemo } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { num, day, Badge, Spinner, ErrorBox, useToast, Toast } from './shared.js';
import { Modal } from '/components/Modal.js';
import { swallowed } from '/js/swallowed.js';
import * as cortexService from '/js/services/cortex.js';
import { groupUnused, isSiteOwn } from './cortex-tab.groups.js';
import CortexDetail from './cortex-tab.detail.js';

const html = htm.bind(h);
const C = (key, params) => t('admin.cortex.' + key, params);

/** How many apps load this one, which is the number every arrangement on this page turns on. */
const appsOf = (e) => e?.used_by?.apps ?? 0;

/** Scroll a section into view from a numeral in the strip. */
function goTo(id) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Section 01: the four numbers, and the sentence that says which of them needs a decision. */
function RightNow({ facts, number, onBusiest }) {
    return html`
    <section class="og-sec og-sec--first" id="adm-cx-now">
      <div class="og-sec-h"><h2>${C('now.title')}<small>${number}</small></h2></div>
      <div class="og-strip">
        <div><b>${num(facts.all)}</b><span>${C('strip.installed')}</span><small>${C('strip.installedSub')}</small></div>
        <button type="button" onClick=${() => goTo('adm-cx-loaded')}>
          <b>${num(facts.carrying)}</b><span>${C('strip.carrying')}</span><small>${C('strip.carryingSub')}</small></button>
        <button type="button" onClick=${() => goTo('adm-cx-unused')}>
          <b class="og-coral-num">${num(facts.unused)}</b>
          <span>${C('strip.unused')}</span><small>${C('strip.unusedSub')}</small></button>
        <button type="button" onClick=${onBusiest}>
          <b>${num(facts.busiest)}</b><span>${C('strip.busiest')}</span>
          <small>${facts.busiestName || C('strip.busiestNone')}</small></button>
      </div>
      <p class="adm-alert-line">${facts.off > 0
        ? C('now.lineOff', { off: num(facts.off), breaking: num(facts.offButLoaded) })
        : C('now.line', { n: num(facts.all), unused: num(facts.unused) })}</p>
    </section>`;
}

/** Section 04: what off actually does, and why removing is the one that cannot be taken back. */
function WhatOffDoes({ number }) {
    const step = (i, key, last) => html`
    <div class=${'adm-cx-step' + (last ? ' adm-cx-step--last' : '')}>
      <span class="adm-cx-stepn">${String(i).padStart(2, '0')}</span>
      <span><b>${C('off.' + key)}</b><span class="adm-why">${C('off.' + key + 'Why')}</span></span>
    </div>`;
    return html`
    <section class="og-sec" id="adm-cx-off">
      <div class="og-sec-h"><h2>${C('off.title')}<small>${number}</small></h2></div>
      ${step(1, 'goes')}
      ${step(2, 'stays')}
      ${step(3, 'remove', true)}
    </section>`;
}

/** Section 05: the visibility word, which decides who may read the insides and nothing else. */
function WhoCanRead({ facts, number }) {
    const row = (key, value, last) => html`
    <div class=${'adm-mrow adm-mrow--two' + (last ? ' adm-mrow--last' : '')}>
      <span><b>${C('read.' + key)}</b><span class="adm-why">${C('read.' + key + 'Why')}</span></span>
      <span class="adm-mval">${value}</span>
    </div>`;
    return html`
    <section class="og-sec" id="adm-cx-read">
      <div class="og-sec-h"><h2>${C('read.title')}<small>${number}</small></h2></div>
      <p class="adm-cx-lead">${C('read.lead')}</p>
      ${row('public', num(facts.publicCount))}
      ${row('private', num(facts.privateCount))}
      ${row('site', num(facts.siteCount), true)}
      <div class="og-box" style="margin-top: 16px">
        <span class="og-box-label">${C('read.boxLabel')}</span>
        ${C('read.box', { n: num(facts.all) })}
      </div>
    </section>`;
}

export default function CortexTab() {
    const [msg, showErr, showOk, clearMsg] = useToast();
    const [list, setList] = useState(null);
    const [error, setError] = useState('');
    const [detail, setDetail] = useState(null);
    const [query, setQuery] = useState('');
    const [busy, setBusy] = useState(false);
    const [openGroup, setOpenGroup] = useState('');
    const [turningOff, setTurningOff] = useState(null);
    const [removing, setRemoving] = useState(null);
    const [removingBatch, setRemovingBatch] = useState(null);

    const load = useCallback(async () => {
        try {
            const resp = await cortexService.listExtensions();
            setList(resp?.extensions ?? []);
            setError('');
        } catch (err) {
            swallowed('cortex-tab: list', err);
            setError(err?.message || String(err));
            setList([]);
        }
    }, []);

    useEffect(() => { load(); }, [load]);
    useEffect(() => onLiveUpdate(['cortex'], () => load()), [load]);

    const all = useMemo(() => list ?? [], [list]);

    const facts = useMemo(() => {
        const carrying = all.filter(e => appsOf(e) > 0);
        let busiest = null;
        for (const e of all) if (!busiest || appsOf(e) > appsOf(busiest)) busiest = e;
        const off = all.filter(e => e.status !== 'active');
        return {
            all: all.length,
            carrying: carrying.length,
            unused: all.length - carrying.length,
            busiest: busiest ? appsOf(busiest) : 0,
            busiestName: busiest && appsOf(busiest) > 0 ? busiest.name : '',
            off: off.length,
            offButLoaded: off.filter(e => appsOf(e) > 0).length,
            // Section 05 reads as a breakdown, so it has to be one: every cortex in exactly one
            // row. Counting public across everything put the site's own public kit in two rows at
            // once and the three numbers came to 27 against a total of 20.
            publicCount: all.filter(e => e.visibility === 'public' && !isSiteOwn(e)).length,
            privateCount: all.filter(e => e.visibility !== 'public' && !isSiteOwn(e)).length,
            siteCount: all.filter(e => isSiteOwn(e)).length,
        };
    }, [all]);

    /** The search reaches everything a person might remember about one: name, owner, tags, words. */
    const matches = useCallback((e) => {
        const q = query.trim().toLowerCase();
        if (!q) return true;
        return [e.name, e.installed_by, e.author, e.namespace, e.description, ...(e.tags ?? [])]
            .filter(Boolean).some(s => String(s).toLowerCase().includes(q));
    }, [query]);

    const loaded = useMemo(
        () => all.filter(e => appsOf(e) > 0).filter(matches)
            .sort((a, b) => appsOf(b) - appsOf(a) || a.name.localeCompare(b.name)),
        [all, matches],
    );
    const groups = useMemo(
        () => groupUnused(all, all.filter(e => appsOf(e) === 0).filter(matches)),
        [all, matches],
    );
    const unusedShown = useMemo(
        () => groups.reduce((s, g) => s + g.items.filter(e => appsOf(e) === 0).length, 0),
        [groups],
    );

    const openDetail = useCallback(async (row) => {
        try {
            const d = await cortexService.getExtensionDetail(row.name);
            if (d) setDetail({ ext: d, row });
            else showErr(C('toast.noDetail', { name: row.name }));
        } catch (err) { swallowed('cortex-tab: detail', err); showErr(err?.message || String(err)); }
    }, [showErr]);

    const runAndReload = useCallback(async (fn, okText) => {
        setBusy(true);
        try {
            await fn();
            showOk(okText);
            await load();
            if (detail) {
                // The open screen is refreshed so its status, versions and pieces match what just
                // happened. A cortex that was REMOVED no longer reads, and that is the one case
                // where closing the screen is the right answer rather than an error.
                const d = await cortexService.getExtensionDetail(detail.ext.name)
                    .catch((err) => { swallowed('cortex-tab: detail refresh', err); return null; });
                setDetail(d ? { ext: d, row: detail.row } : null);
            }
        } catch (err) { swallowed('cortex-tab: action', err); showErr(err?.message || String(err)); }
        finally { setBusy(false); }
    }, [load, showOk, showErr, detail]);

    const doTurnOn = useCallback((e) => runAndReload(
        () => cortexService.activateExtension(e.name), C('toast.turnedOn', { name: e.name })), [runAndReload]);

    const doTurnOff = useCallback(() => {
        const e = turningOff;
        if (!e) return undefined;
        setTurningOff(null);
        return runAndReload(() => cortexService.deactivateExtension(e.name), C('toast.turnedOff', { name: e.name }));
    }, [turningOff, runAndReload]);

    const doVisibility = useCallback((e) => runAndReload(
        () => cortexService.toggleVisibility(e.name, e.visibility || 'private'),
        C('toast.visibility', { name: e.name })), [runAndReload]);

    const doRemove = useCallback(() => {
        const e = removing;
        if (!e || e.typed !== e.name) return undefined;
        setRemoving(null);
        setDetail(null);
        return runAndReload(() => cortexService.uninstallExtension(e.name), C('toast.removed', { name: e.name }));
    }, [removing, runAndReload]);

    /**
     * A batch removal is one decision about a set the page defined and printed in full, so it asks
     * for one typed word rather than one typed name per item. Each removal is its own call and a
     * failure stops nothing: the toast says how many went and how many refused, because half a
     * batch having gone is a fact the operator needs rather than an error to swallow.
     */
    const doRemoveBatch = useCallback(async () => {
        const g = removingBatch;
        if (!g || g.typed !== C('dialog.removeWord')) return;
        setRemovingBatch(null);
        setBusy(true);
        let gone = 0;
        let kept = 0;
        for (const e of g.items) {
            try { await cortexService.uninstallExtension(e.name); gone++; }
            catch (err) { swallowed('cortex-tab: batch remove', err); kept++; }
        }
        if (kept > 0) showErr(C('toast.batchPartly', { gone: num(gone), kept: num(kept) }));
        else showOk(C('toast.batchRemoved', { n: num(gone) }));
        await load();
        setBusy(false);
    }, [removingBatch, load, showOk, showErr]);

    /** The confirmation the old page did not have: what loads this, before anything happens. */
    const offDialog = () => {
        const e = turningOff;
        const apps = appsOf(e);
        const names = e?.used_by?.app_names ?? [];
        return html`
      <${Modal} open=${!!e} onClose=${() => setTurningOff(null)} title=${e ? C('dialog.offTitle', { name: e.name }) : ''}
        footer=${e && html`
          <button type="button" class="og-door og-door--quiet" onClick=${() => setTurningOff(null)}>${t('common.cancel')}</button>
          <button type="button" class="adm-btn" disabled=${busy} onClick=${doTurnOff}>
            ${apps === 0 ? C('dialog.offDo')
              : apps === 1 ? C('dialog.offDoForOne')
                : C('dialog.offDoFor', { n: num(apps) })}</button>`}>
        ${e && html`
          ${apps > 0
            ? html`
              <p class="adm-cx-big">${apps === 1 ? C('dialog.offLoadedOne') : C('dialog.offLoaded', { n: num(apps) })}</p>
              <p class="adm-cx-applist">${names.map((a, i) => html`${i > 0 ? ' · ' : ''}${a}`)}
                ${apps > names.length ? html` ${C('detail.andMore', { n: num(apps - names.length) })}` : ''}</p>
              <p class="adm-cx-lead" style="margin-top: 14px">${C('dialog.offBreaks')}</p>`
            : html`<p class="adm-cx-lead" style="margin-top: 6px">${C('dialog.offNobody')}</p>`}
          <div class="adm-mrow adm-mrow--two">
            <span><b>${C('dialog.goes')}</b><span class="adm-why">${C('dialog.goesWhy')}</span></span>
            <span class="adm-mval"></span>
          </div>
          <div class="adm-mrow adm-mrow--two adm-mrow--last">
            <span><b>${C('dialog.stays')}</b><span class="adm-why">${C('dialog.staysWhy')}</span></span>
            <span class="adm-mval"></span>
          </div>`}
      <//>`;
    };

    const removeDialog = () => html`
      <${Modal} open=${!!removing} onClose=${() => setRemoving(null)}
        title=${removing ? C('dialog.removeTitle', { name: removing.name }) : ''}
        footer=${removing && html`
          <button type="button" class="og-door og-door--quiet" onClick=${() => setRemoving(null)}>${t('common.cancel')}</button>
          <button type="button" class="og-door og-door--quiet og-door--danger"
            disabled=${busy || removing.typed !== removing.name} onClick=${doRemove}>${C('removeForGood')}</button>`}>
        ${removing && html`
          <div class="og-box">
            <span class="og-box-label">${C('dialog.removeWarnLabel')}</span>
            ${C('dialog.removeWarn')}
          </div>
          <label class="adm-cx-field">
            <span>${C('dialog.removeTypeLabel', { name: removing.name })}</span>
            <input class="adm-input mono" type="text" value=${removing.typed} placeholder=${removing.name}
              onInput=${ev => setRemoving({ ...removing, typed: ev.target.value })} />
          </label>`}
      <//>`;

    if (list === null) {
        return html`
      ${msg && html`<${Toast} type=${msg.type} text=${msg.text} onDismiss=${clearMsg} />`}
      <${Spinner} text=${t('dashboard.loading')} />`;
    }

    if (detail) {
        return html`
      ${msg && html`<${Toast} type=${msg.type} text=${msg.text} onDismiss=${clearMsg} />`}
      <${CortexDetail} ext=${detail.ext} row=${detail.row} busy=${busy}
        onBack=${() => setDetail(null)}
        onTurnOff=${() => setTurningOff(detail.row)}
        onTurnOn=${() => doTurnOn(detail.ext)}
        onVisibility=${() => doVisibility(detail.ext)}
        onRemove=${() => setRemoving({ name: detail.ext.name, typed: '' })} />
      ${offDialog()}
      ${removeDialog()}`;
    }

    let counter = 0;
    const n = () => String(++counter).padStart(2, '0');

    /** One row of the table, used by both sections so a cortex reads the same wherever it sits. */
    const row = (e) => {
        const on = e.status === 'active';
        const apps = appsOf(e);
        const names = e.used_by?.app_names ?? [];
        return html`
      <tr class=${on ? '' : 'adm-cx-row--off'} key=${e.name}>
        <td data-label=${C('col.name')}>
          <span class="adm-cx-name">
            <button type="button" onClick=${() => openDetail(e)}>${e.name}</button>
            <span class="adm-cx-chips">
              ${isSiteOwn(e) && html`<${Badge} type="muted" label=${C('thisSite')} />`}
              ${e.visibility === 'public' && html`<${Badge} type="public" label=${C('read.public')} />`}
              ${!on && html`<${Badge} type="warning" label=${C('state.off')} />`}
            </span>
          </span>
          ${names.length > 0 && html`<span class="adm-cx-apps">${names.map((a, i) => html`${i > 0 ? ' · ' : ''}${a}`)}${apps > names.length ? html` ${C('detail.andMore', { n: num(apps - names.length) })}` : ''}</span>`}
        </td>
        <td class="r" data-label=${C('col.version')}>${e.version || '?'}</td>
        <td class="r" data-label=${C('col.by')}>${isSiteOwn(e) ? C('thisSite') : (e.installed_by || '?')}</td>
        <td class="r" data-label=${C('col.apps')}>
          <span class=${apps > 0 ? 'adm-cx-n' : 'adm-cx-n--zero'}>${num(apps)}</span></td>
        <td class="r" data-label=${C('col.pieces')}>${(e.component_types ?? []).join(', ') || '—'}</td>
        <td>
          <div class="adm-cx-acts">
            ${on
              ? html`<button type="button" class="og-door og-door--quiet" disabled=${busy}
                  onClick=${() => setTurningOff(e)}>${C('turnOff')}</button>`
              : html`<button type="button" class="og-door og-door--quiet" disabled=${busy}
                  onClick=${() => doTurnOn(e)}>${C('turnOn')}</button>`}
            <button type="button" class="og-door og-door--quiet" onClick=${() => openDetail(e)}>${C('look')}</button>
          </div>
        </td>
      </tr>`;
    };

    const table = (rows) => html`
    <div class="adm-cx-scroll">
      <table class="adm-cx-tbl">
        <thead><tr>
          <th style="width: 42%">${C('col.name')}</th>
          <th class="r">${C('col.version')}</th>
          <th class="r">${C('col.by')}</th>
          <th class="r">${C('col.apps')}</th>
          <th class="r">${C('col.pieces')}</th>
          <th></th>
        </tr></thead>
        <tbody>${rows.map(row)}</tbody>
      </table>
    </div>`;

    /** A group in section 03: the fact that made it, the names in it, and the way in. */
    const groupBlock = (g, last) => {
        const title = g.kind === 'lookalike' ? C('group.lookalike', { n: num(g.items.length) })
            : g.kind === 'batch' ? C('group.batch', { n: num(g.items.length), who: g.by || '?', day: day(g.day) })
                : g.kind === 'site' ? C('group.site', { n: num(g.items.length) })
                    : g.items[0].name;
        const why = g.kind === 'lookalike' ? C('group.' + g.reason + 'Why')
            : g.kind === 'batch' ? C('group.batchWhy')
                : g.kind === 'site' ? C('group.siteWhy')
                    : C('group.oneWhy', { when: day(g.items[0].installed_at), who: g.items[0].installed_by || '?' });
        const open = openGroup === g.key;
        return html`
      <div class=${'adm-cx-grp' + (last ? ' adm-cx-grp--last' : '')} key=${g.key}>
        <div class="adm-cx-grph">
          <b>${title}</b>
          <span class="adm-cx-grpacts">
            <button type="button" class="og-door og-door--quiet"
              onClick=${() => setOpenGroup(open ? '' : g.key)}>${open ? C('group.close') : C('group.show')}</button>
            ${g.kind === 'batch' && html`<button type="button" class="og-door og-door--quiet og-door--danger"
              disabled=${busy}
              onClick=${() => setRemovingBatch({ ...g, typed: '' })}>${C('group.removeAll', { n: num(g.items.length) })}</button>`}
          </span>
        </div>
        <span class="adm-cx-names">${g.items.map((e, i) => html`${i > 0 ? ' · ' : ''}${e.name}`)}</span>
        <span class="adm-cx-grpwhy">${why}</span>
        ${open && html`<div class="adm-cx-open">${table(g.items)}</div>`}
      </div>`;
    };

    return html`
    <div class="adm-cx">
      ${msg && html`<${Toast} type=${msg.type} text=${msg.text} onDismiss=${clearMsg} />`}
      <p class="adm-cx-intro">${C('intro')}</p>
      ${error && html`<${ErrorBox} message=${error} />`}

      <${RightNow} facts=${facts} number=${n()} onBusiest=${() => setQuery(facts.busiestName)} />

      <section class="og-sec" id="adm-cx-loaded">
        <div class="og-sec-h"><h2>${C('loaded.title')}<small>${n()}</small></h2>
          <div class="og-doors"><span class="adm-cx-note">${C('loaded.count', { n: num(loaded.length), total: num(facts.all) })}</span></div></div>

        <div class="adm-cx-tools">
          <span class="adm-cx-find">
            <svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" /></svg>
            <input type="text" value=${query} placeholder=${C('find.placeholder')}
              onInput=${ev => setQuery(ev.target.value)} />
          </span>
        </div>

        ${loaded.length === 0
          ? html`<p class="adm-cx-note">${query ? C('loaded.noMatch') : C('loaded.none')}</p>`
          : table(loaded)}
      </section>

      <section class="og-sec" id="adm-cx-unused">
        <div class="og-sec-h"><h2>${C('unused.title')}<small>${n()}</small></h2>
          <div class="og-doors"><span class="adm-cx-note">${C('unused.count', { n: num(unusedShown), total: num(facts.all) })}</span></div></div>
        <p class="adm-cx-lead">${C('unused.lead')}</p>
        ${groups.length === 0
          ? html`<p class="adm-cx-note">${query ? C('loaded.noMatch') : C('unused.none')}</p>`
          : groups.map((g, i) => groupBlock(g, i === groups.length - 1))}
      </section>

      <${WhatOffDoes} number=${n()} />
      <${WhoCanRead} facts=${facts} number=${n()} />

      ${offDialog()}
      ${removeDialog()}

      <${Modal} open=${!!removingBatch} onClose=${() => setRemovingBatch(null)} title=${C('dialog.batchTitle')}
        footer=${removingBatch && html`
          <button type="button" class="og-door og-door--quiet" onClick=${() => setRemovingBatch(null)}>${t('common.cancel')}</button>
          <button type="button" class="og-door og-door--quiet og-door--danger"
            disabled=${busy || removingBatch.typed !== C('dialog.removeWord')}
            onClick=${doRemoveBatch}>${C('group.removeAll', { n: num(removingBatch.items.length) })}</button>`}>
        ${removingBatch && html`
          <p>${C('dialog.batchAsk', { n: num(removingBatch.items.length) })}</p>
          <p class="adm-cx-applist">${removingBatch.items.map((e, i) => html`${i > 0 ? ' · ' : ''}${e.name}`)}</p>
          <div class="og-box" style="margin-top: 14px">
            <span class="og-box-label">${C('dialog.removeWarnLabel')}</span>
            ${C('dialog.batchWarn')}
          </div>
          <label class="adm-cx-field">
            <span>${C('dialog.batchTypeLabel', { word: C('dialog.removeWord') })}</span>
            <input class="adm-input mono" type="text" value=${removingBatch.typed} placeholder=${C('dialog.removeWord')}
              onInput=${ev => setRemovingBatch({ ...removingBatch, typed: ev.target.value })} />
          </label>`}
      <//>
    </div>`;
}
