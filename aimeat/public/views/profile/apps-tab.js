import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, handleImgError } from '/js/utils.js';
import { Spinner } from './shared.js';
import { listApps, uploadApp } from '/js/services/apps.js';
import { getNodeUrl } from '/js/services/auth.js';

export default function AppsTab({ session, showToast, onStats }) {
  const NODE_URL = getNodeUrl();
  const [myApps, setMyApps] = useState(null);
  const [allApps, setAllApps] = useState(null);
  const [showAppUpload, setShowAppUpload] = useState(false);

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
    const readFile = (f) => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(f); });
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

  return html`
    <div class="section-title">${t('profile.apps.title')}</div>
    <div class="section-desc">${t('profile.apps.desc')}</div>

    <!-- App launcher -->
    <div class="card" style="margin-bottom:1rem">
      <h3 style="color:var(--love1);font-size:1rem;margin-bottom:.5rem">\u{1F680} ${t('profile.apps.launcherTitle')}</h3>
      <p style="font-size:.85rem;color:var(--muted);margin-bottom:.75rem">${t('profile.apps.launcherDesc')}</p>
      <a href="/v1/aimeat-os" target="_blank" class="btn-primary" style="text-decoration:none;display:inline-block">${t('profile.apps.launcherOpen')}</a>
    </div>

    <!-- Create guide -->
    <div class="card" style="margin-bottom:1rem">
      <h3 style="color:var(--love1);font-size:1rem;margin-bottom:.5rem">\u2728 ${t('profile.apps.createGuide')}</h3>
      <p style="font-size:.85rem;color:var(--muted);margin-bottom:.75rem">${t('profile.apps.createGuideDesc')}</p>
      <a href="/v1/aimeat-os" target="_blank" class="btn-primary" style="text-decoration:none;display:inline-block;margin-bottom:.5rem">${t('profile.apps.downloadGuide')}</a>
      <p style="font-size:.8rem;color:var(--muted)">${t('profile.apps.guideDesc')}</p>
    </div>

    <!-- Upload -->
    <button class="btn-primary" style="margin-bottom:1rem" onClick=${() => setShowAppUpload(!showAppUpload)}>${t('profile.apps.uploadBtn')}</button>
    ${showAppUpload && html`<${AppUploadForm} onUpload=${handleUpload} onCancel=${() => setShowAppUpload(false)} />`}

    <!-- My Apps -->
    <div class="section-title" style="margin-top:1.5rem">${t('profile.apps.mine')}</div>
    ${!myApps ? html`<${Spinner} text=${t('profile.apps.loading')} />`
      : myApps.length === 0 ? html`<div class="empty">${t('profile.apps.empty')}</div>`
      : myApps.map(a => html`
        <div class="card">
          <div class="card-header">
            <div class="card-title">${escHtml(a.filename || a.name)}</div>
            <span class="badge badge-info">${escHtml(a.content_type || 'html')}</span>
          </div>
          <div class="card-subtitle">
            <a href="${NODE_URL}/v1/apps/${encodeURIComponent(a.owner || session.owner)}/${encodeURIComponent(a.filename || a.name)}" target="_blank">${t('profile.apps.download')}</a>
            ${a.size ? ' \u2022 ' + Math.round(a.size / 1024) + ' KB' : ''}
          </div>
        </div>
      `)
    }

    <!-- Gallery -->
    <div class="section-title" style="margin-top:1.5rem">${t('profile.apps.gallery')}</div>
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
                  <div class="app-name">${escHtml(a.filename)}</div>
                  <div class="app-meta">${escHtml(a.owner)} \u2022 ${Math.round((a.size || 0) / 1024)} KB${a.protected ? ' \u2022 \u{1F512} ' + t('profile.apps.protected') : ''}</div>
                  <div style="margin-top:.5rem"><a href="${NODE_URL + (a.download_url || '/v1/apps/' + encodeURIComponent(a.owner) + '/' + encodeURIComponent(a.filename))}" class="btn-sm" style="text-decoration:none;display:inline-block">${t('profile.apps.download')}</a></div>
                </div>
              </div>`;
          })}
        </div>`
    }`;
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
