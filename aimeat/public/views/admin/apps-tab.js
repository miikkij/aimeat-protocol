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
import { useViewCSS } from '/components/useViewCSS.js';
import { num, dt, fmtBytes, Badge, Spinner, ErrorBox, useToast, Toast } from './shared.js';
import { Modal } from '/components/Modal.js';
import { swallowed } from '/js/swallowed.js';
import * as adminService from '/js/services/admin.js';
import { AppRow } from './apps-tab.row.js';
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
  const row = (title, why, chip, value, last) => html`
    <div class=${'adm-mrow' + (last ? ' adm-mrow--last' : '')}>
      <span><b>${title}</b><span class="adm-why">${why}</span></span>
      <span>${chip}</span>
      <span class="adm-mval">${value}</span>
    </div>`;
  return html`
    <section class="og-sec og-sec--first" id="adm-ap-now">
      <div class="og-sec-h"><h2>${A('now.title')}<small>${number}</small></h2>
        <div class="og-doors">
          <a class="og-door og-door--quiet" href="/v1/app-store" target="_blank" rel="noopener">${A('now.openWall')}</a>
        </div></div>
      <div class="adm-ov-grid">
        <div>
          <div class="adm-ov-status">${word}</div>
          <p class="adm-alert-line">${line}</p>
          <div class="adm-ov-up">${A('now.stored', { size: fmtBytes(facts.bytes) })}<br />${facts.newest}</div>
        </div>
        <div>
          ${row(A('now.downRow'), A('now.downWhy'),
            facts.down > 0
              ? html`<${Badge} type="critical" label=${num(facts.down)} />`
              : html`<${Badge} type="healthy" label=${A('now.none')} />`,
            A('now.operatorOnly'))}
          ${row(A('now.parkedRow'), A('now.parkedWhy'),
            html`<${Badge} type="muted" label=${num(facts.parked)} />`, A('now.ownersOwn'))}
          ${row(A('now.codeRow'), A('now.codeWhy'),
            html`<${Badge} type=${facts.coded > 0 ? 'info' : 'muted'} label=${num(facts.coded)} />`,
            A('now.accessCode'))}
          ${row(A('now.seoRow'), A('now.seoWhy'),
            html`<${Badge} type=${facts.seoBlocked > 0 ? 'watch' : 'muted'} label=${A('now.byYou', { n: num(facts.seoBlocked) })} />`,
            A('now.ofN', { n: num(facts.notIndexed) }))}
          ${row(A('now.neverRow'), A('now.neverWhy'),
            html`<${Badge} type="muted" label=${num(facts.never)} />`, A('now.zeroOpens'), true)}
        </div>
      </div>
      <div class="og-strip">
        <div><b>${num(facts.all)}</b><span>${A('strip.apps')}</span><small>${A('strip.appsSub')}</small></div>
        <button type="button" onClick=${() => onFilter('down')}>
          <b class="adm-ap-coral">${num(facts.down)}</b><span>${A('strip.down')}</span><small>${A('strip.downSub')}</small></button>
        <button type="button" onClick=${() => onFilter('parked')}>
          <b>${num(facts.parked)}</b><span>${A('strip.parked')}</span><small>${A('strip.parkedSub')}</small></button>
        <div><b>${fmtBytes(facts.bytes)}</b><span>${A('strip.stored')}</span><small>${A('strip.storedSub', { size: fmtBytes(facts.largest) })}</small></div>
      </div>
    </section>`;
}

/** Section 04: the four states, and the one action that cannot be undone. */
function FourStates({ facts, number }) {
  const step = (n, key, value, last) => html`
    <div class=${'adm-ap-step' + (last ? ' adm-ap-step--last' : '')}>
      <span class="adm-ap-stepn">${n}</span>
      <span><b>${A('states.' + key)}</b><span class="adm-why">${A('states.' + key + 'Why')}</span></span>
      <span class="adm-mval">${value}</span>
    </div>`;
  return html`
    <section class="og-sec" id="adm-ap-states">
      <div class="og-sec-h"><h2>${A('states.title')}<small>${number}</small></h2></div>
      <p class="adm-ap-lead">${A('states.lead')}</p>
      ${step(1, 'down', A('states.count', { n: num(facts.down) }))}
      ${step(2, 'parked', A('states.count', { n: num(facts.parked) }))}
      ${step(3, 'code', A('states.count', { n: num(facts.coded) }))}
      ${step(4, 'seo', A('states.count', { n: num(facts.notIndexed) }), true)}
      <div class="og-box" style="margin-top: 16px">
        <span class="og-box-label">${A('states.dangerLabel')}</span>
        ${A('states.danger')}
      </div>
    </section>`;
}

/** Section 05: what this operator has taken down, with the reason they gave. */
function TakenDown({ apps, number }) {
  const down = apps.filter(a => a.operator_hidden);
  return html`
    <section class="og-sec" id="adm-ap-log">
      <div class="og-sec-h"><h2>${A('log.title')}<small>${number}</small></h2></div>
      ${down.length === 0
        ? html`<p class="adm-ap-note">${A('log.none')}</p>`
        : down.map((a, i) => html`
          <div class=${'adm-mrow' + (i === down.length - 1 ? ' adm-mrow--last' : '')} key=${a.filename}>
            <span>
              <b>${escHtml(a.manifest?.name || a.filename)}</b>
              <span class="adm-why">${a.operator_hide_reason ? `"${escHtml(a.operator_hide_reason)}"` : A('log.noReason')}</span>
            </span>
            <span><${Badge} type="critical" label=${A('chip.down')} /></span>
            <span class="adm-mval">${dt(a.operator_hidden_at)} · ${escHtml(a.operator_hidden_by || '-')}</span>
          </div>`)}
    </section>`;
}

