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
 *   v3.0.0 -- 2026-09-22 -- Composed from the shared component set: sections, the numeral band whose
 *     figures scroll to their section, the shared table (stacking on a phone), groups as list rows,
 *     the shared dialog with its aside and field. The page's own sheet is gone.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v2.1.0 — 2026-09-13 — Compose shared B1 headings; move existing layout values to the view sheet.
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
import { num, day, Badge, Row, Spinner, ErrorBox, useToast, Toast } from './shared.js';
import { Section, Stack, ListRow, NumeralBand, Table, Toolbar, Field, Dialog, Action, Surface, Text, scrollToId } from '/components/poster-parts.js';
import { swallowed } from '/js/swallowed.js';
import * as cortexService from '/js/services/cortex.js';
import { groupUnused, isSiteOwn } from './cortex-tab.groups.js';
import CortexDetail from './cortex-tab.detail.js';

const html = htm.bind(h);
const C = (key, params) => t('admin.cortex.' + key, params);

/** How many apps load this one, which is the number every arrangement on this page turns on. */
const appsOf = (e) => e?.used_by?.apps ?? 0;

/** Section 01: the four numbers, and the sentence that says which of them needs a decision. */
function RightNow({ facts, number, onBusiest }) {
    return html`<${Section} id="adm-cx-now" title=${C('now.title')} count=${number}>
      <${Stack}>
        <${NumeralBand} tone="plain" items=${[
          { label: C('strip.installed'), value: num(facts.all), note: C('strip.installedSub') },
          { label: C('strip.carrying'), value: num(facts.carrying), note: C('strip.carryingSub'), onClick: () => scrollToId('adm-cx-loaded') },
          { label: C('strip.unused'), value: num(facts.unused), note: C('strip.unusedSub'), tone: 'coral', onClick: () => scrollToId('adm-cx-unused') },
          { label: C('strip.busiest'), value: num(facts.busiest), note: facts.busiestName || C('strip.busiestNone'), onClick: onBusiest },
        ]} />
        <${Text} kind="lead">${facts.off > 0
          ? C('now.lineOff', { off: num(facts.off), breaking: num(facts.offButLoaded) })
          : C('now.line', { n: num(facts.all), unused: num(facts.unused) })}<//>
      <//>
    <//>`;
}

/** Section 04: what off actually does, and why removing is the one that cannot be taken back. */
function WhatOffDoes({ number }) {
    const step = (i, key) => html`<${ListRow} number=${String(i).padStart(2, '0')}
      name=${C('off.' + key)} detail=${C('off.' + key + 'Why')} detailKind="text" />`;
    return html`<${Section} id="adm-cx-off" title=${C('off.title')} count=${number}>
      <div>${step(1, 'goes')}${step(2, 'stays')}${step(3, 'remove')}</div>
    <//>`;
}

