/**
 * @file apps-tab.js
 * @description Admin dashboard Applications tab — operator moderation surface for
 *   every published app on the node. Lists all apps (across all owners, including
 *   parked + operator-hidden), with a hide/restore control. Hiding removes the app
 *   from every public surface (catalogue/gallery/search + direct download); the
 *   owner still sees it in their "My Apps" with a "moderated by operator: hidden"
 *   badge but cannot lift it — only an operator can.
 * @structure AppsAdminTab (default) — load all apps, filter, table, hide-reason +
 *   type-to-confirm delete modals.
 * @usage Mounted by the admin dashboard tab router (views/admin.js).
 * @version-history
 *   v1.0.0 — 2026-06-24 — Initial: list-all + hide/restore moderation tool.
 *   v1.1.0 — 2026-06-25 — Add operator hard-delete (type-to-confirm) — removes an
 *     app permanently from the node.
 *   v1.2.0 — 2026-07-07 — Add "Scan for copies" (Phase 4): calls GET /v1/admin/apps/similar
 *     and shows unattributed near-duplicates (high similarity, no fork link) + watermark hits.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, fmtBytes, Spinner, Empty, ErrorBox, useToast, Toast } from './shared.js';
import { Modal } from '/components/Modal.js';
import * as adminService from '/js/services/admin.js';

export default function AppsAdminTab() {
  const [apps, setApps] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [hiddenOnly, setHiddenOnly] = useState(false);
  // { owner, filename, name, reason } while the hide-reason modal is open
  const [hiding, setHiding] = useState(null);
  // { owner, filename, name, typed } while the type-to-confirm delete modal is open
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  // Unattributed-copy scan (Phase 4): { suspiciousPairs, watermarkHits, scanned, note }
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

  const filtered = useMemo(() => {
    if (!apps) return [];
    const q = query.trim().toLowerCase();
    return apps.filter(a => {
      if (hiddenOnly && !a.operator_hidden) return false;
      if (!q) return true;
      return (a.filename || '').toLowerCase().includes(q)
        || (a.owner || '').toLowerCase().includes(q)
        || (a.manifest?.name || '').toLowerCase().includes(q);
    });
  }, [apps, query, hiddenOnly]);

  const hiddenCount = useMemo(() => (apps || []).filter(a => a.operator_hidden).length, [apps]);

  const doHide = useCallback(async () => {
    if (!hiding) return;
    setBusy(true);
    try {
      await adminService.moderateApp(hiding.owner, hiding.filename, true, hiding.reason?.trim() || undefined);
      showSuccess(t('admin.apps.hiddenOk'));
      setHiding(null);
      await load();
    } catch (err) {
      showError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }, [hiding, load, showSuccess, showError]);

  const doRestore = useCallback(async (app) => {
    try {
      await adminService.moderateApp(app.owner, app.filename, false);
      showSuccess(t('admin.apps.restoredOk'));
      await load();
    } catch (err) {
      showError(err?.message || String(err));
    }
  }, [load, showSuccess, showError]);

  const doDelete = useCallback(async () => {
    if (!deleting || deleting.typed !== deleting.filename) return;
    setBusy(true);
    try {
      await adminService.deleteAppAdmin(deleting.owner, deleting.filename);
      showSuccess(t('admin.apps.deletedOk'));
      setDeleting(null);
      await load();
    } catch (err) {
      showError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }, [deleting, load, showSuccess, showError]);

  const runCopyScan = useCallback(async () => {
    setScanning(true);
    try {
      const resp = await adminService.scanAppCopies();
      setScanResult(resp?.data || null);
    } catch (err) {
      showError(err?.message || String(err));
    } finally {
      setScanning(false);
    }
  }, [showError]);

  return html`
    ${msg && html`<${Toast} type=${msg.type} text=${msg.text} onDismiss=${clearMsg} />`}
    <p class="adm-text-sm adm-text-dim adm-mb-md">${t('admin.apps.desc')}</p>

    <div class="adm-card">
      <div class="adm-flex-between adm-mb-md">
        <h2>${t('admin.apps.title')} ${hiddenCount > 0 ? html`<span class="badge badge-warn">${hiddenCount} ${t('admin.apps.hiddenChip')}</span>` : ''}</h2>
        <div class="adm-flex adm-apps-filters">
          <input class="adm-input" placeholder=${t('admin.apps.searchPlaceholder')}
            value=${query} onInput=${e => setQuery(e.target.value)} />
          <label class="adm-text-sm adm-apps-toggle">
            <input type="checkbox" checked=${hiddenOnly} onChange=${e => setHiddenOnly(e.target.checked)} />
            ${t('admin.apps.hiddenOnly')}
          </label>
          <button class="adm-btn-sm adm-btn-info" onClick=${runCopyScan} disabled=${scanning}>
            ${scanning ? t('admin.apps.scanning') : t('admin.apps.scanCopies')}
          </button>
        </div>
      </div>

      ${scanResult && html`
        <div class="adm-card adm-mb-md">
          <div class="adm-flex-between adm-mb-sm">
            <b>${t('admin.apps.copyScanTitle')}</b>
            <button class="adm-btn-sm adm-btn-ghost" onClick=${() => setScanResult(null)}>${t('common.close')}</button>
          </div>
          <div class="adm-text-sm adm-text-dim adm-mb-sm">${escHtml(scanResult.note || '')} (${scanResult.scanned} ${t('admin.apps.scanned')})</div>
          ${scanResult.watermarkHits?.length ? html`
            <div class="adm-text-sm"><b>${t('admin.apps.wmHits')}</b></div>
            <ul>${scanResult.watermarkHits.map(w => html`<li class="adm-text-sm mono">${escHtml(w.inApp)} ⬅ ${escHtml(w.watermarkOf)} · ${escHtml(w.viewer)} · ${dt(w.servedAt)}</li>`)}</ul>` : ''}
          ${scanResult.suspiciousPairs?.length ? html`
            <div class="adm-text-sm"><b>${t('admin.apps.similarPairs')}</b></div>
            <ul>${scanResult.suspiciousPairs.map(p => html`<li class="adm-text-sm mono">${escHtml(p.a)} ~ ${escHtml(p.b)} · ${Math.round(p.similarity * 100)}%</li>`)}</ul>` : ''}
          ${(!scanResult.watermarkHits?.length && !scanResult.suspiciousPairs?.length) ? html`<div class="adm-text-sm adm-text-dim">${t('admin.apps.nothingFlagged')}</div>` : ''}
        </div>` }

      ${error && html`<${ErrorBox} message=${error} />`}
      ${apps === null ? html`<${Spinner} />`
        : filtered.length === 0 ? html`<${Empty} text=${t('admin.apps.empty')} />`
        : html`
        <div class="scrollable">
          <table>
            <thead><tr>
              <th>${t('admin.apps.colApp')}</th>
              <th>${t('admin.apps.colOwner')}</th>
              <th>${t('admin.apps.colSize')}</th>
              <th>${t('admin.apps.colDownloads')}</th>
              <th>${t('admin.apps.colStatus')}</th>
              <th></th>
            </tr></thead>
            <tbody>
              ${filtered.map(a => html`
                <tr class=${a.operator_hidden ? 'adm-apps-row-hidden' : ''}>
                  <td>
                    <div>${escHtml(a.manifest?.name || a.filename)}</div>
                    <div class="adm-text-sm adm-text-dim mono">${escHtml(a.filename)}</div>
                  </td>
                  <td class="mono">${escHtml(a.owner)}</td>
                  <td>${fmtBytes(a.size || 0)}</td>
                  <td>${a.downloads || 0}</td>
                  <td>
                    ${a.operator_hidden
                      ? html`<span class="badge badge-danger">\u{1F6AB} ${t('admin.apps.statusHidden')}</span>
                          ${a.operator_hide_reason ? html`<div class="adm-text-sm adm-text-dim">${escHtml(a.operator_hide_reason)}</div>` : ''}
                          ${a.operator_hidden_by ? html`<div class="adm-text-sm adm-text-dim">${t('admin.apps.byAt', { by: a.operator_hidden_by, at: dt(a.operator_hidden_at) })}</div>` : ''}`
                      : a.parked
                        ? html`<span class="badge badge-dim">\u{1F17F}️ ${t('admin.apps.statusParked')}</span>`
                        : html`<span class="badge badge-success">${t('admin.apps.statusLive')}</span>`}
                  </td>
                  <td>
                    <div class="adm-flex adm-apps-rowactions">
                      ${a.operator_hidden
                        ? html`<button class="adm-btn-sm adm-btn-success" onClick=${() => doRestore(a)}>${t('admin.apps.restore')}</button>`
                        : html`<button class="adm-btn-sm adm-btn-danger" onClick=${() => setHiding({ owner: a.owner, filename: a.filename, name: a.manifest?.name || a.filename, reason: '' })}>${t('admin.apps.hide')}</button>`}
                      <button class="adm-btn-sm adm-btn-danger-solid" onClick=${() => setDeleting({ owner: a.owner, filename: a.filename, name: a.manifest?.name || a.filename, typed: '' })}>${t('admin.apps.delete')}</button>
                    </div>
                  </td>
                </tr>
              `)}
            </tbody>
          </table>
        </div>
      `}
    </div>

    <${Modal} open=${!!hiding} onClose=${() => setHiding(null)} title=${t('admin.apps.hideTitle')}>
      ${hiding && html`
        <p>${t('admin.apps.hideConfirm')} <strong>${escHtml(hiding.name)}</strong> (<span class="mono">${escHtml(hiding.owner)}</span>)?</p>
        <p class="adm-text-sm adm-text-dim">${t('admin.apps.hideExplain')}</p>
        <label class="adm-text-sm adm-mb-half">${t('admin.apps.reasonLabel')}</label>
        <input class="adm-input adm-input-full" value=${hiding.reason}
          placeholder=${t('admin.apps.reasonPlaceholder')}
          onInput=${e => setHiding({ ...hiding, reason: e.target.value })} />
        <div class="adm-flex adm-mt-md adm-apps-modal-actions">
          <button class="btn-ghost" onClick=${() => setHiding(null)}>${t('common.cancel')}</button>
          <button class="btn-danger-solid" disabled=${busy} onClick=${doHide}>${t('admin.apps.hide')}</button>
        </div>
      `}
    <//>

    <${Modal} open=${!!deleting} onClose=${() => setDeleting(null)} title=${t('admin.apps.deleteTitle')}>
      ${deleting && html`
        <p>${t('admin.apps.deleteConfirm')} <strong>${escHtml(deleting.name)}</strong> (<span class="mono">${escHtml(deleting.owner)}</span>)?</p>
        <p class="adm-text-sm adm-text-error">${t('admin.apps.deleteWarn')}</p>
        <label class="adm-text-sm adm-mb-half">${t('admin.apps.deleteTypeLabel', { filename: deleting.filename })}</label>
        <input class="adm-input adm-input-full mono" value=${deleting.typed}
          placeholder=${deleting.filename}
          onInput=${e => setDeleting({ ...deleting, typed: e.target.value })} />
        <div class="adm-flex adm-mt-md adm-apps-modal-actions">
          <button class="btn-ghost" onClick=${() => setDeleting(null)}>${t('common.cancel')}</button>
          <button class="btn-danger-solid" disabled=${busy || deleting.typed !== deleting.filename} onClick=${doDelete}>${t('admin.apps.delete')}</button>
        </div>
      `}
    <//>
  `;
}
