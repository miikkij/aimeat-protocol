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
 *   v1.0.0 — 2026-03-10 — Initial implementation with Cortex + Server extension management
 *   v1.1.0 — 2026-03-17 — Refactor: replace all inline style="" attributes with CSS classes
 */
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
const COMP_TAG_CLASSES = {schema:'ext-comp-tag-schema',prompt:'ext-comp-tag-prompt',action:'ext-comp-tag-action','board-template':'ext-comp-tag-board',ontology:'ext-comp-tag-ontology','seed-data':'ext-comp-tag-seed',lib:'ext-comp-tag-lib'};

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

Required fields (installation fails without these):
- apiVersion: must be "cortex.aimeat.org/v1"
- kind: must be "Extension"
- metadata.name, metadata.namespace: both mandatory strings
- spec.version: mandatory semver string
- spec.components: mandatory array, each component needs at least "type"
- Schema components require: name, key_pattern
- Lib components require: name, filename

────────────────────────────────────────────
COMPONENT EXAMPLES
────────────────────────────────────────────

Schema (locks memory keys to a JSON Schema):
    - type: schema
      name: my-item
      key_pattern: "myext.items.*"
      apply_to: prefix
      schema:
        type: object
        properties:
          id: { type: string, description: "Unique ID" }
          name: { type: string, description: "Item name" }
          value: { type: number, description: "Numeric value" }
        required: [id, name]

Schema properties must have full definitions with types and descriptions.

Lib (JavaScript library loaded by apps):
    - type: lib
      name: my-lib.js
      filename: my-lib.js
      exports: [getData, setData, search]
      api_surface: |
        AIMEAT.myExt.getData({ id }) — Get item by ID. Returns { id: string, name: string, value: number } or null
        AIMEAT.myExt.setData({ id, name, value }) — Save item. Returns saved item { id, name, value, createdAt }
        AIMEAT.myExt.search({ query }) — Search items. Returns Item[]

api_surface must describe every function with parameter names, types, and return shapes.

Prompt (AI instructions for using this cortex):
    - type: prompt
      name: my-assistant
      content: |
        Available API:
        AIMEAT.myExt.getData({ id }) — Returns { id, name, value }
        ...
      variables:
        - metadata.name
        - node_url

Seed data (initial entries written on activation):
    - type: seed-data
      entries:
        - key: myext.index
          value: []

Seed-data keys must not collide with schema key_patterns (e.g. use "myext.index" not "myext.items.index").

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

