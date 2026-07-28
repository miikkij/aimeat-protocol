/**
 * @file public/views/portal-dev.upload.js
 * @description Publish pointer + community apps listing (with access-code manager) for the portal-dev view. Extracted from portal-dev.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from portal-dev.js (max-file-lines)
 *   v1.1.0 — 2026-07-28 — UploadSection becomes a pointer to the app catalog. It taught the
 *     obsolete "save the HTML and email it" model, and for signed-in owners it POSTed an inline
 *     base64 body to /v1/apps — a second publish path with no versioning, origin isolation or
 *     share link. Community list leads with Open (the app runs on the node); Download is secondary.
 */
import { useState, useEffect, useCallback } from 'preact/hooks';
import { html, NODE_URL, dt, formatBytes } from './portal-dev.shared.js';
import { swallowed } from '/js/swallowed.js';

/* ══════════════════════════════════════════════
   PUBLISH (Step 4)
   ══════════════════════════════════════════════ */
/* One publish path: the app catalog. This panel used to teach "save the HTML and email it
   around", and for signed-in owners it POSTed an inline base64 body to /v1/apps — a second,
   divergent publish path that skipped the catalog's versioning, origin isolation and share
   link. Replaced 2026-07-28 with a pointer to the one real path. */
function UploadSection({ locale }) {
  const steps = ['publish.step1', 'publish.step2', 'publish.step3'];
  return html`
    <div class="dv-panel">
      <h3>${dt('publish.title', locale)}</h3>
      <p>${dt('publish.desc', locale)}</p>
      <ol class="dv-steps">
        ${steps.map(k => html`<li key=${k}>${dt(k, locale)}</li>`)}
      </ol>
      <a class="btn-primary" href="/app-catalog.html">${dt('publish.cta', locale)}</a>
      <p class="dv-hint">${dt('publish.note', locale)}</p>
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
                : html`
                  <div class="dv-app-actions">
                    <a class="btn-primary dv-app-open"
                       href=${`/v1/apps/${encodeURIComponent(app.owner)}/${encodeURIComponent(app.filename)}?mode=inline`}>
                      ${dt('appList.open', locale)}
                    </a>
                    <a class="dv-app-download" href=${NODE_URL + app.download_url} download>${dt('download', locale)}</a>
                  </div>
                `
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
