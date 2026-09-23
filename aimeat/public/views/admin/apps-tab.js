/**
 * @file apps-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin Applications page in the poster face (design canvas "AIMEAT Admin
 *   Applications", direction A): what is published here, the table of every app, the copy scan, the
 *   four ways an app can be off the wall, and what this operator has taken down.
 *
 *   THE PAGE ANSWERS BEFORE IT LISTS. Seventy-six apps came as one table with no counts at all,
 *   so "is anything wrong here" could only be answered by reading every row.
 *
 *   FOUR STATES LOOKED ALIKE AND MEAN DIFFERENT THINGS: taken down by the operator, parked by the
 *   owner, behind an access code, kept out of search engines. Only the first is the operator's, and
 *   only the first is theirs to undo.
 *
 *   DELETING MOVED OFF THE ROW. It is the one irreversible thing here and it was a red button on
 *   every row, the same size as Hide. It lives in the row menu now, still behind the typed
 *   filename. Taking an app down is the moderation action, and it is undone in one press.
 * @structure AppsAdminTab (default) · RightNow · FourStates · TakenDown
 * @usage Mounted by the admin dashboard tab router (views/admin.js).
 * @version-history
 *   v3.0.0 -- 2026-09-22 -- Composed from the shared component set (components/poster-parts.js):
 *     shared sections, metric rows, the numeral band, the toolbar with its filters, the shared
 *     table (its sortable headers keep the column names when rows stack on a phone, and a taken-down
 *     row is muted), the shared menu, dialog and fields. The page's
 *     own sheet (admin-apps.css) is gone, so a theme or a part reaches this page like every other.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v2.1.0 — 2026-09-13 — Compose shared poster headings and external spacing.
 *   v2.0.1 — 2026-09-13 — The take-down and delete dialogs' actions sit in the dialog's footer.
 *   v2.0.0 — 2026-09-12 — The poster face: five numbered sections, the facts the node already sent
 *     and the page ignored (forks, version, access code, search block, publish date, the address
 *     that opens the app), filters beside the search, the copy scan as a section with the suspected
 *     copy beside the original, and delete behind the row menu.
 *   v1.2.0 — 2026-07-07 — Add "Scan for copies" (Phase 4).
 *   v1.1.0 — 2026-06-25 — Add operator hard-delete (type-to-confirm).
 *   v1.0.0 — 2026-06-24 — Initial: list-all + hide/restore moderation tool.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useMemo } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { num, dt, fmtBytes, Badge, Row, Spinner, ErrorBox, useToast, Toast } from './shared.js';
import { Section, Columns, Stack, ListRow, Toolbar, Table, NumeralBand, Dialog, Field, Surface, Action, Text } from '/components/poster-parts.js';
import { swallowed } from '/js/swallowed.js';
import * as adminService from '/js/services/admin.js';
import { appRowCells } from './apps-tab.row.js';
import { CopyScan } from './apps-tab.scan.js';

const html = htm.bind(h);
const A = (key, params) => t('admin.apps.' + key, params);

/** The columns that can be sorted, and how each one reads a row. */
const SORTS = {
  published: (a) => -new Date(a.created_at || 0).getTime(),
  opened: (a) => -(a.downloads || 0),
  size: (a) => -(a.size || 0),
  forks: (a) => -(a.forks || 0),
  name: (a) => String(a.manifest?.name || a.filename).toLowerCase(),
  owner: (a) => String(a.owner || '').toLowerCase(),
};