/* ── Server Extension scaffolding prompt builder ── */
function buildServerExtensionPrompt(sess) {
  const url = getNodeUrl();
  const owner = sess?.owner || 'user';
  return `You are a Server Extension builder for the AIMEAT protocol.

The user wants to create a server-side extension that runs in a secure sandbox.
Node URL: ${url}
Owner: ${owner}

A server extension is a YAML manifest + JavaScript action scripts. Each action runs
server-side in a sandboxed isolate with strict resource limits.

────────────────────────────────────────────
YAML MANIFEST STRUCTURE
────────────────────────────────────────────

metadata:
  name: my-extension
  version: 1.0.0
  description: "What this extension does"
  author: ${owner}
  license: MIT

required_apis:
  - memory                    # which sandbox APIs the extension needs

config:                       # operator-configurable settings (stored securely)
  api_key:
    type: string
    description: "External API key"
  base_url:
    type: string
    default: "https://api.example.com"

actions:                      # each action is a callable endpoint
  - id: my-action             # camelCase, becomes POST /v1/ext/{name}/{id}
    method: POST
    path: /my-action
    script: actions/my-action.js
    description: "What this action does"
    auth: authenticated
    input:
      param1:
        type: string
        required: true
        description: "Input parameter"
    output:                       # use JSON Schema format for all outputs
      type: object
      properties:
        items:
          type: array
          items:
            type: object
            properties:
              id: { type: integer, description: "Item ID" }
              name: { type: string, description: "Item name" }
              status: { type: string, enum: [active, inactive], description: "Current status" }
              image: { type: string, description: "Image URL" }
        info:
          type: object
          properties:
            count: { type: integer, description: "Total matching items" }
            pages: { type: integer, description: "Total pages" }
            next: { type: string, nullable: true, description: "Next page URL or null" }
        success: { type: boolean }

RULES:
- Each action requires: id, method, path, script. All four are mandatory.
- The script filename must match the JS file provided during install.
- Input and output schemas use JSON Schema format (same as OpenAPI 3.1).
  Every object needs \`properties\`, every array needs \`items\`. Use compact
  inline syntax: \`name: { type: string, description: "..." }\` for leaf fields.

schedules:                    # optional cron jobs
  - id: refresh-data
    cron: "*/10 * * * *"      # every 10 minutes
    action: refresh
    description: "Periodic data refresh"

limits:
  memory_mb: 64
  timeout_ms: 5000
  max_api_calls: 50

────────────────────────────────────────────
SANDBOX API (available inside action scripts)
────────────────────────────────────────────

Each action script exports a default async function:

  export default async function(ctx, input) {
    // ctx.memory — read/write AIMEAT memory
    const data = await ctx.memory.get('my-key');
    await ctx.memory.set('my-key', { value: 'hello' });
    await ctx.memory.delete('my-key');
    const results = await ctx.memory.search('prefix:*');
    const pub = await ctx.memory.getPublic('ext:my-ext', 'public-key');

    // ctx.fetch — call external APIs (HTTP/HTTPS)
    const resp = await ctx.fetch('https://api.example.com/data', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + ctx.config.api_key },
      body: JSON.stringify({ query: input.query }),
    });
    // resp = { status, ok, text, headers }
    const json = JSON.parse(resp.text);

    // ctx.config — operator-configured values (from manifest config section)
    const apiKey = ctx.config.api_key;

    // ctx.caller — who called this action
    // ctx.caller.gaii, ctx.caller.owner, ctx.caller.roles

    // ctx.wallet.consume(amount, reason) — deduct morsels (optional)
    // ctx.trust.getScore(gaii) — get trust score (optional)
    // ctx.consent.check(grantorGaii, dataPattern) — check consent (optional)

    // ctx.log(message) — log for debugging
    ctx.log('Processing: ' + input.query);

    // Return result (must be JSON-serializable object)
    return { result: json.data, processed_at: new Date().toISOString() };
  }

SANDBOX ENVIRONMENT:
Available: JSON, Math, Date, RegExp, Promise, async/await, String, Array,
  Object, Map, Set, encodeURIComponent, decodeURIComponent, parseInt, parseFloat

NOT available (will crash):
  URLSearchParams, URL, Buffer, TextEncoder, TextDecoder, Headers,
  Request, Response, FormData, Blob, AbortController, atob, btoa,
  require, import, process, fs, crypto, setTimeout, setInterval,
  console.log (use ctx.log), fetch (use ctx.fetch), window, document

URL construction (URLSearchParams is NOT available):
  WRONG: const params = new URLSearchParams(); params.set('name', query);
  RIGHT: const url = base + '?name=' + encodeURIComponent(query) + '&page=' + page;

RULES:
- Scripts use ES module syntax: export default async function(ctx, input) { ... }
- ctx.fetch returns { status, ok, text, headers } — NOT a Response object
- Parse JSON manually: JSON.parse(resp.text)
- Config values are set by the operator, never hardcode secrets
- Return value must be a plain object (no classes, no functions)

────────────────────────────────────────────
INSTALL
────────────────────────────────────────────

Extension API:
  POST   ${url}/v1/extensions    — install (body: { manifest: "<YAML>", scripts: { "actions/file.js": "<JS>" } })
  POST   ${url}/v1/extensions/{name}/activate
  POST   ${url}/v1/ext/{name}/{actionId}  — call an action

Or go to Profile > Extensions > Server Extensions section to install via UI.

────────────────────────────────────────────
YOUR TASK
────────────────────────────────────────────

Ask the user what they want to build. Then:
1. Design the YAML manifest with actions, config, and schedules as needed
2. Write the JavaScript action scripts
3. Explain what each action does and what external APIs it calls
4. Provide complete YAML + JS files ready to install`;
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

  // Server extension state
  const [showSrvInstall, setShowSrvInstall] = useState(false);
  const [srvManifestText, setSrvManifestText] = useState('');
  const [srvScriptEntries, setSrvScriptEntries] = useState([{filename:'', code:''}]);
  const [srvExts, setSrvExts] = useState(null);
  const [srvDetail, setSrvDetail] = useState(null);
  const [srvInstances, setSrvInstances] = useState(null);
  const [newInstanceId, setNewInstanceId] = useState('');
  const [testAction, setTestAction] = useState(null); // { actionId }
  const [testInput, setTestInput] = useState('{}');
  const [testResult, setTestResult] = useState(null);
  const [testRunning, setTestRunning] = useState(false);

  useEffect(() => {
    if (session) { loadExtensions(); loadServerExtensions(); }
  }, [session]);

  // Auto-refresh on SSE live updates (extension install/activate/etc)
  useEffect(() => {
    const handler = () => { loadExtensions(); loadServerExtensions(); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  async function loadExtensions() {
    try {
      const resp = await cortexService.listExtensions();
      setExtensions(resp?.extensions || []);
    } catch { setExtensions([]); }
  }

  function onSrvManifestChange(text) {
    setSrvManifestText(text);
    // Auto-extract script filenames from YAML actions
    try {
      const scriptMatches = [...text.matchAll(/script:\s*(.+)/g)];
      if (scriptMatches.length > 0) {
        const filenames = scriptMatches.map(m => m[1].trim());
        const existing = srvScriptEntries.filter(e => e.code.trim());
        const entries = filenames.map(fn => {
          const found = existing.find(e => e.filename === fn);
          return found || { filename: fn, code: '' };
        });
        if (entries.length > 0) setSrvScriptEntries(entries);
      }
    } catch { /* ignore parse errors */ }
  }

  async function handleSrvInstall() {
    if (!srvManifestText.trim()) { showToast('Manifest is required'); return; }
    try {
      const scripts = {};
      for (const e of srvScriptEntries) {
        if (e.filename && e.code) scripts[e.filename] = e.code;
      }
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
    try { setSrvExts(await v8Ext.listV8Extensions()); } catch { setSrvExts([]); }
  }

  async function loadSrvDetail(name) {
    setSrvDetail(null);
    setSrvInstances(null);
    setNewInstanceId('');
    try {
      const ext = await v8Ext.getV8Extension(name);
      setSrvDetail(ext);
      try { setSrvInstances(await v8Ext.listInstances(name)); } catch { setSrvInstances([]); }
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
      const resp = await v8Ext.createInstance(name, id, {});
      if (resp.ok === false) throw new Error(resp.error?.message || 'Failed');
      showToast(t('profile.v8ext.instanceCreated'));
      setNewInstanceId('');
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
            <div class="ext-detail-section-title">${'\u{1F4AC}'} Prompt: ${p.name} <button class="btn-primary btn-sm" onClick=${() => { copyToClipboard(content); showToast(t('profile.extensions.detail.copied')); }}>${t('profile.extensions.detail.copyPrompt')}</button></div>
            <div class="ext-detail-code">${content.substring(0, 500)}${content.length > 500 ? '...' : ''}</div>
          </div>`;
      })}

      ${comps.filter(c => c.type === 'lib').map(lib => {
        const scriptUrl = NODE_URL + '/v1/cortex/' + encodeURIComponent(ext.name) + '/libs/' + encodeURIComponent(lib.filename);
        const scriptTag = '<script src="' + scriptUrl + '"><\/script>';
        return html`
          <div class="ext-detail-section">
            <div class="ext-detail-section-title">${'\u{1F4E6}'} Library: ${lib.filename}</div>
            <div class="ext-lib-meta">${t('profile.extensions.detail.exports')}: ${(lib.exports || []).join(', ')}</div>
            <div class="ext-lib-label">${t('profile.extensions.detail.scriptTag')} <button class="btn-primary btn-sm" onClick=${() => { copyToClipboard(scriptTag); showToast(t('profile.extensions.detail.copied')); }}>${t('profile.extensions.detail.copyUrl')}</button></div>
            <div class="ext-detail-code">${scriptTag}</div>
            ${lib.api_surface ? html`<div>
              <div class="ext-lib-label-spaced">${t('profile.extensions.detail.apiSurface')} <button class="btn-primary btn-sm" onClick=${() => { copyToClipboard(lib.api_surface); showToast(t('profile.extensions.detail.copied')); }}>${t('profile.extensions.detail.copyApi')}</button></div>
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
          <span><span class="ext-status-dot ${ext.status}"></span> ${isActive ? t('profile.v8ext.statusActive') : t('profile.v8ext.statusInactive')}</span>
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
                <span class="ext-status-dot ${inst.status}"></span>
                <span class="ext-instance-status">${inst.status}</span>
                <button class="btn-outline btn-sm" onClick=${() => { copyToClipboard(inst.id); showToast(t('profile.v8ext.instanceIdCopied')); }}>${t('profile.v8ext.copyId')}</button>
                <button class="btn-danger-solid btn-sm" onClick=${() => handleDeleteInstance(ext.name, inst.id)}>${t('profile.v8ext.deleteInstance')}</button>
              </div>`)}
          ${isActive ? html`
            <div class="ext-instance-create">
              <input class="input-field ext-instance-input" placeholder=${t('profile.v8ext.instanceIdPlaceholder')} value=${newInstanceId} onInput=${e => setNewInstanceId(e.target.value)} />
              <button class="btn-primary btn-sm" onClick=${() => handleCreateInstance(ext.name)}>${t('profile.v8ext.createInstance')}</button>
            </div>` : html`<div class="ext-hint">${t('profile.v8ext.activateFirst')}</div>`}
        </div>` : html`
        <div class="ext-detail-section mt-section">
          <div class="ext-detail-section-title">${t('profile.v8ext.apiEndpoint')}</div>
          <div class="ext-endpoint-box">
            POST ${NODE_URL}/v1/ext/${ext.name}/{actionId}
          </div>
          <button class="btn-primary btn-sm ext-btn-copy-spaced" onClick=${() => { copyToClipboard(NODE_URL + '/v1/ext/' + ext.name + '/'); showToast(t('profile.v8ext.copied')); }}>${t('profile.v8ext.copyEndpoint')}</button>
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
        <button class="btn-primary" onClick=${() => { const p = buildServerExtensionPrompt(getSession() || {}); copyToClipboard(p); showToast(t('profile.extensions.promptCopied')); }}>${'\u{1F916}'} Create with AI</button>
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
                  <span class="ext-status"><span class="ext-status-dot ${ext.status}"></span> ${isActive ? t('profile.v8ext.statusActive') : t('profile.v8ext.statusInactive')}</span>
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
            return html`
              <div class="ext-card" onClick=${() => loadDetail(ext.name)}>
                <div class="ext-card-header">
                  <span class="ext-card-name">${ext.name}</span>
                  <span class="ext-card-version">v${ext.version || '?'}</span>
                  <span class="ext-visibility-badge public">${'\u{1F310}'}</span>
                </div>
                <div class="ext-card-desc">${ext.description || ''}</div>
                <div class="ext-card-tags">
                  ${types.map(ct => html`<span class="ext-comp-tag ${COMP_TAG_CLASSES[ct] || ''}">${t('profile.extensions.components.' + ct) || ct}</span>`)}
                </div>
                <div class="ext-card-footer">
                  <span class="ext-status"><span class="ext-status-dot ${ext.status}"></span> ${t('profile.extensions.status.' + ext.status)}</span>
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
                  ${types.map(ct => html`<span class="ext-comp-tag ${COMP_TAG_CLASSES[ct] || ''}">${t('profile.extensions.components.' + ct) || ct}</span>`)}
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
      <div class="modal-overlay" onClick=${(e) => { if (e.target === e.currentTarget) setShowInstall(false); }}>
        <div class="modal ext-modal-narrow">
          <h3>${t('profile.extensions.installModal.title')}</h3>
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
        </div>
      </div>` : null}

    ${showSrvInstall ? html`
      <div class="modal-overlay" onClick=${(e) => { if (e.target === e.currentTarget) setShowSrvInstall(false); }}>
        <div class="modal ext-modal-narrow">
          <h3>Install Server Extension</h3>
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
        </div>
      </div>` : null}

    <${ConfirmUI} />
  </div>`;
}
