/**
 * @file public/views/portal-dev.upload.js
 * @description App upload/share section + community apps listing (with access-code manager) for the portal-dev view. Extracted from portal-dev.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from portal-dev.js (max-file-lines)
 */
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { html, NODE_URL, dt, formatBytes, CopyBtn } from './portal-dev.shared.js';
import { swallowed } from '/js/swallowed.js';

/* ══════════════════════════════════════════════
   UPLOAD SECTION (Step 4)
   ══════════════════════════════════════════════ */
function UploadSection({ locale, isLoggedIn, session }) {
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [accessCode, setAccessCode] = useState('');
  const [dragover, setDragover] = useState(false);
  const inputRef = useRef(null);

  const handleUpload = useCallback(async (file) => {
    if (!session) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const arrayBuf = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const b64 = btoa(binary);

      const body = { filename: file.name, content: b64, mime_type: 'text/html' };
      if (accessCode.trim()) body.access_code = accessCode.trim();

      const resp = await session.fetch('/v1/apps', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const data = resp.data || resp;
      const downloadUrl = NODE_URL + (data.download_url || '/v1/apps/' + encodeURIComponent(session.owner) + '/' + encodeURIComponent(file.name));
      setUploadResult({ ok: true, downloadUrl, protected: data.protected, filename: file.name, size: file.size });
    } catch (e) {
      setUploadResult({ ok: false, error: e.message });
    }
    setUploading(false);
  }, [session, accessCode]);

  if (!isLoggedIn) {
    return html`
      <div class="dv-panel">
        <h3>\ud83d\udccc ${dt('uploadSection.shareTitle', locale)}</h3>
        <p>${dt('uploadSection.shareDesc', locale)}</p>
        <ol style="margin-left:1.5rem;margin-bottom:1rem">
          <li>${dt('uploadSection.shareStep1', locale)}</li>
          <li>${dt('uploadSection.shareStep2', locale)}</li>
          <li>${dt('uploadSection.shareStep3', locale)}</li>
        </ol>
        <div class="dv-mode-notice dv-mode-notice-anon" style="margin:0">
          <div class="dv-notice-icon">\ud83d\udca1</div>
          <div><strong>${dt('uploadSection.wantEasier', locale)}</strong> ${dt('uploadSection.downloadLinkNote', locale)}<br/>
            <code style="font-size:.8rem;color:var(--accent)">${NODE_URL}/v1/apps/yourname/my-app.html</code>
          </div>
        </div>
      </div>
    `;
  }

  return html`
    <div class="dv-panel">
      <h3>\ud83d\udce4 ${dt('upload', locale)}</h3>
      <p>${dt('uploadSection.desc', locale)}</p>
      <div style="margin-bottom:1rem">
        <label style="font-size:.85rem;font-weight:600;display:block;margin-bottom:.4rem">${dt('uploadSection.accessCodeLabel', locale)}</label>
        <input type="text" placeholder=${dt('uploadSection.accessCodePlaceholder', locale)}
               style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:.4rem .6rem;color:var(--text);font-size:.85rem;width:100%;max-width:300px"
               maxlength="64" value=${accessCode} onInput=${e => setAccessCode(e.target.value)} />
        <p style="font-size:.75rem;color:var(--muted);margin-top:.25rem">${dt('uploadSection.accessCodeNote', locale)}</p>
      </div>
      <div class=${`dv-upload-area ${dragover ? 'dragover' : ''}`}
           onDragOver=${e => { e.preventDefault(); setDragover(true); }}
           onDragLeave=${() => setDragover(false)}
           onDrop=${e => { e.preventDefault(); setDragover(false); if (e.dataTransfer.files.length > 0) handleUpload(e.dataTransfer.files[0]); }}>
        <p style="margin-bottom:.5rem">${dt('uploadSection.dragDrop', locale)}</p>
        <input type="file" ref=${inputRef} accept=".html,.htm" style="display:none"
               onChange=${e => { if (e.target.files.length > 0) handleUpload(e.target.files[0]); }} />
        <button class="dv-upload-btn" type="button" disabled=${uploading}
                onClick=${() => inputRef.current?.click()}>
          ${uploading ? dt('uploading', locale) : dt('uploadSection.chooseFile', locale)}
        </button>
      </div>
      ${uploadResult && (uploadResult.ok
        ? html`
          <div style="margin-top:1rem">
            <div style="color:var(--success);font-weight:600;margin-bottom:.5rem">\u2705 ${dt('uploaded', locale)}${uploadResult.protected ? ' \ud83d\udd12' : ''}</div>
            <p>${dt('shareLink', locale)}:</p>
            <div class="dv-share-url">
              <input type="text" value=${uploadResult.downloadUrl} readonly />
              <${CopyBtn} text=${uploadResult.downloadUrl} locale=${locale} />
            </div>
            <p style="font-size:.8rem;color:var(--muted);margin-top:.5rem">${dt('uploadSection.fileSize', locale)}${formatBytes(uploadResult.size)}</p>
          </div>
        `
        : html`<p style="color:var(--danger);margin-top:.75rem">${dt('uploadFailed', locale)}: ${uploadResult.error}</p>`
      )}
    </div>
  `;
}

