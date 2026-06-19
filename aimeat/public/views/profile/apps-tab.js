/**
 * @file apps-tab.js
 * @description Profile tab for HTML app management — upload, gallery, access code editing.
 * @version-history
 *   v1.1.0 — 2026-03-19 — Add launch button to My Apps list
 *   v1.0.0 — 2026-03-17 — Refactor: replace inline styles with CSS utility classes (card-h3, text-caption, etc.)
 *   v1.1.1 — 2026-06-19 — JSDoc type annotations for frontend type-checking
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, handleImgError, timeAgo } from '/js/utils.js';
import { Spinner } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { listApps, uploadApp, deleteApp, patchApp } from '/js/services/apps.js';
import { getNodeUrl } from '/js/services/auth.js';
import { recordRecent } from '/js/recents.js';

export default function AppsTab({ session, showToast, onStats }) {
  const { confirm, ConfirmUI } = useConfirm();
  const NODE_URL = getNodeUrl();
  const [myApps, setMyApps] = useState(null);
  const [allApps, setAllApps] = useState(null);
  const [showAppUpload, setShowAppUpload] = useState(false);
  const [editingApp, setEditingApp] = useState(null);
  const [editCode, setEditCode] = useState('');

  useEffect(() => {
    if (session) loadData();
  }, [session]);

  async function loadData() {
    try {
      const list = await listApps();
      const own = list.filter(a => a.owner === session.owner);
      setMyApps(own);
      setAllApps(list);
      onStats?.({ apps: own.length });
    } catch { setMyApps([]); setAllApps([]); }
  }

  async function handleUpload(file, screenshot, accessCode) {
    if (!file) { showToast(t('profile.apps.selectFile'), true); return; }
    const readFile = (f) => new Promise(res => { const r = new FileReader(); r.onload = () => res(/** @type {string} */ (r.result).split(',')[1]); r.readAsDataURL(f); });
    const contentBase64 = await readFile(file);
    const opts = {};
    if (accessCode) opts.accessCode = accessCode;
    if (screenshot) {
      opts.screenshotBase64 = await readFile(screenshot);
      opts.screenshotMimeType = screenshot.type || 'image/png';
    }
    const resp = await uploadApp(file.name, contentBase64, file.type || 'text/html', opts);
    if (resp.ok !== false) { showToast(t('profile.apps.uploaded')); setShowAppUpload(false); loadData(); }
    else showToast(t('profile.apps.uploadFailed'), true);
  }

  async function handleDelete(filename) {
    confirm(t('profile.apps.confirmDelete') || 'Delete this app?', async () => {
      const resp = await deleteApp(filename);
      if (resp.ok !== false) { showToast(t('profile.apps.deleted') || 'App deleted'); loadData(); }
      else showToast(resp?.error?.message || t('profile.apps.deleteFailed') || 'Delete failed', true);
    }, { danger: true });
  }

  function startEdit(app) {
    setEditingApp(app.filename);
    setEditCode(app.access_code || '');
  }

  function cancelEdit() {
    setEditingApp(null);
    setEditCode('');
  }

  async function handleSaveAccessCode(filename) {
    const body = editCode.trim() ? { access_code: editCode.trim() } : { access_code: null };
    const resp = await patchApp(filename, body);
    if (resp.ok !== false) {
      showToast(t('profile.apps.updated') || 'App updated');
      setEditingApp(null);
      setEditCode('');
      loadData();
    } else {
      showToast(resp?.error?.message || t('profile.apps.updateFailed') || 'Update failed', true);
    }
  }

  return html`
    <div class="section-title">${t('profile.apps.title')}</div>
    <div class="section-desc">${t('profile.apps.desc')}</div>

    <!-- App launcher -->
    <div class="card mb-1">
      <h3 class="card-h3">\u{1F680} ${t('profile.apps.launcherTitle')}</h3>
      <p class="text-caption mb-half">${t('profile.apps.launcherDesc')}</p>
      <a href="/app-catalog.html" target="_blank" class="btn-primary pf-no-underline pf-inline-block">${t('profile.apps.launcherOpen')}</a>
    </div>

    <!-- Create guide -->
    <div class="card mb-1">
      <h3 class="card-h3">\u2728 ${t('profile.apps.createGuide')}</h3>
      <p class="text-caption mb-half">${t('profile.apps.createGuideDesc')}</p>
      <a href="/v1/aimeat-os" target="_blank" class="btn-primary pf-no-underline pf-inline-block mb-half">${t('profile.apps.downloadGuide')}</a>
      <p class="text-meta">${t('profile.apps.guideDesc')}</p>
    </div>

    <!-- Upload -->
    <button class="btn-primary mb-1" onClick=${() => setShowAppUpload(!showAppUpload)}>${t('profile.apps.uploadBtn')}</button>
    ${showAppUpload && html`<${AppUploadForm} onUpload=${handleUpload} onCancel=${() => setShowAppUpload(false)} />`}

    <!-- My Apps -->
    <div class="section-title section-title-spaced">${t('profile.apps.mine')}</div>
    ${!myApps ? html`<${Spinner} text=${t('profile.apps.loading')} />`
      : myApps.length === 0 ? html`<div class="empty">${t('profile.apps.empty')}</div>`
      : myApps.map(a => html`
        <div class="card">
          <div class="card-header">
            <div class="card-title">${escHtml(a.manifest?.name || a.filename || a.name)}</div>
            <div class="flex-row">
              ${a.manifest?.version ? html`<span class="badge">${'v' + escHtml(a.manifest.version)}</span>` : ''}
              ${a.version_number > 1 ? html`<span class="badge badge-dim">${'#' + a.version_number}</span>` : ''}
              <span class="badge badge-info">${escHtml(a.mime_type || a.content_type || 'html')}</span>
              ${a.protected ? html`<span class="badge badge-warn">\u{1F512}</span>` : ''}
            </div>
          </div>
          ${a.manifest?.description ? html`<div class="text-meta mb-half">${escHtml(a.manifest.description)}</div>` : ''}
          <div class="card-subtitle">
            <a href="${NODE_URL}/v1/apps/${encodeURIComponent(a.owner || session.owner)}/${encodeURIComponent(a.filename || a.name)}" target="_blank">${t('profile.apps.download')}</a>
            ${a.size ? ' \u2022 ' + Math.round(a.size / 1024) + ' KB' : ''}
            ${a.created_at ? ' \u2022 ' + timeAgo(a.created_at) : ''}
            ${a.downloads ? ' \u2022 ' + a.downloads + ' \u{2B07}' : ''}
          </div>
          <div class="flex-row-wrap mb-half">
            <button class="btn-primary btn-sm" onClick=${() => {
              recordRecent({ type: 'app', id: `${a.owner || session.owner}/${a.filename || a.name}`,
                label: a.manifest?.name || String(a.filename || a.name).replace(/\.html?$/i, ''),
                data: { owner: a.owner || session.owner, filename: a.filename || a.name } });
              window.open(`/v1/apps/${encodeURIComponent(a.owner || session.owner)}/${encodeURIComponent(a.filename || a.name)}?mode=inline`, '_blank');
            }}>${t('profile.apps.launch') || 'Launch'}</button>
            <button class="btn-sm" onClick=${() => startEdit(a)}>${t('profile.apps.editAccess') || 'Edit Access Code'}</button>
            <button class="btn-danger-solid btn-sm" onClick=${() => handleDelete(a.filename || a.name)}>${t('profile.apps.deleteBtn') || 'Delete'}</button>
          </div>
          ${editingApp === a.filename ? html`
            <div class="pf-edit-panel">
              <label class="text-meta mb-half">${t('profile.apps.accessCodeLabel') || 'Access Code'}</label>
              <div class="flex-row">
                <input class="input-field pf-flex-fill" placeholder=${t('profile.apps.accessCodePlaceholder') || 'Leave empty to remove protection'} value=${editCode} onInput=${e => setEditCode(e.target.value)} />
                <button class="btn-primary btn-sm" onClick=${() => handleSaveAccessCode(a.filename)}>${t('profile.apps.save') || 'Save'}</button>
                <button class="btn-outline btn-sm" onClick=${cancelEdit}>${t('profile.cancel') || 'Cancel'}</button>
              </div>
              ${editCode.trim() === '' ? html`<div class="text-meta-sm mt-xs">${t('profile.apps.removeProtectionHint') || 'Save empty to remove access code protection'}</div>` : ''}
            </div>
          ` : ''}
        </div>
      `)
    }

    <!-- Gallery -->
    <div class="section-title section-title-spaced">${t('profile.apps.gallery')}</div>
    ${!allApps ? html`<${Spinner} text=${t('profile.apps.galleryLoading')} />`
      : allApps.length === 0 ? html`<div class="empty">${t('profile.apps.galleryEmpty')}</div>`
      : html`<div class="app-grid">
          ${allApps.map(a => {
            const ssUrl = a.screenshot_url ? NODE_URL + a.screenshot_url : null;
            return html`
              <div class="app-card">
                <div class="app-screenshot">
                  ${ssUrl ? html`<img src=${ssUrl} alt=${a.filename} onError=${handleImgError} />` : html`<div class="placeholder">\u{1F4F1}</div>`}
                </div>
                <div class="app-info">
                  <div class="app-name">${escHtml(a.manifest?.name || a.filename)}</div>
                  ${a.manifest?.description ? html`<div class="text-meta-sm">${escHtml(a.manifest.description)}</div>` : ''}
                  <div class="app-meta">
                    ${escHtml(a.owner)} \u2022 ${Math.round((a.size || 0) / 1024)} KB
                    ${a.manifest?.version ? ' \u2022 v' + escHtml(a.manifest.version) : ''}
                    ${a.created_at ? ' \u2022 ' + timeAgo(a.created_at) : ''}
                    ${a.protected ? ' \u2022 \u{1F512} ' + t('profile.apps.protected') : ''}
                  </div>
                  <div class="mb-half"><a href="${NODE_URL + (a.download_url || '/v1/apps/' + encodeURIComponent(a.owner) + '/' + encodeURIComponent(a.filename))}" class="btn-sm pf-no-underline pf-inline-block">${t('profile.apps.download')}</a></div>
                </div>
              </div>`;
          })}
        </div>`
    }
    <${ConfirmUI} />`;
}

function AppUploadForm({ onUpload, onCancel }) {
  const fileRef = useRef(null);
  const ssRef = useRef(null);
  const [code, setCode] = useState('');
  return html`
    <div class="create-form">
      <div class="form-row"><label>${t('profile.apps.fileLabel')}</label><input type="file" ref=${fileRef} class="input-field" accept=".html,.htm" /></div>
      <div class="form-row"><label>${t('profile.apps.screenshotLabel')}</label><input type="file" ref=${ssRef} class="input-field" accept="image/*" /></div>
      <div class="form-row"><label>${t('profile.apps.accessCodeLabel')}</label><input class="input-field" placeholder=${t('profile.apps.accessCodePlaceholder')} value=${code} onInput=${e => setCode(e.target.value)} /></div>
      <div class="form-actions">
        <button class="btn-primary" onClick=${() => onUpload(fileRef.current?.files?.[0], ssRef.current?.files?.[0], code)}>${t('profile.apps.uploadSaveBtn')}</button>
        <button class="btn-outline" onClick=${onCancel}>${t('profile.cancel')}</button>
      </div>
    </div>`;
}
