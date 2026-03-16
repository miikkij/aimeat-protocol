import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, copyToClipboard } from '/js/utils.js';
import { Spinner } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import * as cortexService from '/js/services/cortex.js';
import * as v8Ext from '/js/services/extensions.js';
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
  const { confirm, ConfirmUI } = useConfirm();
  const NODE_URL = getNodeUrl();
  const [extensions, setExtensions] = useState(null);
  const [extDetailName, setExtDetailName] = useState(null);
  const [extDetail, setExtDetail] = useState(null);
  const [showInstall, setShowInstall] = useState(false);
  const [manifestMode, setManifestMode] = useState('upload');
  const [libMode, setLibMode] = useState('upload');
  const [libEntries, setLibEntries] = useState([{filename:'', code:''}]);
  const [bundledInstalling, setBundledInstalling] = useState(null);

  // V8 extension state
  const [v8Exts, setV8Exts] = useState(null);
  const [v8Detail, setV8Detail] = useState(null);
  const [v8Instances, setV8Instances] = useState(null);
  const [newInstanceId, setNewInstanceId] = useState('');
  const [testAction, setTestAction] = useState(null); // { actionId }
  const [testInput, setTestInput] = useState('{}');
  const [testResult, setTestResult] = useState(null);
  const [testRunning, setTestRunning] = useState(false);

  useEffect(() => {
    if (session) { loadExtensions(); loadV8Extensions(); }
  }, [session]);

  // Auto-refresh on SSE live updates (extension install/activate/etc)
  useEffect(() => {
    const handler = () => { loadExtensions(); loadV8Extensions(); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  async function loadExtensions() {
    try {
      const resp = await cortexService.listExtensions();
      setExtensions(resp?.extensions || []);
    } catch { setExtensions([]); }
  }

  async function loadV8Extensions() {
    try { setV8Exts(await v8Ext.listV8Extensions()); } catch { setV8Exts([]); }
  }

  async function loadV8Detail(name) {
    setV8Detail(null);
    setV8Instances(null);
    setNewInstanceId('');
    try {
      const ext = await v8Ext.getV8Extension(name);
      setV8Detail(ext);
      try { setV8Instances(await v8Ext.listInstances(name)); } catch { setV8Instances([]); }
    } catch(e) { setV8Detail({ error: e.message }); }
  }

  async function handleV8Activate(name) {
    try {
      const resp = await v8Ext.activateV8Extension(name);
      if (resp.ok === false) throw new Error(resp.error?.message || 'Failed');
      showToast(t('profile.v8ext.activated'));
      loadV8Extensions();
      if (v8Detail?.name === name) loadV8Detail(name);
    } catch(e) { showToast(e.message, true); }
  }

  async function handleV8Deactivate(name) {
    try {
      const resp = await v8Ext.deactivateV8Extension(name);
      if (resp.ok === false) throw new Error(resp.error?.message || 'Failed');
      showToast(t('profile.v8ext.deactivated'));
      loadV8Extensions();
      if (v8Detail?.name === name) loadV8Detail(name);
    } catch(e) { showToast(e.message, true); }
  }

  async function handleV8Delete(name) {
    confirm(t('profile.v8ext.confirmDelete'), async () => {
      try {
        const resp = await v8Ext.deleteV8Extension(name);
        if (resp.ok === false) throw new Error(resp.error?.message || 'Failed');
        showToast(t('profile.v8ext.deleted'));
        setV8Detail(null);
        loadV8Extensions();
      } catch(e) { showToast(e.message, true); }
    }, { danger: true });
  }

  async function handleCreateInstance(name) {
    const id = newInstanceId.trim();
    if (!id) { showToast(t('profile.v8ext.instanceIdRequired'), true); return; }
    try {
      const resp = await v8Ext.createInstance(name, id, {});
      if (resp.ok === false) throw new Error(resp.error?.message || 'Failed');
      showToast(t('profile.v8ext.instanceCreated'));
      setNewInstanceId('');
      setV8Instances(await v8Ext.listInstances(name));
    } catch(e) { showToast(e.message, true); }
  }

  async function handleTestAction(name, actionId) {
    setTestRunning(true);
    setTestResult(null);
    try {
      let input = {};
      try { input = JSON.parse(testInput); } catch { throw new Error(t('profile.v8ext.test.invalidJson')); }
      const start = performance.now();
      const resp = await v8Ext.executeAction(name, actionId, input);
      const elapsed = Math.round(performance.now() - start);
      setTestResult({ ok: true, data: resp, elapsed });
    } catch(e) {
      setTestResult({ ok: false, error: e.message });
    } finally { setTestRunning(false); }
  }

  async function handleDeleteInstance(name, instanceId) {
    confirm(t('profile.v8ext.confirmDeleteInstance'), async () => {
      try {
        const resp = await v8Ext.deleteInstance(name, instanceId);
        if (resp.ok === false) throw new Error(resp.error?.message || 'Failed');
        showToast(t('profile.v8ext.instanceDeleted'));
        setV8Instances(await v8Ext.listInstances(name));
      } catch(e) { showToast(e.message, true); }
    }, { danger: true });
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
    confirm(t('profile.extensions.uninstallConfirm'), async () => {
      try {
        const resp = await cortexService.uninstallExtension(name);
        if (resp.ok === false) throw new Error(resp.error?.message || 'Uninstall failed');
        showToast(t('profile.extensions.success.uninstalled'));
        loadExtensions();
        setExtDetailName(null);
      } catch(e) { showToast(e.message, true); }
    }, { danger: true });
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
      <${ConfirmUI} />
    </div>`;
  }

  // ── V8 detail view ──
  if (v8Detail) {
    if (v8Detail.error) return html`<div><button class="btn-outline" onClick=${() => setV8Detail(null)}>${t('profile.v8ext.back')}</button><div class="empty">Error: ${v8Detail.error}</div></div>`;
    const ext = v8Detail;
    const isActive = ext.status === 'active';
    const actions = ext.actions || [];
    const supportsInstances = ext.instances?.supported;

    return html`<div>
      <button class="btn-outline" onClick=${() => setV8Detail(null)}>${t('profile.v8ext.back')}</button>
      <div style="margin:1.5rem 0">
        <div style="font-size:1.3rem;font-weight:700;margin-bottom:.5rem">
          ${ext.name}
          <span style="font-size:.8rem;font-weight:400;color:var(--muted)">v${ext.version || '?'}</span>
        </div>
        <div style="font-size:.95rem;color:var(--muted);line-height:1.6;margin-bottom:1rem">${ext.description || ''}</div>
        <div style="display:flex;gap:1.5rem;font-size:.85rem;color:var(--muted);margin-bottom:1rem;flex-wrap:wrap">
          <span>${t('profile.v8ext.author')}: ${ext.author || '?'}</span>
          <span><span class="ext-status-dot ${ext.status}"></span> ${isActive ? t('profile.v8ext.statusActive') : t('profile.v8ext.statusInactive')}</span>
          <span>${t('profile.v8ext.actions')}: ${actions.length}</span>
        </div>
      </div>

      ${actions.length > 0 ? html`
        <div class="ext-detail-section">
          <div class="ext-detail-section-title">${t('profile.v8ext.actionsTitle')}</div>
          ${actions.map(a => html`
            <div style="border-bottom:1px solid var(--border,#E5E7EB);padding:.5rem 0">
              <div style="display:flex;align-items:center;gap:.75rem">
                <span style="font-weight:600;font-size:.9rem">${a.id}</span>
                <span style="font-size:.8rem;color:var(--muted)">${a.method || 'POST'}</span>
                <span style="font-size:.8rem;color:var(--muted);flex:1">${a.description || ''}</span>
                ${isActive ? html`<button class="btn-sm" onClick=${() => {
                  if (testAction?.actionId === a.id) { setTestAction(null); setTestResult(null); }
                  else { setTestAction({ actionId: a.id }); setTestResult(null); setTestInput('{}'); }
                }}>${testAction?.actionId === a.id ? t('profile.v8ext.test.close') : t('profile.v8ext.test.btn')}</button>` : null}
              </div>
              ${testAction?.actionId === a.id ? html`
                <div style="margin-top:.75rem;padding:.75rem;background:var(--surface,#F9FAFB);border:1px solid var(--border,#E5E7EB);border-radius:8px">
                  <div style="font-size:.8rem;font-weight:600;margin-bottom:.5rem">${t('profile.v8ext.test.inputLabel')}</div>
                  <textarea style="width:100%;min-height:80px;font-family:monospace;font-size:13px;border:1px solid var(--border,#E5E7EB);border-radius:6px;padding:.5rem;resize:vertical"
                    value=${testInput} onInput=${e => setTestInput(e.target.value)}
                    placeholder='{ "key": "value" }'></textarea>
                  <div style="display:flex;gap:.5rem;margin-top:.5rem;align-items:center">
                    <button class="btn-primary btn-sm" disabled=${testRunning} onClick=${() => handleTestAction(ext.name, a.id)}>
                      ${testRunning ? html`<${Spinner} />` : t('profile.v8ext.test.run')}
                    </button>
                    ${testResult?.elapsed ? html`<span style="font-size:.75rem;color:var(--muted)">${testResult.elapsed}ms</span>` : null}
                  </div>
                  ${testResult ? html`
                    <div style="margin-top:.75rem">
                      <div style="font-size:.8rem;font-weight:600;margin-bottom:.25rem;color:${testResult.ok ? 'var(--success,#22c55e)' : 'var(--error,#ef4444)'}">
                        ${testResult.ok ? t('profile.v8ext.test.success') : t('profile.v8ext.test.error')}
                      </div>
                      <pre style="font-size:.8rem;font-family:monospace;background:var(--bg,#fff);border:1px solid var(--border,#E5E7EB);border-radius:6px;padding:.75rem;overflow-x:auto;max-height:300px;white-space:pre-wrap;word-break:break-word">${
                        testResult.ok ? JSON.stringify(testResult.data, null, 2) : testResult.error
                      }</pre>
                    </div>` : null}
                </div>` : null}
            </div>`)}
        </div>` : null}

      ${supportsInstances ? html`
        <div class="ext-detail-section" style="margin-top:1.5rem">
          <div class="ext-detail-section-title">${t('profile.v8ext.instancesTitle')}</div>
          ${!v8Instances ? html`<${Spinner} />` : v8Instances.length === 0
            ? html`<div style="font-size:.85rem;color:var(--muted);padding:.5rem 0">${t('profile.v8ext.noInstances')}</div>`
            : v8Instances.map(inst => html`
              <div style="display:flex;align-items:center;gap:.75rem;padding:.75rem;margin-bottom:.5rem;background:var(--surface,#F9FAFB);border:1px solid var(--border,#E5E7EB);border-radius:8px">
                <span style="font-weight:600;font-size:.9rem;flex:1">${inst.id}</span>
                <span class="ext-status-dot ${inst.status}"></span>
                <span style="font-size:.8rem;color:var(--muted)">${inst.status}</span>
                <button class="btn-sm" onClick=${() => { copyToClipboard(inst.id); showToast(t('profile.v8ext.instanceIdCopied')); }}>${t('profile.v8ext.copyId')}</button>
                <button class="btn-sm btn-danger" onClick=${() => handleDeleteInstance(ext.name, inst.id)}>${t('profile.v8ext.deleteInstance')}</button>
              </div>`)}
          ${isActive ? html`
            <div style="display:flex;gap:.5rem;margin-top:.75rem;align-items:center">
              <input class="input-field" style="flex:1;max-width:300px" placeholder=${t('profile.v8ext.instanceIdPlaceholder')} value=${newInstanceId} onInput=${e => setNewInstanceId(e.target.value)} />
              <button class="btn-primary btn-sm" onClick=${() => handleCreateInstance(ext.name)}>${t('profile.v8ext.createInstance')}</button>
            </div>` : html`<div style="font-size:.8rem;color:var(--muted);margin-top:.5rem">${t('profile.v8ext.activateFirst')}</div>`}
        </div>` : html`
        <div class="ext-detail-section" style="margin-top:1.5rem">
          <div class="ext-detail-section-title">${t('profile.v8ext.apiEndpoint')}</div>
          <div style="font-size:.85rem;padding:.75rem;background:var(--surface,#F9FAFB);border:1px solid var(--border,#E5E7EB);border-radius:8px;font-family:monospace;word-break:break-all">
            POST ${NODE_URL}/v1/ext/${ext.name}/{actionId}
          </div>
          <button class="btn-sm" style="margin-top:.5rem" onClick=${() => { copyToClipboard(NODE_URL + '/v1/ext/' + ext.name + '/'); showToast(t('profile.v8ext.copied')); }}>${t('profile.v8ext.copyEndpoint')}</button>
        </div>`}

      <div style="display:flex;gap:1rem;margin-top:1.5rem;flex-wrap:wrap">
        ${isActive
          ? html`<button class="btn-outline" onClick=${() => handleV8Deactivate(ext.name)}>${t('profile.v8ext.deactivate')}</button>`
          : html`<button class="btn-primary" onClick=${() => handleV8Activate(ext.name)}>${t('profile.v8ext.activate')}</button>`}
        <button class="btn-outline" style="border-color:rgba(239,68,68,0.3);color:#f87171" onClick=${() => handleV8Delete(ext.name)}>${t('profile.v8ext.delete')}</button>
      </div>
      <${ConfirmUI} />
    </div>`;
  }

  // ── Grid view ──
  const hasExtensions = extensions && extensions.length > 0;
  const installedNames = (extensions || []).map(e => e.name);
  const unbundled = BUNDLED.filter(b => !installedNames.includes(b.id));
  const hasV8 = v8Exts && v8Exts.length > 0;

  return html`<div>
    ${hasV8 ? html`
      <div style="margin-bottom:2rem">
        <div class="section-title">${t('profile.v8ext.title')}</div>
        <div class="section-desc">${t('profile.v8ext.desc')}</div>
        <div class="ext-grid" style="margin-top:1rem">
          ${v8Exts.map(ext => {
            const isActive = ext.status === 'active';
            return html`
              <div class="ext-card" onClick=${() => loadV8Detail(ext.name)}>
                <div class="ext-card-header">
                  <span class="ext-card-name">${ext.name}</span>
                  <span class="ext-card-version">v${ext.version || '?'}</span>
                </div>
                <div class="ext-card-desc">${ext.description || ''}</div>
                <div class="ext-card-tags">
                  ${(ext.actions || []).map(a => html`<span class="ext-comp-tag" style="color:#f59e0b">${a.id}</span>`)}
                </div>
                <div class="ext-card-footer">
                  <span class="ext-status"><span class="ext-status-dot ${ext.status}"></span> ${isActive ? t('profile.v8ext.statusActive') : t('profile.v8ext.statusInactive')}</span>
                  <span class="ext-card-actions">
                    ${isActive
                      ? html`<button onClick=${(e) => { e.stopPropagation(); handleV8Deactivate(ext.name); }}>${t('profile.v8ext.deactivate')}</button>`
                      : html`<button onClick=${(e) => { e.stopPropagation(); handleV8Activate(ext.name); }}>${t('profile.v8ext.activate')}</button>`}
                  </span>
                </div>
              </div>`;
          })}
        </div>
      </div>` : null}

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
                      <div style="margin-bottom:.75rem;padding:.75rem;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px">
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
    <${ConfirmUI} />
  </div>`;
}
