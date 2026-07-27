/**
 * @file extensions-tab.js
 * @description Profile tab for managing Cortex (YAML manifest) and Server (sandboxed JS)
 *   extensions. Lists installed extensions, shows detail views with component
 *   breakdowns, action testing, instance management, and install/uninstall flows.
 * @structure
 *   - buildCortexPrompt()  — generates AI scaffolding prompt for extension creation
 *   - ExtensionsTab()      — main tab component (default export)
 *     - Cortex detail view — manifest components, prompts, libs, schemas, ontologies
 *     - Server extension detail view — actions, test runner, instances, endpoint info
 *     - Grid view          — cards for installed + bundled extensions
 *     - Install modal      — upload/paste manifest + libs
 * @usage Loaded as a lazy tab in profile.js via dynamic import.
 * @version-history
 *   v1.3.0 — 2026-06-24 — Secretary P5 (S-C): instance-create form renders per-instance config
 *     fields from configSchema; `type: secret` fields show a masked (password) input + 🔒 tag.
 *   v1.0.0 — 2026-03-10 — Initial implementation with Cortex + Server extension management
 *   v1.1.0 — 2026-03-17 — Refactor: replace all inline style="" attributes with CSS classes
 *   v1.2.0 — 2026-06-02 — Component unification (#2): both install modals use the
 *     canonical <Modal> component (className="ext-modal-narrow" preserves width).
 *   v1.3.0 — 2026-06-02 — Component unification (#1): the five tier-2 clipboard
 *     buttons (copy prompt / script tag / API surface / instance ID / endpoint) now
 *     use the canonical <CopyButton> with onCopied toasts. The two "Create with AI"
 *     hero CTAs keep their labeled buttons + copyToClipboard (not copy buttons).
 *   v1.4.0 — 2026-06-02 — Component unification (#11): all six extension/instance
 *     status dots use the canonical <StatusDot> instead of bespoke .ext-status-dot
 *     (which had hardcoded #4ade80/#9ca3af — now tokenized via the component).
 *   v1.4.1 — 2026-06-19 — JSDoc type annotations for frontend type-checking
 *   v1.5.0 — 2026-07-13 — Split for max-file-lines: MOVED the two AI prompt builders into
 *     ./extensions-tab.prompts.js and the COMP_ICONS/COMP_TAG_CLASSES/BUNDLED lookup tables into
 *     ./extensions-tab.constants.js (relative siblings). Behavior verbatim.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { copyToClipboard } from '/js/utils.js';
import { Spinner } from './shared.js';
import { Modal, useConfirm } from '/components/Modal.js';
import { CopyButton } from '/components/CopyButton.js';
import { StatusDot } from '/components/StatusDot.js';
import { useMaturityLedger, maturityBadge } from './extensions-tab.maturity.js';
import * as cortexService from '/js/services/cortex.js';
import * as v8Ext from '/js/services/extensions.js';
import { getNodeUrl, getSession } from '/js/services/auth.js';
import { buildCortexPrompt, fetchServerExtensionPrompt } from './extensions-tab.prompts.js';
import { COMP_ICONS, COMP_TAG_CLASSES, BUNDLED } from './extensions-tab.constants.js';
import { swallowed } from '/js/swallowed.js';

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

  // Server extension state
  const [showSrvInstall, setShowSrvInstall] = useState(false);
  const [srvManifestText, setSrvManifestText] = useState('');
  const [srvScriptEntries, setSrvScriptEntries] = useState([{filename:'', code:''}]);
  const [srvExts, setSrvExts] = useState(null);
  const [srvDetail, setSrvDetail] = useState(null);
  const [srvInstances, setSrvInstances] = useState(null);
  const [newInstanceId, setNewInstanceId] = useState('');
  const [newInstanceCfg, setNewInstanceCfg] = useState({}); // per-instance config-field values (incl. secrets)
  const [testAction, setTestAction] = useState(null); // { actionId }
  const [testInput, setTestInput] = useState('{}');
  const [testResult, setTestResult] = useState(null);
  const [testRunning, setTestRunning] = useState(false);

  const packLedger = useMaturityLedger();   // AI-acceleration tier + proofs, joined by lib name
  useEffect(() => {
    if (session) { loadExtensions(); loadServerExtensions(); }
  }, [session]);

  // Auto-refresh on SSE live updates (extension install/activate/etc)
  useEffect(() => onLiveUpdate(['extensions', 'admin-extensions'], () => { loadExtensions(); loadServerExtensions(); }), []);

  async function loadExtensions() {
    try {
      const resp = await cortexService.listExtensions();
      setExtensions(resp?.extensions || []);
    } catch (err) { swallowed('extensions-tab', err); setExtensions([]); }
  }

  function onSrvManifestChange(text) {
    setSrvManifestText(text);
    try {
      const scriptMatches = [...text.matchAll(/script:\s*(.+)/g)];
      if (scriptMatches.length > 0) {
        const filenames = scriptMatches.map(m => m[1].trim().replace(/^["']|["']$/g, ''));
        setSrvScriptEntries(prev => {
          const existing = prev.filter(e => e.code.trim());
          const entries = filenames.map(fn => {
            const found = existing.find(e => e.filename === fn);
            return found || { filename: fn, code: '' };
          });
          return entries.length > 0 ? entries : prev;
        });
      }
    } catch (err) { swallowed('extensions-tab: onSrvManifestChange', err); }
  }

  async function handleSrvInstall() {
    if (!srvManifestText.trim()) { showToast('Manifest is required'); return; }
    try {
      const scripts = {};
      for (const e of srvScriptEntries) {
        if (e.filename && e.code) scripts[e.filename] = e.code;
      }
      const scriptCount = Object.keys(scripts).length;
      if (scriptCount === 0) { showToast('At least one action script is required', true); return; }
      console.log('[SrvInstall] Sending', scriptCount, 'scripts:', Object.keys(scripts).map(k => k + ' (' + scripts[k].length + ' chars)'));
      const sess = getSession();
      const res = await sess.fetch('/v1/extensions', {
        method: 'POST',
        body: JSON.stringify({ manifest: srvManifestText, scripts }),
      });
      if (!res.ok) throw new Error(res.error?.message || 'Install failed');
      showToast('Extension installed!');
      setShowSrvInstall(false);
      setSrvManifestText('');
      setSrvScriptEntries([{filename:'', code:''}]);
      loadServerExtensions();
    } catch (err) {
      showToast('Install failed: ' + (err.message || err), true);
    }
  }

  async function loadServerExtensions() {
    try { setSrvExts(await v8Ext.listV8Extensions()); } catch (err) { swallowed('extensions-tab', err); setSrvExts([]); }
  }

  async function loadSrvDetail(name) {
    setSrvDetail(null);
    setSrvInstances(null);
    setNewInstanceId('');
    try {
      const ext = await v8Ext.getV8Extension(name);
      setSrvDetail(ext);
      try { setSrvInstances(await v8Ext.listInstances(name)); } catch (err) { swallowed('extensions-tab', err); setSrvInstances([]); }
    } catch(e) { setSrvDetail({ error: e.message }); }
  }

  async function handleSrvActivate(name) {
    try {
      const resp = await v8Ext.activateV8Extension(name);
      if (resp.ok === false) throw new Error(resp.error?.message || 'Failed');
      showToast(t('profile.v8ext.activated'));
      loadServerExtensions();
      if (srvDetail?.name === name) loadSrvDetail(name);
    } catch(e) { showToast(e.message, true); }
  }

  async function handleSrvDeactivate(name) {
    try {
      const resp = await v8Ext.deactivateV8Extension(name);
      if (resp.ok === false) throw new Error(resp.error?.message || 'Failed');
      showToast(t('profile.v8ext.deactivated'));
      loadServerExtensions();
      if (srvDetail?.name === name) loadSrvDetail(name);
    } catch(e) { showToast(e.message, true); }
  }

  async function handleSrvDelete(name) {
    confirm(t('profile.v8ext.confirmDelete'), async () => {
      try {
        const resp = await v8Ext.deleteV8Extension(name);
        if (resp.ok === false) throw new Error(resp.error?.message || 'Failed');
        showToast(t('profile.v8ext.deleted'));
        setSrvDetail(null);
        loadServerExtensions();
      } catch(e) { showToast(e.message, true); }
    }, { danger: true });
  }

  async function handleCreateInstance(name) {
    const id = newInstanceId.trim();
    if (!id) { showToast(t('profile.v8ext.instanceIdRequired'), true); return; }
    try {
      // Drop empty config values so unset optional fields aren't stored as "".
      const cfg = {};
      for (const [k, v] of Object.entries(newInstanceCfg)) { if (v !== '' && v != null) cfg[k] = v; }
      const resp = await v8Ext.createInstance(name, id, cfg);
      if (resp.ok === false) throw new Error(resp.error?.message || 'Failed');
      showToast(t('profile.v8ext.instanceCreated'));
      setNewInstanceId('');
      setNewInstanceCfg({});
      setSrvInstances(await v8Ext.listInstances(name));
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
        setSrvInstances(await v8Ext.listInstances(name));
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
        const fileInput = /** @type {HTMLInputElement} */ (document.getElementById('ext-manifest-file'));
        if (!fileInput?.files[0]) throw new Error('No manifest file selected');
        manifest = await fileInput.files[0].text();
      } else {
        const textarea = /** @type {HTMLInputElement} */ (document.getElementById('ext-manifest-text'));
        manifest = textarea?.value || '';
        if (!manifest.trim()) throw new Error('Manifest is empty');
      }

      const libs = {};
      if (libMode === 'upload') {
        const libInput = /** @type {HTMLInputElement} */ (document.getElementById('ext-lib-files'));
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
    const isOwn = ext.installed_by === (session?.owner || '');

    return html`<div>
      <button class="btn-outline" onClick=${() => setExtDetailName(null)}>${t('profile.extensions.detail.back')}</button>
      <div class="ext-detail-wrap">
        <div class="ext-title">
          ${ext.name}
          <span class="ext-title-version">v${ext.version || '?'}</span>
          <span class="ext-visibility-badge ${vis}">${vis === 'public' ? '\u{1F310}' : '\u{1F512}'} ${t('profile.extensions.visibility.' + vis)}</span>
        </div>
        <div class="ext-description">${ext.description || ''}</div>
        <div class="ext-meta-row">
          <span>${t('profile.extensions.detail.author')}: ${ext.author || '?'}</span>
          ${ext.license ? html`<span>${t('profile.extensions.detail.license')}: ${ext.license}</span>` : null}
          <span><${StatusDot} status=${ext.status} /> ${t('profile.extensions.status.' + ext.status)}</span>
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
            <div class="ext-detail-section-title">${'\u{1F4AC}'} Prompt: ${p.name} <${CopyButton} text=${content} label=${t('profile.extensions.detail.copyPrompt')} className="btn-primary btn-sm" onCopied=${() => showToast(t('profile.extensions.detail.copied'))} /></div>
            <div class="ext-detail-code">${content.substring(0, 500)}${content.length > 500 ? '...' : ''}</div>
          </div>`;
      })}

      ${comps.filter(c => c.type === 'lib').map(lib => {
        const scriptUrl = NODE_URL + '/v1/cortex/' + encodeURIComponent(ext.name) + '/libs/' + encodeURIComponent(lib.filename);
        const scriptTag = '<script src="' + scriptUrl + '"></script>';
        return html`
          <div class="ext-detail-section">
            <div class="ext-detail-section-title">${'\u{1F4E6}'} Library: ${lib.filename}</div>
            <div class="ext-lib-meta">${t('profile.extensions.detail.exports')}: ${(lib.exports || []).join(', ')}</div>
            <div class="ext-lib-label">${t('profile.extensions.detail.scriptTag')} <${CopyButton} text=${scriptTag} label=${t('profile.extensions.detail.copyUrl')} className="btn-primary btn-sm" onCopied=${() => showToast(t('profile.extensions.detail.copied'))} /></div>
            <div class="ext-detail-code">${scriptTag}</div>
            ${lib.api_surface ? html`<div>
              <div class="ext-lib-label-spaced">${t('profile.extensions.detail.apiSurface')} <${CopyButton} text=${lib.api_surface} label=${t('profile.extensions.detail.copyApi')} className="btn-primary btn-sm" onCopied=${() => showToast(t('profile.extensions.detail.copied'))} /></div>
              <div class="ext-detail-code">${lib.api_surface}</div>
            </div>` : null}
          </div>`;
      })}

      ${comps.filter(c => c.type === 'schema').length > 0 ? html`
        <div class="ext-detail-section">
          <div class="ext-detail-section-title">${'\u{1F4D0}'} Schemas</div>
          ${comps.filter(c => c.type === 'schema').map(s => html`<div class="ext-schema-item">${s.key_pattern} (${s.apply_to || ''})</div>`)}
        </div>` : null}

      ${(ext._ontologies || []).map(ont => html`
        <div class="ext-detail-section">
          <div class="ext-detail-section-title">${'\u{1F9EC}'} Ontology: ${ont.name}</div>
          <div class="ext-ontology-text">${Object.entries(ont.concepts || {}).map(([k, c]) => k + ' (' + (c.label?.en || k) + ')').join(', ')}</div>
        </div>`)}

      ${isOwn ? html`<div class="ext-actions-bar">
        ${isActive
          ? html`<button class="btn-outline" onClick=${() => deactivateExt(ext.name)}>${t('profile.extensions.deactivate')}</button>`
          : html`<button class="btn-primary" onClick=${() => activateExt(ext.name)}>${t('profile.extensions.activate')}</button>`}
        <button class="btn-outline" onClick=${() => handleToggleVisibility(ext.name, vis)}>
          ${vis === 'public' ? t('profile.extensions.unpublish') : t('profile.extensions.publish')}
        </button>
        <button class="btn-danger-solid" onClick=${() => uninstallExt(ext.name)}>${t('profile.extensions.uninstall')}</button>
      </div>` : html`<div class="ext-meta-row"><span>${t('profile.extensions.managedByAdmin')}</span></div>`}
      <${ConfirmUI} />
    </div>`;
  }

  // ── Server extension detail view ──
  if (srvDetail) {
    if (srvDetail.error) return html`<div><button class="btn-outline" onClick=${() => setSrvDetail(null)}>${t('profile.v8ext.back')}</button><div class="empty">Error: ${srvDetail.error}</div></div>`;
    const ext = srvDetail;
    const isActive = ext.status === 'active';
    const actions = ext.actions || [];
    const supportsInstances = ext.instances?.supported;

    return html`<div>
      <button class="btn-outline" onClick=${() => setSrvDetail(null)}>${t('profile.v8ext.back')}</button>
      <div class="ext-detail-wrap">
        <div class="ext-title">
          ${ext.name}
          <span class="ext-title-version">v${ext.version || '?'}</span>
        </div>
        <div class="ext-description">${ext.description || ''}</div>
        <div class="ext-meta-row-sm">
          <span>${t('profile.v8ext.author')}: ${ext.author || '?'}</span>
          <span><${StatusDot} status=${ext.status} /> ${isActive ? t('profile.v8ext.statusActive') : t('profile.v8ext.statusInactive')}</span>
          <span>${t('profile.v8ext.actions')}: ${actions.length}</span>
        </div>
      </div>

      ${actions.length > 0 ? html`
        <div class="ext-detail-section">
          <div class="ext-detail-section-title">${t('profile.v8ext.actionsTitle')}</div>
          ${actions.map(a => html`
            <div class="ext-action-row">
              <div class="ext-action-header">
                <span class="ext-action-name">${a.id}</span>
                <span class="ext-action-meta">${a.method || 'POST'}</span>
                <span class="ext-action-desc">${a.description || ''}</span>
                ${isActive ? html`<button class="btn-outline btn-sm" onClick=${() => {
                  if (testAction?.actionId === a.id) { setTestAction(null); setTestResult(null); }
                  else {
                    setTestAction({ actionId: a.id }); setTestResult(null);
                    // Pre-fill test input from inputSchema
                    const schema = a.inputSchema || a.input;
                    if (schema && typeof schema === 'object') {
                      const props = schema.properties || schema;
                      const example = {};
                      for (const [k, v] of Object.entries(props)) {
                        if (v && typeof v === 'object' && !Array.isArray(v)) {
                          const spec = v;
                          if (spec.type === 'string') example[k] = spec.description ? '<' + spec.description + '>' : '';
                          else if (spec.type === 'number') example[k] = 0;
                          else if (spec.type === 'boolean') example[k] = false;
                          else example[k] = null;
                        }
                      }
                      setTestInput(JSON.stringify(example, null, 2));
                    } else { setTestInput('{}'); }
                  }
                }}>${testAction?.actionId === a.id ? t('profile.v8ext.test.close') : t('profile.v8ext.test.btn')}</button>` : null}
              </div>
              ${(a.inputSchema || a.input) && Object.keys(a.inputSchema || a.input || {}).length > 0 ? html`
                <div style="font-size:.75rem;opacity:.7;padding:2px 0 4px 12px">
                  ${(() => {
                    const schema = a.inputSchema || a.input || {};
                    const props = schema.properties || schema;
                    const required = schema.required || [];
                    return Object.entries(props).filter(([k]) => k !== 'type' && k !== 'required' && k !== 'properties').map(([k, v]) => {
                      const spec = (v && typeof v === 'object') ? v : {};
                      const req = required.includes(k);
                      return html`<span style="display:inline-block;margin-right:8px"><code>${k}</code>${req ? html`<span style="color:#E8564A">*</span>` : ''}: ${spec.type || '?'}${spec.description ? html` <span style="opacity:.6">— ${spec.description}</span>` : ''}</span>`;
                    });
                  })()}
                  ${(a.outputSchema || a.output) && Object.keys(a.outputSchema || a.output || {}).length > 0 ? html`
                    <div style="margin-top:2px;opacity:.6">→ ${(() => {
                      const out = a.outputSchema || a.output || {};
                      const props = out.properties || out;
                      function renderProps(obj, depth) {
                        if (!obj || depth > 2) return '';
                        return Object.entries(obj).filter(([k]) => k !== 'type' && k !== 'properties' && k !== 'items' && k !== 'required' && k !== 'description' && k !== 'nullable' && k !== 'enum').map(([k, v]) => {
                          const spec = (v && typeof v === 'object') ? v : {};
                          let typeStr = spec.type || '?';
                          let nested = '';
                          if (spec.type === 'object' && spec.properties) {
                            nested = ' { ' + renderProps(spec.properties, depth + 1) + ' }';
                          } else if (spec.type === 'array' && spec.items?.properties) {
                            nested = ' [{ ' + renderProps(spec.items.properties, depth + 1) + ' }]';
                          }
                          return k + ': ' + typeStr + nested;
                        }).join(', ');
                      }
                      return renderProps(props, 0);
                    })()}</div>` : null}
                </div>` : null}
              ${testAction?.actionId === a.id ? html`
                <div class="ext-test-panel">
                  <div class="ext-test-label">${t('profile.v8ext.test.inputLabel')}</div>
                  <textarea class="ext-test-textarea"
                    value=${testInput} onInput=${e => setTestInput(e.target.value)}
                    placeholder='{ "key": "value" }'></textarea>
                  <div class="ext-test-actions">
                    <button class="btn-primary btn-sm" disabled=${testRunning} onClick=${() => handleTestAction(ext.name, a.id)}>
                      ${testRunning ? html`<${Spinner} />` : t('profile.v8ext.test.run')}
                    </button>
                    ${testResult?.elapsed ? html`<span class="ext-test-elapsed">${testResult.elapsed}ms</span>` : null}
                  </div>
                  ${testResult ? html`
                    <div class="ext-test-result">
                      <div class="ext-test-result-label ${testResult.ok ? 'success' : 'error'}">
                        ${testResult.ok ? t('profile.v8ext.test.success') : t('profile.v8ext.test.error')}
                      </div>
                      <pre class="ext-test-output">${
                        testResult.ok ? JSON.stringify(testResult.data, null, 2) : testResult.error
                      }</pre>
                    </div>` : null}
                </div>` : null}
            </div>`)}
        </div>` : null}

      ${supportsInstances ? html`
        <div class="ext-detail-section mt-section">
          <div class="ext-detail-section-title">${t('profile.v8ext.instancesTitle')}</div>
          ${!srvInstances ? html`<${Spinner} />` : srvInstances.length === 0
            ? html`<div class="ext-no-instances">${t('profile.v8ext.noInstances')}</div>`
            : srvInstances.map(inst => html`
              <div class="ext-instance-row">
                <span class="ext-instance-name">${inst.id}</span>
                <${StatusDot} status=${inst.status} />
                <span class="ext-instance-status">${inst.status}</span>
                <${CopyButton} text=${inst.id} label=${t('profile.v8ext.copyId')} className="btn-outline btn-sm" onCopied=${() => showToast(t('profile.v8ext.instanceIdCopied'))} />
                <button class="btn-danger-solid btn-sm" onClick=${() => handleDeleteInstance(ext.name, inst.id)}>${t('profile.v8ext.deleteInstance')}</button>
              </div>`)}
          ${isActive ? html`
            <div class="ext-instance-create">
              <input class="input-field ext-instance-input" placeholder=${t('profile.v8ext.instanceIdPlaceholder')} value=${newInstanceId} onInput=${e => setNewInstanceId(e.target.value)} />
              ${(() => {
                const props = ext.instances?.configSchema?.properties || {};
                const keys = Object.keys(props);
                if (!keys.length) return null;
                return keys.map(k => {
                  const p = props[k] || {};
                  const isSecret = p.type === 'secret';
                  return html`<div class="ext-instance-cfg-field" key=${k}>
                    <label class="ext-instance-cfg-label">
                      ${p.label || k}
                      ${isSecret ? html`<span class="ext-instance-cfg-secret">🔒 ${t('profile.v8ext.secretField')}</span>` : null}
                      ${p.description ? html`<span class="ext-instance-cfg-desc">${p.description}</span>` : null}
                    </label>
                    <input class="input-field ext-instance-input"
                      type=${isSecret ? 'password' : 'text'}
                      autocomplete=${isSecret ? 'new-password' : 'off'}
                      placeholder=${isSecret ? '••••••••' : (p.label || k)}
                      value=${newInstanceCfg[k] || ''}
                      onInput=${e => setNewInstanceCfg({ ...newInstanceCfg, [k]: e.target.value })} />
                  </div>`;
                });
              })()}
              <button class="btn-primary btn-sm" onClick=${() => handleCreateInstance(ext.name)}>${t('profile.v8ext.createInstance')}</button>
            </div>` : html`<div class="ext-hint">${t('profile.v8ext.activateFirst')}</div>`}
        </div>` : html`
        <div class="ext-detail-section mt-section">
          <div class="ext-detail-section-title">${t('profile.v8ext.apiEndpoint')}</div>
          <div class="ext-endpoint-box">
            POST ${NODE_URL}/v1/ext/${ext.name}/{actionId}
          </div>
          <${CopyButton} text=${NODE_URL + '/v1/ext/' + ext.name + '/'} label=${t('profile.v8ext.copyEndpoint')} className="btn-primary btn-sm ext-btn-copy-spaced" onCopied=${() => showToast(t('profile.v8ext.copied'))} />
        </div>`}

      <div class="ext-actions-bar">
        ${isActive
          ? html`<button class="btn-outline" onClick=${() => handleSrvDeactivate(ext.name)}>${t('profile.v8ext.deactivate')}</button>`
          : html`<button class="btn-primary" onClick=${() => handleSrvActivate(ext.name)}>${t('profile.v8ext.activate')}</button>`}
        <button class="btn-danger-solid" onClick=${() => handleSrvDelete(ext.name)}>${t('profile.v8ext.delete')}</button>
      </div>
      <${ConfirmUI} />
    </div>`;
  }

  // ── Grid view ──
  const currentOwner = session?.owner || '';
  const allExts = extensions || [];
  const nodeExts = allExts.filter(e => e.installed_by !== currentOwner);
  const myExts = allExts.filter(e => e.installed_by === currentOwner);
  const hasNodeExts = nodeExts.length > 0;
  const hasMyExts = myExts.length > 0;
  const hasExtensions = allExts.length > 0;
  const installedNames = allExts.map(e => e.name);
  const unbundled = BUNDLED.filter(b => !installedNames.includes(b.id));
  const hasSrv = srvExts && srvExts.length > 0;

  return html`<div>
    <div class="ext-v8-section">
      <div class="section-title">${t('profile.v8ext.title')}</div>
      <div class="section-desc">${t('profile.v8ext.desc')}</div>
      <div class="ext-hero-actions">
        <button class="btn-primary" onClick=${async () => { const p = await fetchServerExtensionPrompt(getSession() || {}); copyToClipboard(p); showToast(t('profile.extensions.promptCopied')); }}>${'\u{1F916}'} Create with AI</button>
        <button class="btn-outline" onClick=${() => setShowSrvInstall(true)}>+ Add</button>
      </div>
      ${hasSrv ? html`
        <div class="ext-grid ext-grid-spaced">
          ${srvExts.map(ext => {
            const isActive = ext.status === 'active';
            return html`
              <div class="ext-card" onClick=${() => loadSrvDetail(ext.name)}>
                <div class="ext-card-header">
                  <span class="ext-card-name">${ext.name}</span>
                  <span class="ext-card-version">v${ext.version || '?'}</span>
                </div>
                <div class="ext-card-desc">${ext.description || ''}</div>
                <div class="ext-card-tags">
                  ${(ext.actions || []).map(a => html`<span class="ext-comp-tag ext-comp-tag-action">${a.id}</span>`)}
                </div>
                <div class="ext-card-footer">
                  <span class="ext-status"><${StatusDot} status=${ext.status} /> ${isActive ? t('profile.v8ext.statusActive') : t('profile.v8ext.statusInactive')}</span>
                  <span class="ext-card-actions">
                    ${isActive
                      ? html`<button onClick=${(e) => { e.stopPropagation(); handleSrvDeactivate(ext.name); }}>${t('profile.v8ext.deactivate')}</button>`
                      : html`<button onClick=${(e) => { e.stopPropagation(); handleSrvActivate(ext.name); }}>${t('profile.v8ext.activate')}</button>`}
                  </span>
                </div>
              </div>`;
          })}
        </div>` : null}
    </div>

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

    ${!extensions ? html`<${Spinner} text=${t('profile.extensions.loading')} />` : null}

    ${hasNodeExts ? html`<div>
        <div class="ext-installed-heading">${t('profile.extensions.nodeExtensions')} (${nodeExts.length})</div>
        <div class="ext-grid">
          ${nodeExts.map(ext => {
            const types = ext.component_types || [];
            const isLib = types.includes('lib') && !types.some(ct => ['schema','action','board-template','ontology','seed-data'].includes(ct));
            return html`
              <div class="ext-card" onClick=${() => loadDetail(ext.name)}>
                <div class="ext-card-header">
                  <span class="ext-card-name">${ext.name}</span>
                  <span class="ext-card-version">v${ext.version || '?'}</span>
                  <span class="badge ${isLib ? 'badge-info' : 'badge-dim'}">${isLib ? t('profile.extensions.libraryBadge') : t('profile.extensions.serviceBadge')}</span>${maturityBadge(html, t, packLedger, ext.name)}
                  <span class="ext-visibility-badge public">${'\u{1F310}'}</span>
                </div>
                <div class="ext-card-desc">${ext.description || ''}</div>
                <div class="ext-card-tags">
                  ${types.map(ct => html`<span class="ext-comp-tag ${COMP_TAG_CLASSES[ct] || ''}">${t('profile.extensions.components.' + ct) || ct}</span>`)}
                </div>
                <div class="ext-card-footer">
                  <span class="ext-status"><${StatusDot} status=${ext.status} /> ${t('profile.extensions.status.' + ext.status)}</span>
                </div>
              </div>`;
          })}
        </div>
      </div>` : null}

    ${hasMyExts ? html`<div>
        <div class="ext-installed-heading">${t('profile.extensions.myExtensions')} (${myExts.length})</div>
        <div class="ext-grid">
          ${myExts.map(ext => {
            const types = ext.component_types || [];
            const isLib = types.includes('lib') && !types.some(ct => ['schema','action','board-template','ontology','seed-data'].includes(ct));
            const isActive = ext.status === 'active';
            const vis = ext.visibility || 'private';
            return html`
              <div class="ext-card" onClick=${() => loadDetail(ext.name)}>
                <div class="ext-card-header">
                  <span class="ext-card-name">${ext.name}</span>
                  <span class="ext-card-version">v${ext.version || '?'}</span>
                  <span class="badge ${isLib ? 'badge-info' : 'badge-dim'}">${isLib ? t('profile.extensions.libraryBadge') : t('profile.extensions.serviceBadge')}</span>${maturityBadge(html, t, packLedger, ext.name)}
                  <span class="ext-visibility-badge ${vis}">${vis === 'public' ? '\u{1F310}' : '\u{1F512}'}</span>
                </div>
                <div class="ext-card-desc">${ext.description || ''}</div>
                <div class="ext-card-tags">
                  ${types.map(ct => html`<span class="ext-comp-tag ${COMP_TAG_CLASSES[ct] || ''}">${t('profile.extensions.components.' + ct) || ct}</span>`)}
                </div>
                <div class="ext-card-footer">
                  <span class="ext-status"><${StatusDot} status=${ext.status} /> ${t('profile.extensions.status.' + ext.status)}</span>
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
      <div class="${hasExtensions ? 'ext-v8-section' : ''}">
        <div class="ext-section-heading">${t('profile.extensions.readyExtensions')}</div>
        <div class="ext-bundled-grid">
          ${unbundled.map(b => html`
            <div class="ext-bundled-card">
              <div class="ext-bundled-icon">${b.icon}</div>
              <div class="ext-bundled-name">${t(b.nameKey)}</div>
              <div class="ext-bundled-desc">${t(b.descKey)}</div>
              <button class="btn-primary ext-bundled-btn"
                disabled=${bundledInstalling === b.id}
                onClick=${() => handleInstallBundled(b.id)}>
                ${bundledInstalling === b.id ? html`<${Spinner} />` : t('profile.extensions.addThis')}
              </button>
            </div>`)}
        </div>
      </div>` : null}

    ${showInstall ? html`
      <${Modal} open=${true} onClose=${() => setShowInstall(false)} title=${t('profile.extensions.installModal.title')} className="ext-modal-narrow">
          <form onSubmit=${handleInstall}>
            <div class="ext-modal-section">
              <label>${t('profile.extensions.installModal.manifestLabel')}</label>
              <div class="ext-radio-row">
                <label><input type="radio" name="ext-mmode" checked=${manifestMode==='upload'} onChange=${() => setManifestMode('upload')} /> ${t('profile.extensions.installModal.uploadFile')}</label>
                <label><input type="radio" name="ext-mmode" checked=${manifestMode==='paste'} onChange=${() => setManifestMode('paste')} /> ${t('profile.extensions.installModal.pasteYaml')}</label>
              </div>
              ${manifestMode === 'upload'
                ? html`<input type="file" id="ext-manifest-file" accept=".yaml,.yml" />`
                : html`<textarea id="ext-manifest-text" rows="10" class="ext-modal-textarea" placeholder="apiVersion: cortex.aimeat.org/v1\nkind: Extension\n..."></textarea>`}
            </div>

            <div class="ext-modal-section">
              <label>${t('profile.extensions.installModal.libsLabel')}</label>
              <div class="ext-radio-row">
                <label><input type="radio" name="ext-lmode" checked=${libMode==='upload'} onChange=${() => setLibMode('upload')} /> ${t('profile.extensions.installModal.uploadFiles')}</label>
                <label><input type="radio" name="ext-lmode" checked=${libMode==='paste'} onChange=${() => setLibMode('paste')} /> ${t('profile.extensions.installModal.pasteCode')}</label>
              </div>
              ${libMode === 'upload'
                ? html`<input type="file" id="ext-lib-files" accept=".js" multiple />`
                : html`<div>
                    ${libEntries.map((entry, i) => html`
                      <div class="ext-lib-entry">
                        <input type="text" placeholder=${t('profile.extensions.installModal.filenamePlaceholder')} value=${entry.filename} onInput=${(e) => { const arr = [...libEntries]; arr[i] = {...arr[i], filename: e.target.value}; setLibEntries(arr); }} class="ext-lib-entry-input" />
                        <textarea rows="6" placeholder="(function(AIMEAT) { ... })(...)" value=${entry.code} onInput=${(e) => { const arr = [...libEntries]; arr[i] = {...arr[i], code: e.target.value}; setLibEntries(arr); }} class="ext-lib-entry-code"></textarea>
                      </div>`)}
                    <button type="button" class="btn-outline ext-add-lib-btn" onClick=${() => setLibEntries([...libEntries, {filename:'', code:''}])}>${t('profile.extensions.installModal.addLib')}</button>
                  </div>`}
            </div>

            <div class="ext-modal-footer">
              <button type="button" class="btn-outline" onClick=${() => setShowInstall(false)}>${t('profile.extensions.installModal.cancel')}</button>
              <button type="submit" class="btn-primary">${t('profile.extensions.installModal.installBtn')}</button>
            </div>
          </form>
      <//>` : null}

    ${showSrvInstall ? html`
      <${Modal} open=${true} onClose=${() => setShowSrvInstall(false)} title="Install Server Extension" className="ext-modal-narrow">
          <div class="ext-modal-section">
            <label>YAML Manifest</label>
            <textarea rows="12" class="ext-modal-textarea" placeholder="metadata:\n  name: my-extension\n  version: 1.0.0\n  description: ...\n\nactions:\n  - id: my-action\n    ..." value=${srvManifestText} onInput=${(e) => onSrvManifestChange(e.target.value)}></textarea>
          </div>
          <div class="ext-modal-section">
            <label>Action Scripts (JS files)</label>
            ${srvScriptEntries.map((entry, i) => html`
              <div class="ext-lib-entry">
                <input type="text" placeholder="actions/my-action.js" value=${entry.filename} onInput=${(e) => { const arr = [...srvScriptEntries]; arr[i] = {...arr[i], filename: e.target.value}; setSrvScriptEntries(arr); }} class="ext-lib-entry-input" />
                <textarea rows="8" placeholder="export default async function(ctx, input) {\n  // ...\n  return { result: 'ok' };\n}" value=${entry.code} onInput=${(e) => { const arr = [...srvScriptEntries]; arr[i] = {...arr[i], code: e.target.value}; setSrvScriptEntries(arr); }} class="ext-lib-entry-code"></textarea>
              </div>`)}
            <button type="button" class="btn-outline ext-add-lib-btn" onClick=${() => setSrvScriptEntries([...srvScriptEntries, {filename:'', code:''}])}>+ Add Script</button>
          </div>
          <div class="ext-modal-footer">
            <button class="btn-outline" onClick=${() => setShowSrvInstall(false)}>Cancel</button>
            <button class="btn-primary" onClick=${handleSrvInstall}>Install</button>
          </div>
      <//>` : null}

    <${ConfirmUI} />
  </div>`;
}
