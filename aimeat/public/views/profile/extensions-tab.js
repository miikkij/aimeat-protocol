import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, copyToClipboard } from '/js/utils.js';
import { Spinner } from './shared.js';
import * as cortexService from '/js/services/cortex.js';
import { getNodeUrl, getSession } from '/js/services/auth.js';

const COMP_ICONS = {schema:'\u{1F4D0}',prompt:'\u{1F4AC}',action:'\u26A1','board-template':'\u{1F4CC}',ontology:'\u{1F9EC}','seed-data':'\u{1F331}',lib:'\u{1F4E6}'};
const COMP_COLORS = {schema:'#60a5fa',prompt:'#a78bfa',action:'#f59e0b','board-template':'#34d399',ontology:'#f472b6','seed-data':'#6ee7b7',lib:'#38bdf8'};

const BUNDLED = [
  { id: 'aimeat-charts', icon: '\u{1F4CA}', nameKey: 'profile.extensions.bundled.charts.name', descKey: 'profile.extensions.bundled.charts.desc' },
  { id: 'aimeat-canvas', icon: '\u{1F3A8}', nameKey: 'profile.extensions.bundled.canvas.name', descKey: 'profile.extensions.bundled.canvas.desc' },
];

/* ── Cortex scaffolding prompt builder ── */
function buildCortexPrompt(sess) {
  const url = getNodeUrl();
  const owner = sess?.owner || 'user';
  return `You are a Cortex extension builder for the AIMEAT protocol.

The user wants to create a custom UI extension for their AIMEAT node.
Node URL: ${url}
Owner: ${owner}

A Cortex extension is a YAML manifest that bundles reusable building blocks:
schemas (data validation), prompts (AI instructions), actions (API integrations),
board templates (discussion forums), ontologies (concept graphs), seed data
(example records), and libraries (JavaScript code for UI widgets).

The extension can then be used across multiple apps on the user's AIMEAT node.

────────────────────────────────────────────
YAML MANIFEST STRUCTURE
────────────────────────────────────────────

Every extension is a single YAML file with this top-level structure:

apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: my-extension          # unique name, lowercase, hyphens ok
  namespace: ${owner}         # owner's namespace
  description: "..."          # what this extension does
  author: ${owner}
  tags: [tag1, tag2]          # for discovery
  labels:
    domain: general           # category

spec:
  version: "1.0.0"
  license: MIT                # optional
  components:                 # list of components below
    - type: schema
      ...

The "components" array can contain any mix of the 7 component types:
schema, prompt, action, board-template, ontology, seed-data, lib.

────────────────────────────────────────────
NODE INFO (auto-filled)
────────────────────────────────────────────

Node URL: ${url}
Owner: ${owner}

Storage API:
  GET    ${url}/v1/memory/:key            — read a value
  PUT    ${url}/v1/memory/:key            — write a value
  GET    ${url}/v1/memory?prefix=mydata:  — list keys by prefix
  DELETE ${url}/v1/memory/:key            — delete a value

Extension API:
  POST   ${url}/v1/cortex                 — install extension (body: {manifest, libs?})
  GET    ${url}/v1/cortex                 — list installed extensions
  GET    ${url}/v1/cortex/:name           — get extension details

────────────────────────────────────────────
YOUR TASK
────────────────────────────────────────────

Now ask the user what they want to build! Based on what they describe:
1. Design the YAML manifest with appropriate components
2. If UI widgets are needed, create the JavaScript library too
3. Explain what each component does
4. Provide the complete YAML (and JS if applicable) ready to paste

To install: go to Profile > Extensions > + Add > paste the YAML manifest > add JS files if any > click Install.`;
}