/** Section 05: the visibility word, which decides who may read the insides and nothing else. */
function WhoCanRead({ facts, number }) {
    const row = (key, value) => html`<${Row} title=${C('read.' + key)} why=${C('read.' + key + 'Why')} value=${value} />`;
    return html`<${Section} id="adm-cx-read" title=${C('read.title')} count=${number} description=${C('read.lead')}>
      <${Stack}>
        <div>
          ${row('public', num(facts.publicCount))}
          ${row('private', num(facts.privateCount))}
          ${row('site', num(facts.siteCount))}
        </div>
        <${Surface} kind="aside"><${Stack} density="compact">
          <${Text} kind="label">${C('read.boxLabel')}<//>
          <${Text}>${C('read.box', { n: num(facts.all) })}<//>
        <//><//>
      <//>
    <//>`;
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
      <${Dialog} open=${!!e} onClose=${() => setTurningOff(null)} title=${e ? C('dialog.offTitle', { name: e.name }) : ''}
        actions=${e && html`
          <${Action} kind="text" onClick=${() => setTurningOff(null)}>${t('common.cancel')}<//>
          <${Action} kind="primary" disabled=${busy} onClick=${doTurnOff}>
            ${apps === 0 ? C('dialog.offDo')
              : apps === 1 ? C('dialog.offDoForOne')
                : C('dialog.offDoFor', { n: num(apps) })}<//>`}>
        ${e && html`<${Stack}>
          ${apps > 0
            ? html`
              <${Text} kind="heading" size="small">${apps === 1 ? C('dialog.offLoadedOne') : C('dialog.offLoaded', { n: num(apps) })}<//>
              <${Text} kind="mono">${names.map((a, i) => html`${i > 0 ? ' · ' : ''}${a}`)}
                ${apps > names.length ? html` ${C('detail.andMore', { n: num(apps - names.length) })}` : ''}<//>
              <${Text} tone="coral">${C('dialog.offBreaks')}<//>`
            : html`<${Text}>${C('dialog.offNobody')}<//>`}
          <div>
            <${Row} title=${C('dialog.goes')} why=${C('dialog.goesWhy')} />
            <${Row} title=${C('dialog.stays')} why=${C('dialog.staysWhy')} />
          </div>
        <//>`}
      <//>`;
    };

    const removeDialog = () => html`
      <${Dialog} open=${!!removing} onClose=${() => setRemoving(null)}
        title=${removing ? C('dialog.removeTitle', { name: removing.name }) : ''}
        actions=${removing && html`
          <${Action} kind="text" onClick=${() => setRemoving(null)}>${t('common.cancel')}<//>
          <${Action} kind="primary" tone="danger"
            disabled=${busy || removing.typed !== removing.name} onClick=${doRemove}>${C('removeForGood')}<//>`}>
        ${removing && html`<${Stack}>
          <${Surface} kind="aside" tone="danger"><${Stack} density="compact">
            <${Text} kind="label">${C('dialog.removeWarnLabel')}<//>
            <${Text}>${C('dialog.removeWarn')}<//>
          <//><//>
          <${Field} label=${C('dialog.removeTypeLabel', { name: removing.name })} value=${removing.typed} placeholder=${removing.name}
            passwordManager=${false} onInput=${ev => setRemoving({ ...removing, typed: ev.target.value })} />
        <//>`}
      <//>`;

    if (list === null) {
        return html`<${Stack}>
      ${msg && html`<${Toast} type=${msg.type} text=${msg.text} onDismiss=${clearMsg} />`}
      <${Spinner} text=${t('dashboard.loading')} />
    <//>`;
    }

    if (detail) {
        return html`<${Stack}>
      ${msg && html`<${Toast} type=${msg.type} text=${msg.text} onDismiss=${clearMsg} />`}
      <${CortexDetail} ext=${detail.ext} row=${detail.row} busy=${busy}
        onBack=${() => setDetail(null)}
        onTurnOff=${() => setTurningOff(detail.row)}
        onTurnOn=${() => doTurnOn(detail.ext)}
        onVisibility=${() => doVisibility(detail.ext)}
        onRemove=${() => setRemoving({ name: detail.ext.name, typed: '' })} />
      ${offDialog()}
      ${removeDialog()}
    <//>`;
    }

    let counter = 0;
    const n = () => String(++counter).padStart(2, '0');

    /** One row of the table, used by both sections so a cortex reads the same wherever it sits. */
    const row = (e) => {
        const on = e.status === 'active';
        const apps = appsOf(e);
        const names = e.used_by?.app_names ?? [];
        return [
          html`<${Stack} density="compact">
            <${Stack} direction="wrap" align="center" density="compact">
              <${Action} kind="text" onClick=${() => openDetail(e)}>${e.name}<//>
              ${isSiteOwn(e) && html`<${Badge} type="muted" label=${C('thisSite')} />`}
              ${e.visibility === 'public' && html`<${Badge} type="public" label=${C('read.public')} />`}
              ${!on && html`<${Badge} type="warning" label=${C('state.off')} />`}
            <//>
            ${names.length > 0 && html`<${Text} kind="caption" tone="muted">${names.map((a, i) => html`${i > 0 ? ' · ' : ''}${a}`)}${apps > names.length ? html` ${C('detail.andMore', { n: num(apps - names.length) })}` : ''}<//>`}
          <//>`,
          { text: e.version || '?', mono: true },
          isSiteOwn(e) ? C('thisSite') : (e.installed_by || '?'),
          html`<${Text} kind="number" size="small" tone=${apps > 0 ? 'plain' : 'muted'}>${num(apps)}<//>`,
          (e.component_types ?? []).join(', ') || '—',
          html`<${Stack} direction="horizontal" density="compact">
            ${on
              ? html`<${Action} disabled=${busy} onClick=${() => setTurningOff(e)}>${C('turnOff')}<//>`
              : html`<${Action} disabled=${busy} onClick=${() => doTurnOn(e)}>${C('turnOn')}<//>`}
            <${Action} onClick=${() => openDetail(e)}>${C('look')}<//>
          <//>`,
        ];
    };

    const table = (rows) => html`<${Table} collapse=${900} label=${C('col.name')}
      headers=${[C('col.name'), C('col.version'), C('col.by'), C('col.apps'), C('col.pieces'), '']}
      rows=${rows.map(row)} />`;

    /** A group in section 03: the fact that made it, the names in it, and the way in. */
    const groupBlock = (g) => {
        const title = g.kind === 'lookalike' ? C('group.lookalike', { n: num(g.items.length) })
            : g.kind === 'batch' ? C('group.batch', { n: num(g.items.length), who: g.by || '?', day: day(g.day) })
                : g.kind === 'site' ? C('group.site', { n: num(g.items.length) })
                    : g.items[0].name;
        const why = g.kind === 'lookalike' ? C('group.' + g.reason + 'Why')
            : g.kind === 'batch' ? C('group.batchWhy')
                : g.kind === 'site' ? C('group.siteWhy')
                    : C('group.oneWhy', { when: day(g.items[0].installed_at), who: g.items[0].installed_by || '?' });
        const open = openGroup === g.key;
        return html`<${ListRow} key=${g.key} name=${title} open=${open}
          detail=${g.items.map(e => e.name).join(' · ')}
          actions=${html`
            <${Action} expanded=${open} onClick=${() => setOpenGroup(open ? '' : g.key)}>${open ? C('group.close') : C('group.show')}<//>
            ${g.kind === 'batch' && html`<${Action} tone="danger" disabled=${busy}
              onClick=${() => setRemovingBatch({ ...g, typed: '' })}>${C('group.removeAll', { n: num(g.items.length) })}<//>`}`}>
          <${Stack}>
            <${Text} kind="caption" tone="muted">${why}<//>
            ${open && table(g.items)}
          <//>
        <//>`;
    };

    return html`<${Stack}>
      ${msg && html`<${Toast} type=${msg.type} text=${msg.text} onDismiss=${clearMsg} />`}
      <${Text} kind="lead">${C('intro')}<//>
      ${error && html`<${ErrorBox} message=${error} />`}

      <${RightNow} facts=${facts} number=${n()} onBusiest=${() => setQuery(facts.busiestName)} />

      <${Section} id="adm-cx-loaded" title=${C('loaded.title')} count=${n()}
        actions=${html`<${Text} kind="caption" tone="muted">${C('loaded.count', { n: num(loaded.length), total: num(facts.all) })}<//>`}>
        <${Stack}>
          <${Toolbar} search=${{ ariaLabel: C('find.placeholder'), placeholder: C('find.placeholder'), value: query, onInput: ev => setQuery(ev.target.value) }} />
          ${loaded.length === 0
            ? html`<${Text} kind="caption" tone="muted">${query ? C('loaded.noMatch') : C('loaded.none')}<//>`
            : table(loaded)}
        <//>
      <//>

      <${Section} id="adm-cx-unused" title=${C('unused.title')} count=${n()} description=${C('unused.lead')}
        actions=${html`<${Text} kind="caption" tone="muted">${C('unused.count', { n: num(unusedShown), total: num(facts.all) })}<//>`}>
        ${groups.length === 0
          ? html`<${Text} kind="caption" tone="muted">${query ? C('loaded.noMatch') : C('unused.none')}<//>`
          : html`<div>${groups.map((g) => groupBlock(g))}</div>`}
      <//>

      <${WhatOffDoes} number=${n()} />
      <${WhoCanRead} facts=${facts} number=${n()} />

      ${offDialog()}
      ${removeDialog()}

      <${Dialog} open=${!!removingBatch} onClose=${() => setRemovingBatch(null)} title=${C('dialog.batchTitle')}
        actions=${removingBatch && html`
          <${Action} kind="text" onClick=${() => setRemovingBatch(null)}>${t('common.cancel')}<//>
          <${Action} kind="primary" tone="danger"
            disabled=${busy || removingBatch.typed !== C('dialog.removeWord')}
            onClick=${doRemoveBatch}>${C('group.removeAll', { n: num(removingBatch.items.length) })}<//>`}>
        ${removingBatch && html`<${Stack}>
          <${Text}>${C('dialog.batchAsk', { n: num(removingBatch.items.length) })}<//>
          <${Text} kind="mono">${removingBatch.items.map((e, i) => html`${i > 0 ? ' · ' : ''}${e.name}`)}<//>
          <${Surface} kind="aside" tone="danger"><${Stack} density="compact">
            <${Text} kind="label">${C('dialog.removeWarnLabel')}<//>
            <${Text}>${C('dialog.batchWarn')}<//>
          <//><//>
          <${Field} label=${C('dialog.batchTypeLabel', { word: C('dialog.removeWord') })} value=${removingBatch.typed}
            placeholder=${C('dialog.removeWord')} passwordManager=${false}
            onInput=${ev => setRemovingBatch({ ...removingBatch, typed: ev.target.value })} />
        <//>`}
      <//>
    <//>`;
}