/** Section 01: the word, the sentence, and the five rows behind it. */
function RightNow({ facts, number, onFilter }) {
  const word = facts.down > 0 ? A('now.wordModerated', { n: num(facts.down) }) : A('now.wordQuiet');
  const line = facts.down > 0
    ? A('now.lineModerated', { n: num(facts.all), owners: num(facts.owners), down: num(facts.down) })
    : A('now.lineQuiet', { n: num(facts.all), owners: num(facts.owners) });
  return html`
    <${Section} id="adm-ap-now" title=${A('now.title')} count=${number}
      actions=${html`<${Action} href="/v1/app-store" target="_blank">${A('now.openWall')}<//>`}>
      <${Columns} layout="trailing" collapse=${900}>
        <${Stack} density="compact">
          <${Text} kind="number" tone=${facts.down > 0 ? 'coral' : 'plain'}>${word}<//>
          <${Text}>${line}<//>
          <${Text} kind="mono" tone="muted">${A('now.stored', { size: fmtBytes(facts.bytes) })}<//>
          <${Text} kind="mono" tone="muted">${facts.newest}<//>
        <//>
        <div>
          <${Row} title=${A('now.downRow')} why=${A('now.downWhy')}
            chip=${facts.down > 0
              ? html`<${Badge} type="critical" label=${num(facts.down)} />`
              : html`<${Badge} type="healthy" label=${A('now.none')} />`}
            value=${A('now.operatorOnly')} />
          <${Row} title=${A('now.parkedRow')} why=${A('now.parkedWhy')}
            chip=${html`<${Badge} type="muted" label=${num(facts.parked)} />`} value=${A('now.ownersOwn')} />
          <${Row} title=${A('now.codeRow')} why=${A('now.codeWhy')}
            chip=${html`<${Badge} type=${facts.coded > 0 ? 'info' : 'muted'} label=${num(facts.coded)} />`}
            value=${A('now.accessCode')} />
          <${Row} title=${A('now.seoRow')} why=${A('now.seoWhy')}
            chip=${html`<${Badge} type=${facts.seoBlocked > 0 ? 'watch' : 'muted'} label=${A('now.byYou', { n: num(facts.seoBlocked) })} />`}
            value=${A('now.ofN', { n: num(facts.notIndexed) })} />
          <${Row} title=${A('now.neverRow')} why=${A('now.neverWhy')}
            chip=${html`<${Badge} type="muted" label=${num(facts.never)} />`} value=${A('now.zeroOpens')} />
        </div>
      <//>
      <${NumeralBand} tone="plain" items=${[
        { label: A('strip.apps'), value: num(facts.all), note: A('strip.appsSub') },
        { label: A('strip.down'), value: num(facts.down), note: A('strip.downSub'), tone: 'coral', onClick: () => onFilter('down') },
        { label: A('strip.parked'), value: num(facts.parked), note: A('strip.parkedSub'), onClick: () => onFilter('parked') },
        { label: A('strip.stored'), value: fmtBytes(facts.bytes), note: A('strip.storedSub', { size: fmtBytes(facts.largest) }) },
      ]} />
    <//>`;
}

/** Section 04: the four states, and the one action that cannot be undone. */
function FourStates({ facts, number }) {
  const step = (n, key, value) => html`
    <${ListRow} number=${n} name=${A('states.' + key)} detail=${A('states.' + key + 'Why')} detailKind="text" value=${value} />`;
  return html`
    <${Section} id="adm-ap-states" title=${A('states.title')} count=${number} description=${A('states.lead')}>
      ${step(1, 'down', A('states.count', { n: num(facts.down) }))}
      ${step(2, 'parked', A('states.count', { n: num(facts.parked) }))}
      ${step(3, 'code', A('states.count', { n: num(facts.coded) }))}
      ${step(4, 'seo', A('states.count', { n: num(facts.notIndexed) }))}
      <${Surface} kind="aside">
        <${Stack} density="compact">
          <${Text} kind="label">${A('states.dangerLabel')}<//>
          <${Text}>${A('states.danger')}<//>
        <//>
      <//>
    <//>`;
}

/** Section 05: what this operator has taken down, with the reason they gave. */
function TakenDown({ apps, number }) {
  const down = apps.filter(a => a.operator_hidden);
  return html`
    <${Section} id="adm-ap-log" title=${A('log.title')} count=${number}>
      ${down.length === 0
        ? html`<${Text} kind="caption" tone="muted">${A('log.none')}<//>`
        : down.map((a) => html`
          <${Row} key=${a.filename}
            title=${escHtml(a.manifest?.name || a.filename)}
            why=${a.operator_hide_reason ? `"${escHtml(a.operator_hide_reason)}"` : A('log.noReason')}
            chip=${html`<${Badge} type="critical" label=${A('chip.down')} />`}
            value=${`${dt(a.operator_hidden_at)} · ${escHtml(a.operator_hidden_by || '-')}`} />`)}
    <//>`;
}