export default function ExtensionsTab({ session, showToast }) {
  const NODE_URL = getNodeUrl();
  const [extensions, setExtensions] = useState(null);
  const [extDetailName, setExtDetailName] = useState(null);
  const [extDetail, setExtDetail] = useState(null);
  const [showInstall, setShowInstall] = useState(false);
  const [manifestMode, setManifestMode] = useState('upload');
  const [libMode, setLibMode] = useState('upload');
  const [libEntries, setLibEntries] = useState([{filename:'', code:''}]);
  const [bundledInstalling, setBundledInstalling] = useState(null);

  useEffect(() => {
    if (session) loadExtensions();
  }, [session]);

  async function loadExtensions() {
    try {
      const resp = await cortexService.listExtensions();
      setExtensions(resp?.extensions || []);
    } catch { setExtensions([]); }
  }

  async function loadDetail(name) {
    setExtDetailName(name);
    setExtDetail(null);
    try {
      const ext = await cortexService.getExtensionDetail(name);
      setExtDetail(ext);
    } catch(e) { setExtDetail({ error: e.message }); }
  }

  async function activateExt(name) {
    try {
      const resp = await cortexService.activateExtension(name);
      if (resp.ok === false) throw new Error(resp.error?.message || 'Activation failed');
      showToast(t('profile.extensions.success.activated'));
      loadExtensions();
      setExtDetailName(null);
    } catch(e) { showToast(e.message, true); }
  }

  async function deactivateExt(name) {
    try {
      const resp = await cortexService.deactivateExtension(name);
      if (resp.ok === false) throw new Error(resp.error?.message || 'Deactivation failed');
      showToast(t('profile.extensions.success.deactivated'));
      loadExtensions();
      setExtDetailName(null);
    } catch(e) { showToast(e.message, true); }
  }

  async function uninstallExt(name) {
    if (!confirm(t('profile.extensions.uninstallConfirm'))) return;
    try {
      const resp = await cortexService.uninstallExtension(name);
      if (resp.ok === false) throw new Error(resp.error?.message || 'Uninstall failed');
      showToast(t('profile.extensions.success.uninstalled'));
      loadExtensions();
      setExtDetailName(null);
    } catch(e) { showToast(e.message, true); }
  }

  async function handleToggleVisibility(name, currentVis) {
    try {
      const resp = await cortexService.toggleVisibility(name, currentVis);
      if (resp.ok === false) throw new Error(resp.error?.message || 'Visibility change failed');
      const newVis = currentVis === 'public' ? 'private' : 'public';
      showToast(newVis === 'public' ? t('profile.extensions.publish') : t('profile.extensions.unpublish'));
      loadExtensions();
      if (extDetailName === name) loadDetail(name);
    } catch(e) { showToast(e.message, true); }
  }

  async function handleInstall(e) {
    e.preventDefault();
    try {
      let manifest = '';
      if (manifestMode === 'upload') {
        const fileInput = document.getElementById('ext-manifest-file');
        if (!fileInput?.files[0]) throw new Error('No manifest file selected');
        manifest = await fileInput.files[0].text();
      } else {
        const textarea = document.getElementById('ext-manifest-text');
        manifest = textarea?.value || '';
        if (!manifest.trim()) throw new Error('Manifest is empty');
      }

      const libs = {};
      if (libMode === 'upload') {
        const libInput = document.getElementById('ext-lib-files');
        if (libInput?.files) {
          for (const f of libInput.files) {
            libs[f.name] = await f.text();
          }
        }
      } else {
        libEntries.forEach(entry => {
          if (entry.filename.trim() && entry.code.trim()) {
            libs[entry.filename.trim()] = entry.code;
          }
        });
      }

      const resp = await cortexService.installExtension(manifest, Object.keys(libs).length > 0 ? libs : undefined);
      if (resp.ok === false) throw new Error(resp.error?.message || 'Install failed');
      showToast(t('profile.extensions.success.installed'));
      setShowInstall(false);
      setManifestMode('upload');
      setLibMode('upload');
      setLibEntries([{filename:'', code:''}]);
      loadExtensions();
    } catch(e) {
      showToast(t('profile.extensions.error.installFailed') + ': ' + e.message, true);
    }
  }

  async function handleInstallBundled(name) {
    setBundledInstalling(name);
    try {
      const resp = await cortexService.installBundledExtension(name, session.owner);
      if (resp.ok === false) throw new Error(resp.error?.message || 'Install failed');
      showToast(t('profile.extensions.success.installed'));
      loadExtensions();
    } catch(e) {
      showToast(e.message, true);
    } finally {
      setBundledInstalling(null);
    }
  }

  function copyExtPrompt() {
    const sess = getSession() || {};
    const prompt = buildCortexPrompt(sess);
    copyToClipboard(prompt);
    showToast(t('profile.extensions.promptCopied'));
  }

  // ── Detail view ──
  if (extDetailName) {
    if (!extDetail) return html`<div><button class="btn-outline" onClick=${() => setExtDetailName(null)}>${t('profile.extensions.detail.back')}</button><br/><${Spinner} text=${t('profile.extensions.loading')} /></div>`;
    if (extDetail.error) return html`<div><button class="btn-outline" onClick=${() => setExtDetailName(null)}>${t('profile.extensions.detail.back')}</button><div class="empty">Error: ${extDetail.error}</div></div>`;

    const ext = extDetail;
    const comps = ext.components || [];
    const isActive = ext.status === 'active';
    const vis = ext.visibility || 'private';

    return html`<div>
      <button class="btn-outline" onClick=${() => setExtDetailName(null)}>${t('profile.extensions.detail.back')}</button>
      <div style="margin:1.5rem 0">
        <div style="font-size:1.3rem;font-weight:700;margin-bottom:.5rem">
          ${ext.name}
          <span style="font-size:.8rem;font-weight:400;color:var(--muted)">v${ext.version || '?'}</span>
          <span class="ext-visibility-badge ${vis}">${vis === 'public' ? '\u{1F310}' : '\u{1F512}'} ${t('profile.extensions.visibility.' + vis)}</span>
        </div>
        <div style="font-size:.95rem;color:var(--muted);line-height:1.6;margin-bottom:1rem">${ext.description || ''}</div>
        <div style="display:flex;gap:1.5rem;font-size:.85rem;color:var(--muted);margin-bottom:1.5rem;flex-wrap:wrap">
          <span>${t('profile.extensions.detail.author')}: ${ext.author || '?'}</span>
          ${ext.license ? html`<span>${t('profile.extensions.detail.license')}: ${ext.license}</span>` : null}
          <span><span class="ext-status-dot ${ext.status}"></span> ${t('profile.extensions.status.' + ext.status)}</span>
          <span>${t('profile.extensions.detail.tags')}: ${(ext.tags || []).join(', ')}</span>
        </div>
      </div>

      <div class="ext-detail-section">
        <div class="ext-detail-section-title">${t('profile.extensions.detail.whatsIncluded')}</div>
        ${comps.map(c => html`<div>${COMP_ICONS[c.type] || '\u{1F4C4}'} ${t('profile.extensions.components.' + c.type) || c.type}: ${c.type === 'schema' ? c.key_pattern : (c.name || c.filename || '')}</div>`)}
      </div>

      ${comps.filter(c => c.type === 'prompt').map(p => {
        const content = p._content || p.content || '';
        return html`
          <div class="ext-detail-section">
            <div class="ext-detail-section-title">${'\u{1F4AC}'} Prompt: ${p.name} <button class="ext-copy-btn" onClick=${() => { copyToClipboard(content); showToast(t('profile.extensions.detail.copied')); }}>${t('profile.extensions.detail.copyPrompt')}</button></div>
            <div class="ext-detail-code">${content.substring(0, 500)}${content.length > 500 ? '...' : ''}</div>
          </div>`;
      })}

      ${comps.filter(c => c.type === 'lib').map(lib => {
        const scriptUrl = NODE_URL + '/v1/cortex/' + encodeURIComponent(ext.name) + '/libs/' + encodeURIComponent(lib.filename);
        const scriptTag = '<script src="' + scriptUrl + '"><\/script>';
        return html`
          <div class="ext-detail-section">
            <div class="ext-detail-section-title">${'\u{1F4E6}'} Library: ${lib.filename}</div>
            <div style="margin-bottom:.5rem;font-size:.85rem;color:var(--muted)">${t('profile.extensions.detail.exports')}: ${(lib.exports || []).join(', ')}</div>
            <div style="font-size:.85rem;font-weight:600;margin-bottom:4px">${t('profile.extensions.detail.scriptTag')} <button class="ext-copy-btn" onClick=${() => { copyToClipboard(scriptTag); showToast(t('profile.extensions.detail.copied')); }}>${t('profile.extensions.detail.copyUrl')}</button></div>
            <div class="ext-detail-code">${scriptTag}</div>
            ${lib.api_surface ? html`<div>
              <div style="font-size:.85rem;font-weight:600;margin-top:.75rem;margin-bottom:4px">${t('profile.extensions.detail.apiSurface')} <button class="ext-copy-btn" onClick=${() => { copyToClipboard(lib.api_surface); showToast(t('profile.extensions.detail.copied')); }}>${t('profile.extensions.detail.copyApi')}</button></div>
              <div class="ext-detail-code">${lib.api_surface}</div>
            </div>` : null}
          </div>`;
      })}

      ${comps.filter(c => c.type === 'schema').length > 0 ? html`
        <div class="ext-detail-section">
          <div class="ext-detail-section-title">${'\u{1F4D0}'} Schemas</div>
          ${comps.filter(c => c.type === 'schema').map(s => html`<div style="font-size:.85rem;color:var(--muted);margin-bottom:.25rem">${s.key_pattern} (${s.apply_to || ''})</div>`)}
        </div>` : null}

      ${(ext._ontologies || []).map(ont => html`
        <div class="ext-detail-section">
          <div class="ext-detail-section-title">${'\u{1F9EC}'} Ontology: ${ont.name}</div>
          <div style="font-size:.85rem;color:var(--muted)">${Object.entries(ont.concepts || {}).map(([k, c]) => k + ' (' + (c.label?.en || k) + ')').join(', ')}</div>
        </div>`)}

      <div style="display:flex;gap:1rem;margin-top:1.5rem;flex-wrap:wrap">
        ${isActive
          ? html`<button class="btn-outline" onClick=${() => deactivateExt(ext.name)}>${t('profile.extensions.deactivate')}</button>`
          : html`<button class="btn-primary" onClick=${() => activateExt(ext.name)}>${t('profile.extensions.activate')}</button>`}
        <button class="btn-outline" onClick=${() => handleToggleVisibility(ext.name, vis)}>
          ${vis === 'public' ? t('profile.extensions.unpublish') : t('profile.extensions.publish')}
        </button>
        <button class="btn-outline" style="border-color:rgba(239,68,68,0.3);color:#f87171" onClick=${() => uninstallExt(ext.name)}>${t('profile.extensions.uninstall')}</button>
      </div>
    </div>`;
  }

  // ── Grid view ──
  const hasExtensions = extensions && extensions.length > 0;
  const installedNames = (extensions || []).map(e => e.name);
  const unbundled = BUNDLED.filter(b => !installedNames.includes(b.id));

  return html`<div>
    <div class="ext-hero">
      <div class="section-title">${'\u{1F9E9}'} ${t('profile.extensions.title')}</div>
      ${!hasExtensions
        ? html`<div class="ext-hero-desc">${t('profile.extensions.heroDesc')}</div>`
        : html`<div class="section-desc">${t('profile.extensions.desc')}</div>`}
      <div class="ext-hero-actions">
        <button class="btn-primary" onClick=${copyExtPrompt}>${'\u{1F916}'} ${t('profile.extensions.createWithAi')}</button>
        <button class="btn-outline" onClick=${() => setShowInstall(true)}>${t('profile.extensions.install')}</button>
      </div>
    </div>

    ${!extensions ? html`<${Spinner} text=${t('profile.extensions.loading')} />`
      : hasExtensions ? html`<div>
        <div style="font-size:.95rem;font-weight:600;margin-bottom:.75rem;margin-top:1.5rem;color:var(--muted)">${t('profile.extensions.installed')} (${extensions.length})</div>
        <div class="ext-grid">
          ${extensions.map(ext => {
            const types = ext.component_types || [];
            const isActive = ext.status === 'active';
            const vis = ext.visibility || 'private';
            return html`
              <div class="ext-card" onClick=${() => loadDetail(ext.name)}>
                <div class="ext-card-header">
                  <span class="ext-card-name">${ext.name}</span>
                  <span class="ext-card-version">v${ext.version || '?'}</span>
                  <span class="ext-visibility-badge ${vis}">${vis === 'public' ? '\u{1F310}' : '\u{1F512}'}</span>
                </div>
                <div class="ext-card-desc">${ext.description || ''}</div>
                <div class="ext-card-tags">
                  ${types.map(ct => html`<span class="ext-comp-tag" style="color:${COMP_COLORS[ct] || 'var(--muted)'}">${t('profile.extensions.components.' + ct) || ct}</span>`)}
                </div>
                <div class="ext-card-footer">
                  <span class="ext-status"><span class="ext-status-dot ${ext.status}"></span> ${t('profile.extensions.status.' + ext.status)}</span>
                  <span class="ext-card-actions">
                    ${isActive
                      ? html`<button onClick=${(e) => { e.stopPropagation(); deactivateExt(ext.name); }}>${t('profile.extensions.deactivate')}</button>`
                      : html`<button onClick=${(e) => { e.stopPropagation(); activateExt(ext.name); }}>${t('profile.extensions.activate')}</button>`}
                    <button class="danger" onClick=${(e) => { e.stopPropagation(); uninstallExt(ext.name); }}>${t('profile.extensions.uninstall')}</button>
                  </span>
                </div>
              </div>`;
          })}
        </div>
      </div>` : null}

    ${!hasExtensions && unbundled.length === 0 ? html`<div class="empty">${t('profile.extensions.empty')}</div>` : null}

    ${extensions && unbundled.length > 0 ? html`
      <div style="margin-top:${hasExtensions ? '2rem' : '0'}">
        <div style="font-size:.95rem;font-weight:600;margin-bottom:.75rem;color:var(--muted)">${t('profile.extensions.readyExtensions')}</div>
        <div class="ext-bundled-grid">
          ${unbundled.map(b => html`
            <div class="ext-bundled-card">
              <div class="ext-bundled-icon">${b.icon}</div>
              <div class="ext-bundled-name">${t(b.nameKey)}</div>
              <div class="ext-bundled-desc">${t(b.descKey)}</div>
              <button class="btn-primary" style="font-size:.85rem;padding:.5rem 1rem"
                disabled=${bundledInstalling === b.id}
                onClick=${() => handleInstallBundled(b.id)}>
                ${bundledInstalling === b.id ? html`<${Spinner} />` : t('profile.extensions.addThis')}
              </button>
            </div>`)}
        </div>
      </div>` : null}

    ${showInstall ? html`
      <div class="modal-overlay" onClick=${(e) => { if (e.target === e.currentTarget) setShowInstall(false); }}>
        <div class="modal" style="max-width:600px">
          <h3>${t('profile.extensions.installModal.title')}</h3>
          <form onSubmit=${handleInstall}>
            <div style="margin-top:1rem">
              <label>${t('profile.extensions.installModal.manifestLabel')}</label>
              <div style="display:flex;gap:1rem;margin:.5rem 0">
                <label><input type="radio" name="ext-mmode" checked=${manifestMode==='upload'} onChange=${() => setManifestMode('upload')} /> ${t('profile.extensions.installModal.uploadFile')}</label>
                <label><input type="radio" name="ext-mmode" checked=${manifestMode==='paste'} onChange=${() => setManifestMode('paste')} /> ${t('profile.extensions.installModal.pasteYaml')}</label>
              </div>
              ${manifestMode === 'upload'
                ? html`<input type="file" id="ext-manifest-file" accept=".yaml,.yml" />`
                : html`<textarea id="ext-manifest-text" rows="10" style="width:100%;font-family:monospace;font-size:13px" placeholder="apiVersion: cortex.aimeat.org/v1\nkind: Extension\n..."></textarea>`}
            </div>

            <div style="margin-top:1rem">
              <label>${t('profile.extensions.installModal.libsLabel')}</label>
              <div style="display:flex;gap:1rem;margin:.5rem 0">
                <label><input type="radio" name="ext-lmode" checked=${libMode==='upload'} onChange=${() => setLibMode('upload')} /> ${t('profile.extensions.installModal.uploadFiles')}</label>
                <label><input type="radio" name="ext-lmode" checked=${libMode==='paste'} onChange=${() => setLibMode('paste')} /> ${t('profile.extensions.installModal.pasteCode')}</label>
              </div>
              ${libMode === 'upload'
                ? html`<input type="file" id="ext-lib-files" accept=".js" multiple />`
                : html`<div>
                    ${libEntries.map((entry, i) => html`
                      <div style="margin-bottom:.75rem;padding:.75rem;background:rgba(0,0,0,.2);border-radius:8px">
                        <input type="text" placeholder=${t('profile.extensions.installModal.filenamePlaceholder')} value=${entry.filename} onInput=${(e) => { const arr = [...libEntries]; arr[i] = {...arr[i], filename: e.target.value}; setLibEntries(arr); }} style="width:100%;margin-bottom:.5rem" />
                        <textarea rows="6" placeholder="(function(AIMEAT) { ... })(...)" value=${entry.code} onInput=${(e) => { const arr = [...libEntries]; arr[i] = {...arr[i], code: e.target.value}; setLibEntries(arr); }} style="width:100%;font-family:monospace;font-size:13px"></textarea>
                      </div>`)}
                    <button type="button" class="btn-outline" style="font-size:.85rem" onClick=${() => setLibEntries([...libEntries, {filename:'', code:''}])}>${t('profile.extensions.installModal.addLib')}</button>
                  </div>`}
            </div>

            <div style="display:flex;justify-content:flex-end;gap:1rem;margin-top:1.5rem">
              <button type="button" class="btn-outline" onClick=${() => setShowInstall(false)}>${t('profile.extensions.installModal.cancel')}</button>
              <button type="submit" class="btn-primary">${t('profile.extensions.installModal.installBtn')}</button>
            </div>
          </form>
        </div>
      </div>` : null}
  </div>`;
}