/* ══════════════════════════════════════════════
   COMMUNITY APPS
   ══════════════════════════════════════════════ */
function CommunityApps({ locale, isLoggedIn, session }) {
  const [apps, setApps] = useState([]);

  useEffect(() => {
    fetch('/v1/apps')
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.data?.apps) setApps(d.data.apps);
      })
      .catch(err => { swallowed('portal-dev.upload: CommunityApps', err); });
  }, []);

  const [codePending, setCodePending] = useState({});

  const updateAppCode = useCallback(async (filename, newCode) => {
    if (!session) return;
    setCodePending(p => ({ ...p, [filename]: 'updating' }));
    try {
      const resp = await session.fetch('/v1/apps/' + encodeURIComponent(filename), {
        method: 'PATCH',
        body: JSON.stringify({ access_code: newCode || null }),
      });
      const d = resp.data || resp;
      setCodePending(p => ({ ...p, [filename]: d.protected ? 'updated' : 'removed' }));
      // Reload
      fetch('/v1/apps').then(r => r.json()).then(d2 => {
        if (d2.ok && d2.data?.apps) setApps(d2.data.apps);
      });
    } catch (err) {
      swallowed('portal-dev.upload: CommunityApps', err);
      setCodePending(p => ({ ...p, [filename]: 'error' }));
    }
  }, [session]);

  if (apps.length === 0) return null;

  return html`
    <div style="margin-top:2rem">
      <h2>\ud83d\udce6 ${dt('community.title', locale)}</h2>
      <p style="color:var(--muted);font-size:.9rem">${dt('community.desc', locale)}</p>
      <div class="dv-app-list">
        ${apps.map(app => {
          const codeInputId = 'dl-' + app.owner + '-' + app.filename;
          return html`
            <div class="dv-app-item" key=${app.filename + app.owner}>
              <div class="dv-app-name">
                ${app.filename}
                ${app.protected && html`<span style="color:var(--warn);font-size:.75rem"> \ud83d\udd12 ${dt('appList.protected', locale)}</span>`}
              </div>
              <div class="dv-app-meta">${dt('appList.by', locale)}${app.owner} \u00b7 ${formatBytes(app.size)}</div>
              ${app.protected
                ? html`
                  <div style="margin-top:.5rem;display:flex;gap:.4rem;align-items:center">
                    <input type="text" placeholder=${dt('appList.accessCode', locale)} id=${codeInputId}
                           style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:.25rem .4rem;color:var(--text);font-size:.8rem;width:120px" />
                    <a href="#" onClick=${e => {
                      e.preventDefault();
                      const code = /** @type {HTMLInputElement} */ (document.getElementById(codeInputId))?.value?.trim();
                      if (!code) return;
                      window.open(NODE_URL + app.download_url + '?code=' + encodeURIComponent(code));
                    }} style="font-size:.85rem">\u2b07 ${dt('download', locale)}</a>
                  </div>
                `
                : html`<a href=${NODE_URL + app.download_url} download style="display:inline-block;margin-top:.5rem;font-size:.85rem">\u2b07 ${dt('download', locale)}</a>`
              }
              ${isLoggedIn && session?.owner === app.owner && html`
                <div style="margin-top:.5rem;padding-top:.5rem;border-top:1px solid var(--border)">
                  <${AppCodeManager} filename=${app.filename} isProtected=${app.protected} locale=${locale}
                    onUpdate=${(fname, code) => updateAppCode(fname, code)} status=${codePending[app.filename]} />
                </div>
              `}
            </div>
          `;
        })}
      </div>
    </div>
  `;
}

function AppCodeManager({ filename, isProtected, locale, onUpdate, status }) {
  const [code, setCode] = useState('');
  return html`
    <div style="display:flex;gap:.3rem;align-items:center">
      <input type="text" value=${code} onInput=${e => setCode(e.target.value)}
             placeholder=${isProtected ? dt('appList.newCodePlaceholder', locale) : dt('appList.setCodePlaceholder', locale)}
             style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:.2rem .4rem;color:var(--text);font-size:.8rem;width:140px" />
      <button style="background:var(--accent);color:var(--bg);border:none;border-radius:4px;padding:.2rem .5rem;cursor:pointer;font-size:.75rem;font-weight:600"
              type="button" onClick=${() => onUpdate(filename, code.trim())}>\ud83d\udd11</button>
    </div>
    ${status && html`
      <div style="font-size:.75rem;margin-top:.2rem;color:${status === 'error' ? 'var(--danger)' : 'var(--success)'}">
        ${status === 'updating' ? dt('status.updating', locale) :
          status === 'updated' ? '\u2705 ' + dt('status.codeUpdatedShort', locale) :
          status === 'removed' ? '\u2705 ' + dt('status.codeRemovedShort', locale) :
          status === 'error' ? 'Error' : ''}
      </div>
    `}
  `;
}

export { UploadSection, CommunityApps };