export default function AppsAdminTab() {
  useViewCSS('/css/views/admin-apps.css');
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
  const col = (key, label, right) => html`
    <th class=${right ? 'r' : ''}>
      <button type="button" class=${sort === key ? 'adm-ap-sorted' : ''} onClick=${() => setSort(key)}>${label}</button>
    </th>`;

  return html`
    <div class="adm-ap">
      ${msg && html`<${Toast} type=${msg.type} text=${msg.text} onDismiss=${clearMsg} />`}
      <p class="adm-ap-intro">${A('intro')}</p>
      ${error && html`<${ErrorBox} message=${error} />`}

      <${RightNow} facts=${facts} number=${n()} onFilter=${(key) => { setFilter(key); setQuery(''); }} />

      <section class="og-sec" id="adm-ap-find">
        <div class="og-sec-h"><h2>${A('find.title')}<small>${n()}</small></h2>
          <div class="og-doors"><span class="adm-ap-note">${A('find.count', { n: num(shown.length), total: num(facts.all) })}</span></div></div>

        <div class="adm-ap-tools">
          <span class="adm-ap-find">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
            <input type="text" value=${query} placeholder=${A('searchPh')} onInput=${e => setQuery(e.target.value)} />
          </span>
          ${[['all', facts.all], ['down', facts.down], ['parked', facts.parked], ['coded', facts.coded], ['never', facts.never]]
            .map(([key, count]) => html`
              <button type="button" key=${key} class=${'adm-ap-filter' + (filter === key ? ' on' : '')}
                onClick=${() => setFilter(key)}>${A('filter.' + key, { n: num(count) })}</button>`)}
        </div>

        <div class="adm-ap-scroll">
          <table class="adm-ap-tbl">
            <thead>
              <tr>
                ${col('name', A('col.app'))}
                ${col('owner', A('col.owner'))}
                ${col('size', A('col.size'), true)}
                ${col('opened', A('col.opened'), true)}
                ${col('forks', A('col.forks'), true)}
                ${col('published', A('col.published'), true)}
                <th class="r"></th>
              </tr>
            </thead>
            <tbody>
              ${shown.map(a => html`
                <${AppRow} key=${a.owner + '/' + a.filename} app=${a} busy=${busy}
                  onHide=${(app) => setHiding({ owner: app.owner, filename: app.filename, name: app.manifest?.name || app.filename, reason: '' })}
                  onRestore=${doRestore}
                  onDelete=${(app) => setDeleting({ owner: app.owner, filename: app.filename, name: app.manifest?.name || app.filename, typed: '' })}
                  onSeo=${doSeo} />`)}
            </tbody>
          </table>
        </div>
        ${shown.length === 0 && html`<p class="adm-ap-note" style="margin-top: 12px">${A('noMatch')}</p>`}
      </section>

      <${CopyScan} result=${scanResult} apps=${apps} scanning=${scanning} onScan=${runCopyScan} number=${n()} />
      <${FourStates} facts=${facts} number=${n()} />
      <${TakenDown} apps=${apps} number=${n()} />

      <${Modal} open=${!!hiding} onClose=${() => setHiding(null)} title=${A('hideTitle')}
        footer=${hiding && html`
          <button type="button" class="og-door og-door--quiet" onClick=${() => setHiding(null)}>${t('common.cancel')}</button>
          <button type="button" class="adm-btn" disabled=${busy} onClick=${doHide}>${A('takeDown')}</button>`}>
        ${hiding && html`
          <p>${A('hideAsk', { name: escHtml(hiding.name), owner: escHtml(hiding.owner) })}</p>
          <p class="adm-ap-note">${A('hideExplain')}</p>
          <label class="adm-ap-field">
            <span>${A('reasonLabel')}</span>
            <input class="adm-input" type="text" value=${hiding.reason} placeholder=${A('reasonPh')}
              onInput=${e => setHiding({ ...hiding, reason: e.target.value })} />
          </label>`}
      <//>

      <${Modal} open=${!!deleting} onClose=${() => setDeleting(null)} title=${A('deleteTitle')}
        footer=${deleting && html`
          <button type="button" class="og-door og-door--quiet" onClick=${() => setDeleting(null)}>${t('common.cancel')}</button>
          <button type="button" class="og-door og-door--quiet og-door--danger"
            disabled=${busy || deleting.typed !== deleting.filename} onClick=${doDelete}>${A('deleteForGood')}</button>`}>
        ${deleting && html`
          <p>${A('deleteAsk', { name: escHtml(deleting.name), owner: escHtml(deleting.owner) })}</p>
          <div class="og-box">
            <span class="og-box-label">${A('deleteWarnLabel')}</span>
            ${A('deleteWarn')}
          </div>
          <label class="adm-ap-field">
            <span>${A('deleteTypeLabel', { filename: deleting.filename })}</span>
            <input class="adm-input mono" type="text" value=${deleting.typed} placeholder=${deleting.filename}
              onInput=${e => setDeleting({ ...deleting, typed: e.target.value })} />
          </label>`}
      <//>
    </div>`;
}