export default function AppsAdminTab() {
  const [apps, setApps] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('published');
  const [hiding, setHiding] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [msg, showError, showSuccess, clearMsg] = useToast();

  const load = useCallback(async () => {
    setError(null);
    try {
      const resp = await adminService.getAdminApps();
      setApps(resp?.data?.apps || []);
    } catch (err) {
      setError(err?.message || String(err));
      setApps([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const handler = () => { load(); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  // ── what the page counts, from the list the node already sends ──
  const facts = useMemo(() => {
    const list = apps || [];
    const when = (a) => new Date(a.created_at || 0).getTime();
    const newest = list.slice().sort((a, b) => when(b) - when(a))[0];
    return {
      all: list.length,
      owners: new Set(list.map(a => a.owner)).size,
      down: list.filter(a => a.operator_hidden).length,
      parked: list.filter(a => a.parked).length,
      coded: list.filter(a => a.protected).length,
      seoBlocked: list.filter(a => a.operator_seo_blocked).length,
      notIndexed: list.filter(a => a.operator_seo_blocked || a.seo_state === 'off' || a.seo_state === 'blocked').length,
      never: list.filter(a => !a.operator_hidden && !a.parked && (a.downloads || 0) === 0).length,
      bytes: list.reduce((n, a) => n + (a.size || 0), 0),
      largest: list.reduce((n, a) => Math.max(n, a.size || 0), 0),
      newest: newest
        ? A('now.newest', { when: dt(newest.created_at), who: escHtml(newest.owner) })
        : A('now.noApps'),
    };
  }, [apps]);

  const shown = useMemo(() => {
    const list = (apps || []).filter(a => {
      if (filter === 'down' && !a.operator_hidden) return false;
      if (filter === 'parked' && !a.parked) return false;
      if (filter === 'coded' && !a.protected) return false;
      if (filter === 'never' && (a.operator_hidden || a.parked || (a.downloads || 0) > 0)) return false;
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (a.filename || '').toLowerCase().includes(q)
        || (a.owner || '').toLowerCase().includes(q)
        || (a.manifest?.name || '').toLowerCase().includes(q);
    });
    const key = SORTS[sort] || SORTS.published;
    return list.slice().sort((a, b) => {
      const av = key(a); const bv = key(b);
      return typeof av === 'string' ? av.localeCompare(bv) : av - bv;
    });
  }, [apps, query, filter, sort]);

  // ── the three writes ──
  const doHide = useCallback(async () => {
    if (!hiding) return;
    setBusy(true);
    try {
      await adminService.moderateApp(hiding.owner, hiding.filename, true, hiding.reason?.trim() || undefined);
      showSuccess(A('tookDown', { name: hiding.name }));
      setHiding(null);
      await load();
    } catch (err) { swallowed('apps-tab: hide', err); showError(err?.message || String(err)); }
    finally { setBusy(false); }
  }, [hiding, load, showSuccess, showError]);

  const doRestore = useCallback(async (app) => {
    setBusy(true);
    try {
      await adminService.moderateApp(app.owner, app.filename, false);
      showSuccess(A('putBackDone', { name: app.manifest?.name || app.filename }));
      await load();
    } catch (err) { swallowed('apps-tab: restore', err); showError(err?.message || String(err)); }
    finally { setBusy(false); }
  }, [load, showSuccess, showError]);

  const doDelete = useCallback(async () => {
    if (!deleting || deleting.typed !== deleting.filename) return;
    setBusy(true);
    try {
      await adminService.deleteAppAdmin(deleting.owner, deleting.filename);
      showSuccess(A('deletedDone', { name: deleting.name }));
      setDeleting(null);
      await load();
    } catch (err) { swallowed('apps-tab: delete', err); showError(err?.message || String(err)); }
    finally { setBusy(false); }
  }, [deleting, load, showSuccess, showError]);

  /**
   * The narrow one: a blocked app stays published, listed and usable, and only stops being
   * findable in a search engine. The same door lifts it again, which is why this is one toggle
   * rather than the approve route (that one answers 409 unless the site reviews every app).
   */
  const doSeo = useCallback(async (app) => {
    setBusy(true);
    try {
      await adminService.blockAppSeo(app.owner, app.filename, !app.operator_seo_blocked);
      showSuccess(app.operator_seo_blocked ? A('seoAllowed') : A('seoBlocked'));
      await load();
    } catch (err) { swallowed('apps-tab: seo', err); showError(err?.message || String(err)); }
    finally { setBusy(false); }
  }, [load, showSuccess, showError]);

  const runCopyScan = useCallback(async () => {
    setScanning(true);
    try {
      const resp = await adminService.scanAppCopies();
      setScanResult(resp?.data || null);
    } catch (err) { swallowed('apps-tab: scan', err); showError(err?.message || String(err)); }
    finally { setScanning(false); }
  }, [showError]);

  if (apps === null) {
    return html`
      ${msg && html`<${Toast} type=${msg.type} text=${msg.text} onDismiss=${clearMsg} />`}
      <${Spinner} text=${t('dashboard.loading')} />`;
  }

  let counter = 0;
  const n = () => String(++counter).padStart(2, '0');
  // A column name is the button that sorts by it. Names read A to Z; numbers and dates largest first.
  const col = (key, label) => ({ label, sortKey: key });
  const sortState = { key: sort, dir: sort === 'name' || sort === 'owner' ? 'asc' : 'desc' };
  const handlers = {
    busy,
    onHide: (app) => setHiding({ owner: app.owner, filename: app.filename, name: app.manifest?.name || app.filename, reason: '' }),
    onRestore: doRestore,
    onDelete: (app) => setDeleting({ owner: app.owner, filename: app.filename, name: app.manifest?.name || app.filename, typed: '' }),
    onSeo: doSeo,
  };

  return html`
    <${Stack}>
      ${msg && html`<${Toast} type=${msg.type} text=${msg.text} onDismiss=${clearMsg} />`}
      <${Text} tone="muted">${A('intro')}<//>
      ${error && html`<${ErrorBox} message=${error} />`}

      <${RightNow} facts=${facts} number=${n()} onFilter=${(key) => { setFilter(key); setQuery(''); }} />

      <${Section} id="adm-ap-find" title=${A('find.title')} count=${n()}
        actions=${html`<${Text} kind="caption" tone="muted">${A('find.count', { n: num(shown.length), total: num(facts.all) })}<//>`}>
        <${Toolbar}
          search=${{ ariaLabel: A('searchPh'), placeholder: A('searchPh'), value: query, onInput: (e) => setQuery(e.target.value) }}
          filters=${[['all', facts.all], ['down', facts.down], ['parked', facts.parked], ['coded', facts.coded], ['never', facts.never]]
            .map(([key, count]) => ({ id: key, label: A('filter.' + key, { n: num(count) }), selected: filter === key, onClick: () => setFilter(key) }))} />

        <${Table} collapse=${640} sort=${sortState} onSort=${setSort}
          rowTones=${shown.map(a => (a.operator_hidden ? 'muted' : undefined))}
          headers=${[col('name', A('col.app')), col('owner', A('col.owner')), col('size', A('col.size')),
            col('opened', A('col.opened')), col('forks', A('col.forks')), col('published', A('col.published')), '']}
          rows=${shown.map(a => appRowCells(a, handlers))} />
        ${shown.length === 0 && html`<${Text} kind="caption" tone="muted">${A('noMatch')}<//>`}
      <//>

      <${CopyScan} result=${scanResult} apps=${apps} scanning=${scanning} onScan=${runCopyScan} number=${n()} />
      <${FourStates} facts=${facts} number=${n()} />
      <${TakenDown} apps=${apps} number=${n()} />

      <${Dialog} open=${!!hiding} onClose=${() => setHiding(null)} title=${A('hideTitle')}
        actions=${hiding && html`
          <${Action} onClick=${() => setHiding(null)}>${t('common.cancel')}<//>
          <${Action} kind="primary" disabled=${busy} onClick=${doHide}>${A('takeDown')}<//>`}>
        ${hiding && html`
          <${Stack}>
            <${Text}>${A('hideAsk', { name: escHtml(hiding.name), owner: escHtml(hiding.owner) })}<//>
            <${Text} kind="caption" tone="muted">${A('hideExplain')}<//>
            <${Field} label=${A('reasonLabel')} value=${hiding.reason} placeholder=${A('reasonPh')}
              onInput=${e => setHiding({ ...hiding, reason: e.target.value })} />
          <//>`}
      <//>

      <${Dialog} open=${!!deleting} onClose=${() => setDeleting(null)} title=${A('deleteTitle')}
        actions=${deleting && html`
          <${Action} onClick=${() => setDeleting(null)}>${t('common.cancel')}<//>
          <${Action} tone="danger" disabled=${busy || deleting.typed !== deleting.filename} onClick=${doDelete}>${A('deleteForGood')}<//>`}>
        ${deleting && html`
          <${Stack}>
            <${Text}>${A('deleteAsk', { name: escHtml(deleting.name), owner: escHtml(deleting.owner) })}<//>
            <${Surface} kind="aside" tone="danger">
              <${Stack} density="compact">
                <${Text} kind="label">${A('deleteWarnLabel')}<//>
                <${Text}>${A('deleteWarn')}<//>
              <//>
            <//>
            <${Field} label=${A('deleteTypeLabel', { filename: deleting.filename })} value=${deleting.typed} placeholder=${deleting.filename}
              passwordManager=${false} spellCheck=${false}
              onInput=${e => setDeleting({ ...deleting, typed: e.target.value })} />
          <//>`}
      <//>
    <//>`;
}
