/**
 * Admin Dashboard — Services Tab
 * Manage installed service extensions and their instances.
 * Install bundled extensions with one-click.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, Badge, StatsGrid, Empty, ExpandableHelp, useToast, Toast } from './shared.js';
import {
  getExtensionInstances, createExtensionInstance, updateExtensionInstance,
  deleteExtensionInstance, getAvailableExtensions, installBundledExtension,
  uninstallExtension, getActionScript, updateActionScript, scaffoldExtension,
  getDiskScript, saveDiskScript, addDiskAction, reinstallExtension,
} from '/js/services/admin.js';
import { useConfirm } from '/components/Modal.js';
import { CopyButton } from '/components/CopyButton.js';

const inputStyle = 'adm-input';
const labelStyle = 'adm-text-sm adm-text-dim';
const fieldWrap = 'display:flex;flex-direction:column;gap:2px';

// Extension name → user-facing SPA URL
const EXT_SPA_URLS = {
  'marketplace-behaviors': '/v1/marketplace',
};

// ── Build default config values from JSON Schema properties ──
function buildDefaults(schema) {
  if (!schema?.properties) return {};
  const cfg = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (prop.default !== undefined) cfg[key] = prop.default;
  }
  return cfg;
}

// ── Schema-driven config form ──
function ConfigForm({ schema, config, onChange }) {
  if (!schema?.properties) return null;
  const props = schema.properties;
  const keys = Object.keys(props);
  if (keys.length === 0) return null;

  function set(key, value) {
    onChange({ ...config, [key]: value });
  }

  return html`
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start">
      ${keys.map(key => {
        const prop = props[key];
        const val = config[key] ?? prop.default ?? '';

        // Enum → select dropdown
        if (prop.enum) {
          return html`
            <div style=${fieldWrap}>
              <label class="${labelStyle}">${key}</label>
              <select class="${inputStyle}" value=${val}
                onChange=${e => set(key, e.target.value)}>
                ${prop.enum.map(opt => html`<option value=${opt}>${opt}</option>`)}
              </select>
            </div>
          `;
        }

        // Array of strings → comma-separated input
        if (prop.type === 'array') {
          const arrVal = Array.isArray(val) ? val.join(', ') : (val || '');
          return html`
            <div style=${fieldWrap + ';flex:1;min-width:160px'}>
              <label class="${labelStyle}">${key} <span style="opacity:.6">(${t('dashboard.servicesCommaSep')})</span></label>
              <input type="text" class="${inputStyle}" value=${arrVal}
                placeholder=${(prop.default || []).join(', ') || 'a, b, c'}
                onInput=${e => {
                  const items = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                  set(key, items);
                }} />
            </div>
          `;
        }

        // Number / integer
        if (prop.type === 'number' || prop.type === 'integer') {
          return html`
            <div style=${fieldWrap}>
              <label class="${labelStyle}">${key}</label>
              <input type="number" class="${inputStyle}" style="width:100px" value=${val}
                step=${prop.type === 'integer' ? 1 : 'any'}
                onInput=${e => set(key, e.target.value === '' ? '' : Number(e.target.value))} />
            </div>
          `;
        }

        // String (default)
        return html`
          <div style=${fieldWrap + ';min-width:140px'}>
            <label class="${labelStyle}">${key}</label>
            <input type="text" class="${inputStyle}" value=${val}
              placeholder=${prop.default || ''}
              onInput=${e => set(key, e.target.value)} />
          </div>
        `;
      })}
    </div>
  `;
}

// ── Translation key patterns by extension ──
const EXT_TRANSLATION_KEYS = {
  'marketplace-behaviors': (cfg) => {
    const keys = [];
    const cats = cfg.categories || [];
    for (const cat of cats) keys.push('mkt.cat.' + cat);
    // Status labels, visibility labels are global — only custom ones need instance translations
    return keys;
  },
};

// ── AI prompt for generating instance translations ──
function buildTranslationAiPrompt(extName, instanceId, keys, targetLocale, existingTranslations) {
  const langName = targetLocale === 'fi' ? 'Finnish (suomi)' : targetLocale === 'en' ? 'English' : targetLocale;
  const keyList = keys.map(k => {
    const existing = existingTranslations[k];
    return `  ${k}${existing ? ` (current: "${existing}")` : ''}`;
  }).join('\n');

  return `I need translations for a "${extName}" extension instance called "${instanceId}".

Target language: ${langName}

These are i18n keys that need translated values. Each key follows a dot-notation pattern where the last segment hints at the meaning.

Keys to translate:
${keyList}

Please provide the translations in this exact JSON format (copy-pasteable):
{
${keys.map(k => `  "${k}": ""`).join(',\n')}
}

Rules:
- Translate naturally, not literally
- Keep translations concise (UI labels)
- Output ONLY the JSON object, nothing else`;
}

// ── Instance Translation Editor ──
function TranslationEditor({ extName, inst, onSave }) {
  const [locale, setLocale] = useState('fi');
  const [translations, setTranslations] = useState({});
  const [customKey, setCustomKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState('');

  // Derive required keys from config
  const keyFn = EXT_TRANSLATION_KEYS[extName];
  const autoKeys = keyFn ? keyFn(inst.config || {}) : [];

  // Merge: auto keys + any existing keys from stored translations
  const stored = inst.translations || {};
  const storedForLocale = stored[locale] || {};
  const allStoredKeys = Object.keys(storedForLocale);
  const allKeys = [...new Set([...autoKeys, ...allStoredKeys])].sort();

  // Sync local state when locale changes
  useEffect(() => {
    const s = (inst.translations || {})[locale] || {};
    setTranslations({ ...s });
    setJsonText(JSON.stringify(s, null, 2));
    setMsg(null);
  }, [locale, inst.translations]);

  function setKey(key, value) {
    setTranslations(prev => ({ ...prev, [key]: value }));
  }

  function removeKey(key) {
    setTranslations(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function addCustomKey() {
    if (!customKey.trim()) return;
    setTranslations(prev => ({ ...prev, [customKey.trim()]: '' }));
    setCustomKey('');
  }

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    try {
      let toSave = translations;
      if (jsonMode) {
        try { toSave = JSON.parse(jsonText); } catch { setMsg({ ok: false, text: 'Invalid JSON' }); setSaving(false); return; }
      }
      // Merge with existing translations for other locales
      const merged = { ...(inst.translations || {}), [locale]: toSave };
      await onSave(extName, inst.id, merged);
      setMsg({ ok: true, text: t('dashboard.servicesTlSaved') });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    }
    setSaving(false);
  }

  const displayKeys = [...new Set([...allKeys, ...Object.keys(translations)])].sort();

  return html`
    <div style="margin-top:8px;padding:10px;border:1px solid var(--glass-border);border-radius:6px;background:rgba(0,0,0,0.1)">
      <div class="adm-flex-center adm-mb-sm" style="flex-wrap:wrap">
        <strong style="font-size:.85rem">${t('dashboard.servicesTlTitle')}</strong>
        <select class="${inputStyle}" style="padding:4px 8px;font-size:.8rem" value=${locale}
          onChange=${e => setLocale(e.target.value)}>
          <option value="fi">Suomi (fi)</option>
          <option value="en">English (en)</option>
        </select>
        <button class="adm-btn-sm" onClick=${() => { setJsonMode(!jsonMode); if (!jsonMode) setJsonText(JSON.stringify(translations, null, 2)); }}
          style="font-size:.75rem">${jsonMode ? t('dashboard.servicesTlFormMode') : 'JSON'}</button>
        <${CopyButton} className="adm-btn-sm"
          text=${buildTranslationAiPrompt(extName, inst.id, allKeys.length > 0 ? allKeys : ['(no keys detected — add categories to config first)'], locale, translations)}
          label=${t('dashboard.servicesTlAiPrompt')} copiedLabel=${t('dashboard.servicesTlAiPrompt')}
          onCopied=${() => setMsg({ ok: true, text: t('dashboard.servicesTlPromptCopied') })} />
      </div>

      ${jsonMode ? html`
        <textarea value=${jsonText} onInput=${e => setJsonText(e.target.value)}
          style="width:100%;height:200px;font-family:monospace;font-size:12px;padding:8px;border:1px solid var(--glass-border);border-radius:4px;background:rgba(0,0,0,0.2);color:var(--text-bright);resize:vertical"
          spellcheck="false" />
      ` : html`
        <div class="adm-flex-col" style="gap:4px;max-height:300px;overflow-y:auto">
          ${displayKeys.map(key => html`
            <div style="display:flex;align-items:center;gap:6px">
              <code style="font-size:.75rem;color:var(--text-dim);min-width:140px;flex-shrink:0">${key}</code>
              <input type="text" class="${inputStyle}" style="flex:1;padding:4px 8px;font-size:.85rem" value=${translations[key] || ''}
                placeholder=${key.split('.').pop()}
                onInput=${e => setKey(key, e.target.value)} />
              ${!autoKeys.includes(key) && html`
                <button class="adm-btn-sm" style="font-size:.7rem;padding:2px 6px" onClick=${() => removeKey(key)}>\u2715</button>
              `}
            </div>
          `)}
        </div>
        <div style="display:flex;gap:6px;margin-top:6px;align-items:center">
          <input type="text" class="${inputStyle}" style="padding:4px 8px;font-size:.8rem;flex:1" value=${customKey}
            placeholder=${t('dashboard.servicesTlAddKey')} onInput=${e => setCustomKey(e.target.value)}
            onKeyDown=${e => { if (e.key === 'Enter') addCustomKey(); }} />
          <button class="adm-btn-sm" style="font-size:.75rem" onClick=${addCustomKey}>+</button>
        </div>
      `}

      <div class="adm-flex-center adm-mt-sm">
        <button class="adm-btn-action adm-text-sm" onClick=${handleSave} disabled=${saving}>
          ${saving ? '...' : t('dashboard.servicesTlSave')}</button>
        ${msg && html`<span class="adm-text-sm" style="color:${msg.ok ? '#22c55e' : '#ef4444'}">${msg.text}</span>`}
      </div>
    </div>
  `;
}

// ── Action Script Editor ──
function ActionScriptEditor({ extName, actions, onUpdated }) {
  const [selectedAction, setSelectedAction] = useState(null);
  const [script, setScript] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  async function loadScript(actionId) {
    if (selectedAction === actionId) { setSelectedAction(null); return; }
    setLoading(true); setMsg(null);
    try {
      const res = await getActionScript(extName, actionId);
      setScript(res.data?.action?.scriptContent || '');
      setSelectedAction(actionId);
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    setLoading(false);
  }

  async function handleSave() {
    setSaving(true); setMsg(null);
    try {
      await updateActionScript(extName, selectedAction, script);
      setMsg({ ok: true, text: t('dashboard.servicesScriptSaved') });
      if (onUpdated) onUpdated();
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    setSaving(false);
  }

  return html`
    <div style="margin-top:8px;padding:10px;border:1px solid var(--glass-border);border-radius:6px;background:rgba(0,0,0,0.1)">
      <div class="adm-flex-center adm-mb-sm" style="flex-wrap:wrap">
        <strong style="font-size:.85rem">${t('dashboard.servicesScriptEditor')}</strong>
        ${actions.map(a => html`
          <button class="adm-btn-sm" onClick=${() => loadScript(a.id)}
            style="font-size:.75rem${selectedAction === a.id ? ';color:#818cf8;border-color:rgba(79,70,229,0.4)' : ''}">
            ${a.method} ${escHtml(a.id)}
          </button>
        `)}
      </div>

      ${loading && html`<p class="adm-text-dim adm-text-base">${t('dashboard.loading')}...</p>`}

      ${selectedAction && !loading && html`
        <div style="margin-top:4px">
          <div class="adm-flex-between adm-mb-xs">
            <code style="font-size:.8rem;color:var(--text-dim)">${extName}/${selectedAction}</code>
          </div>
          <textarea value=${script} onInput=${e => setScript(e.target.value)}
            style="width:100%;height:320px;font-family:'Fira Code',monospace;font-size:12px;line-height:1.5;padding:10px;border:1px solid var(--glass-border);border-radius:4px;background:rgba(0,0,0,0.3);color:var(--text-bright);resize:vertical;tab-size:2"
            spellcheck="false"
            onKeyDown=${e => {
              if (e.key === 'Tab') {
                e.preventDefault();
                const ta = e.target;
                const start = ta.selectionStart;
                const end = ta.selectionEnd;
                const val = ta.value;
                ta.value = val.substring(0, start) + '  ' + val.substring(end);
                ta.selectionStart = ta.selectionEnd = start + 2;
                setScript(ta.value);
              }
              if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleSave();
              }
            }}
          />
          <div class="adm-flex-center" style="margin-top:6px">
            <button class="adm-btn-action adm-text-sm" onClick=${handleSave} disabled=${saving}>
              ${saving ? '...' : t('dashboard.servicesScriptSave')}</button>
            <span style="font-size:.75rem" class="adm-text-dim">Ctrl+S</span>
            ${msg && html`<span class="adm-text-sm" style="color:${msg.ok ? '#22c55e' : '#ef4444'}">${msg.text}</span>`}
          </div>
        </div>
      `}
    </div>
  `;
}

// ── Extension Scaffold Form ──
function ScaffoldForm({ onCreated }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [multiInstance, setMultiInstance] = useState(true);
  const [apis, setApis] = useState(['memory', 'wallet']);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState(null);

  const allApis = ['memory', 'wallet', 'consent', 'trust'];

  function toggleApi(api) {
    setApis(prev => prev.includes(api) ? prev.filter(a => a !== api) : [...prev, api]);
  }

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true); setMsg(null);
    try {
      await scaffoldExtension({ name: name.trim(), description: description.trim(), multiInstance, apis });
      setMsg({ ok: true, text: t('dashboard.servicesScaffoldDone') });
      setName(''); setDescription('');
      if (onCreated) onCreated();
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    setCreating(false);
  }

  return html`
    <div class="adm-card" style="padding:16px;margin-bottom:16px">
      <h3 style="margin:0 0 12px;font-size:1rem">${t('dashboard.servicesScaffoldTitle')}</h3>
      <p class="adm-text-dim adm-text-base adm-mb-md" style="margin:0">${t('dashboard.servicesScaffoldDesc')}</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div style=${fieldWrap}>
          <label class="${labelStyle}">${t('dashboard.servicesName')}</label>
          <input type="text" value=${name} onInput=${e => setName(e.target.value)}
            class="${inputStyle}" style="width:220px" placeholder="my-service" />
        </div>
        <div style=${fieldWrap + ';flex:1;min-width:200px'}>
          <label class="${labelStyle}">${t('dashboard.servicesScaffoldDescLabel')}</label>
          <input type="text" value=${description} onInput=${e => setDescription(e.target.value)}
            class="${inputStyle}" placeholder="What does this extension do?" />
        </div>
      </div>
      <div style="display:flex;gap:12px;align-items:center;margin-top:10px;flex-wrap:wrap">
        <div style="display:flex;gap:6px;align-items:center">
          <label style="font-size:.8rem;color:var(--text-dim)">APIs:</label>
          ${allApis.map(api => html`
            <label style="display:flex;align-items:center;gap:3px;font-size:.8rem;cursor:pointer;color:${apis.includes(api) ? 'var(--text-bright)' : 'var(--text-dim)'}">
              <input type="checkbox" checked=${apis.includes(api)} onChange=${() => toggleApi(api)} />
              ${api}
            </label>
          `)}
        </div>
        <label style="display:flex;align-items:center;gap:4px;font-size:.8rem;cursor:pointer;color:var(--text-dim)">
          <input type="checkbox" checked=${multiInstance} onChange=${e => setMultiInstance(e.target.checked)} />
          ${t('dashboard.servicesMultiInstance')}
        </label>
      </div>
      <div class="adm-flex-center adm-mt-md">
        <button class="adm-btn-action" onClick=${handleCreate} disabled=${creating || !name.trim()}>
          ${creating ? '...' : t('dashboard.servicesScaffoldBtn')}</button>
        ${msg && html`<span class="adm-text-base" style="color:${msg.ok ? '#22c55e' : '#ef4444'}">${msg.text}</span>`}
      </div>
    </div>
  `;
}

// ── Inline instance panel for a single extension ──
function ExtensionPanel({ ext, onUninstall }) {
  const [toast, showErr, showOk, clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();
  const [expanded, setExpanded] = useState(false);
  const [instances, setInstances] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newId, setNewId] = useState('');
  const [editingTl, setEditingTl] = useState(null); // instance id with open translation editor
  const [editingCfg, setEditingCfg] = useState(null); // instance id with open config editor
  const [editCfgData, setEditCfgData] = useState({});
  const [showScripts, setShowScripts] = useState(false);

  const schema = ext.instances?.configSchema || null;
  const [newConfig, setNewConfig] = useState(() => buildDefaults(schema));

  function loadInstances() {
    setLoading(true);
    getExtensionInstances(ext.name)
      .then(res => setInstances(res.data?.instances || []))
      .catch(() => setInstances([]))
      .finally(() => setLoading(false));
  }

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next) loadInstances();
  }

  async function handleCreate() {
    if (!newId.trim()) return;
    const body = { id: newId.trim() };
    // Only include non-empty config values
    const cfg = {};
    for (const [k, v] of Object.entries(newConfig)) {
      if (v !== '' && v !== undefined && v !== null) cfg[k] = v;
    }
    if (Object.keys(cfg).length > 0) body.config = cfg;
    try {
      await createExtensionInstance(ext.name, body);
      setNewId('');
      setNewConfig(buildDefaults(schema));
      setShowCreate(false);
      loadInstances();
    } catch (e) { showErr(e.message); }
  }

  async function handleToggleStatus(inst) {
    const newStatus = inst.status === 'active' ? 'paused' : 'active';
    try {
      await updateExtensionInstance(ext.name, inst.id, { status: newStatus });
      loadInstances();
    } catch (e) { showErr(e.message); }
  }

  function handleDelete(inst) {
    confirm(t('dashboard.servicesDeleteConfirm') + ': ' + inst.id + '?', async () => {
      try {
        await deleteExtensionInstance(ext.name, inst.id);
        loadInstances();
      } catch (e) { showErr(e.message); }
    }, { danger: true });
  }

  async function handleSaveTranslations(extName, instId, translations) {
    await updateExtensionInstance(extName, instId, { translations });
    loadInstances();
  }

  async function handleSaveConfig(inst) {
    try {
      await updateExtensionInstance(ext.name, inst.id, { config: editCfgData });
      setEditingCfg(null);
      loadInstances();
    } catch (e) { showErr(e.message); }
  }

  function openConfigEditor(inst) {
    if (editingCfg === inst.id) {
      setEditingCfg(null);
    } else {
      setEditCfgData({ ...(inst.config || {}) });
      setEditingCfg(inst.id);
    }
  }

  const actionCount = ext.actionCount || ext.action_count || ext.actionsCount || 0;
  const instanceCount = ext.instanceCount || ext.instance_count || 0;

  return html`
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <div class="adm-card" style="margin-bottom:8px;overflow:hidden">
      <!-- Extension header row -->
      <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;user-select:none"
        onClick=${toggle}>
        <span style="font-size:.9rem;color:var(--text-dim);width:16px">${expanded ? '\u25BC' : '\u25B6'}</span>
        <strong style="flex:1;min-width:0">${escHtml(ext.name)}</strong>
        <span class="adm-text-dim adm-text-base">${escHtml(ext.version || '\u2014')}</span>
        <${Badge} type=${ext.status === 'active' ? 'healthy' : 'warning'} />
        <span class="adm-text-dim adm-text-base" style="min-width:80px;text-align:right">
          ${actionCount} ${t('dashboard.servicesActionsCount').toLowerCase()}, ${instanceCount} inst.
        </span>
        <div style="display:flex;gap:4px" onClick=${e => e.stopPropagation()}>
          <button class="adm-btn-sm adm-btn-danger" onClick=${() => onUninstall(ext.name)}>
            ${t('dashboard.servicesUninstall')}
          </button>
        </div>
      </div>

      <!-- Expanded instance panel -->
      ${expanded && html`
        <div style="border-top:1px solid var(--glass-border);padding:12px 16px;background:rgba(0,0,0,0.15)">
          <div class="adm-flex-center adm-mb-sm">
            <button class="adm-btn-sm" onClick=${() => setShowCreate(!showCreate)}>
              + ${t('dashboard.servicesCreateInstance')}
            </button>
            ${(ext.actions || []).length > 0 && html`
              <button class="adm-btn-sm" onClick=${() => setShowScripts(!showScripts)}
                style="font-size:.8rem${showScripts ? ';color:#818cf8;border-color:rgba(79,70,229,0.4)' : ''}">
                \u{1F4DD} ${t('dashboard.servicesScriptEditor')}
              </button>
            `}
            <button class="adm-btn-sm" onClick=${loadInstances} style="font-size:.8rem">
              \u21BB
            </button>
          </div>

          ${showScripts && html`
            <${ActionScriptEditor} extName=${ext.name} actions=${ext.actions || []} />
          `}

          ${showCreate && html`
            <div style="margin-bottom:12px;padding:12px;border:1px solid var(--glass-border);border-radius:6px;display:flex;flex-direction:column;gap:10px">
              <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
                <div style=${fieldWrap}>
                  <label class="${labelStyle}">${t('dashboard.servicesInstanceId')}</label>
                  <input type="text" value=${newId} onInput=${e => setNewId(e.target.value)}
                    class="${inputStyle}" style="width:200px" placeholder="my-instance-01" />
                </div>
                <button class="adm-btn-action" onClick=${handleCreate}>
                  ${t('dashboard.servicesCreateInstance')}
                </button>
              </div>
              ${schema && html`
                <div>
                  <div style="font-size:.85rem;color:var(--text-dim);margin-bottom:6px;border-top:1px solid var(--glass-border);padding-top:8px">
                    ${t('dashboard.servicesInstanceConfig')}
                  </div>
                  <${ConfigForm} schema=${schema} config=${newConfig} onChange=${setNewConfig} />
                </div>
              `}
            </div>
          `}

          ${loading
            ? html`<p class="adm-text-dim" style="margin:0">${t('dashboard.loading')}...</p>`
            : instances.length === 0
              ? html`<p class="adm-text-dim" style="margin:0;font-size:.9rem">${t('dashboard.servicesNoInstances')}</p>`
              : html`
                <div class="adm-flex-col" style="gap:4px">
                  ${instances.map(inst => {
                    const spaUrl = EXT_SPA_URLS[ext.name];
                    const tlOpen = editingTl === inst.id;
                    const cfgOpen = editingCfg === inst.id;
                    return html`
                    <div>
                      <div style="display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:4px;background:var(--glass-bg)">
                        <code style="flex:1;min-width:0;font-size:.9rem">${escHtml(inst.id)}</code>
                        <${Badge} type=${inst.status === 'active' ? 'healthy' : 'warning'} />
                        <span class="adm-text-dim adm-text-sm">${escHtml(inst.createdBy || inst.created_by || '')}</span>
                        <span class="adm-text-dim adm-text-sm">${dt(inst.createdAt || inst.created_at)}</span>
                        ${spaUrl && html`
                          <a class="adm-btn-sm" href=${spaUrl} target="_blank"
                            style="text-decoration:none;color:var(--accent-bright)"
                            title=${t('dashboard.servicesOpenApp')}>
                            \u2197 ${t('dashboard.servicesOpenApp')}
                          </a>
                        `}
                        ${schema && html`
                          <button class="adm-btn-sm" onClick=${() => openConfigEditor(inst)}
                            style="font-size:.75rem${cfgOpen ? ';color:#818cf8' : ''}"
                            title=${t('dashboard.servicesEditConfig')}>
                            \u2699
                          </button>
                        `}
                        <button class="adm-btn-sm" onClick=${() => setEditingTl(tlOpen ? null : inst.id)}
                          style="font-size:.75rem${tlOpen ? ';color:#818cf8' : ''}"
                          title=${t('dashboard.servicesTlTitle')}>
                          \uD83C\uDF10
                        </button>
                        <button class="adm-btn-sm" onClick=${() => handleToggleStatus(inst)}>
                          ${inst.status === 'active' ? '\u23F8' : '\u25B6'}
                        </button>
                        <button class="adm-btn-sm adm-btn-danger" onClick=${() => handleDelete(inst)}>
                          \u2715
                        </button>
                      </div>
                      ${cfgOpen && html`
                        <div style="margin-top:8px;padding:10px;border:1px solid var(--glass-border);border-radius:6px;background:rgba(0,0,0,0.1)">
                          <div style="font-size:.85rem;color:var(--text-dim);margin-bottom:8px">
                            <strong>${t('dashboard.servicesEditConfig')}</strong>
                          </div>
                          <${ConfigForm} schema=${schema} config=${editCfgData} onChange=${setEditCfgData} />
                          <div class="adm-flex adm-mt-md">
                            <button class="adm-btn-action adm-text-sm" onClick=${() => handleSaveConfig(inst)}>
                              ${t('dashboard.servicesCfgSave')}</button>
                            <button class="adm-btn-sm adm-text-sm" onClick=${() => setEditingCfg(null)}>
                              ${t('dashboard.servicesCfgCancel')}</button>
                          </div>
                        </div>
                      `}
                      ${tlOpen && html`
                        <${TranslationEditor} extName=${ext.name} inst=${inst} onSave=${handleSaveTranslations} />
                      `}
                    </div>
                  `; })}
                </div>
              `
          }
        </div>
      `}
    </div>
  `;
}

// ── Available Extension Card (with disk script editor + add action) ──
function AvailableExtCard({ ext, isInstalled, isInstalling, onInstall, onReinstall, reload, loadAvailable }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [showEditor, setShowEditor] = useState(false);
  const [selectedAction, setSelectedAction] = useState(null);
  const [script, setScript] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [showAddAction, setShowAddAction] = useState(false);
  const [newActionId, setNewActionId] = useState('');
  const [newActionMethod, setNewActionMethod] = useState('POST');
  const [newActionDesc, setNewActionDesc] = useState('');
  const [adding, setAdding] = useState(false);

  const actions = ext.actions || [];

  async function loadScript(actionId) {
    if (selectedAction === actionId) { setSelectedAction(null); return; }
    setLoading(true); setMsg(null);
    try {
      const res = await getDiskScript(ext.name, actionId);
      setScript(res.data?.scriptContent || '');
      setSelectedAction(actionId);
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    setLoading(false);
  }

  async function handleSave() {
    setSaving(true); setMsg(null);
    try {
      await saveDiskScript(ext.name, selectedAction, script);
      setMsg({ ok: true, text: t('dashboard.servicesScriptSaved') });
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    setSaving(false);
  }

  async function handleReinstall() {
    setMsg(null);
    try {
      await onReinstall(ext.name);
      setMsg({ ok: true, text: t('dashboard.servicesReinstalled') });
    } catch (e) { setMsg({ ok: false, text: e.message }); }
  }

  async function handleAddAction() {
    if (!newActionId.trim()) return;
    setAdding(true); setMsg(null);
    try {
      await addDiskAction(ext.name, { id: newActionId.trim(), method: newActionMethod, description: newActionDesc.trim() || undefined });
      setMsg({ ok: true, text: t('dashboard.servicesActionAdded') });
      setNewActionId(''); setNewActionDesc(''); setShowAddAction(false);
      loadAvailable(); // refresh available list to get updated actions
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    setAdding(false);
  }

  return html`
    <div class="adm-card" style="padding:16px;display:flex;flex-direction:column;gap:8px">
      <div class="adm-flex-between">
        <strong style="font-size:1.05rem">${escHtml(ext.name)}</strong>
        <span class="adm-text-dim adm-text-base">v${escHtml(ext.version)}</span>
      </div>
      <p class="adm-text-dim" style="margin:0;font-size:.9rem">${escHtml(ext.description)}</p>
      <div class="adm-flex-wrap adm-text-sm">
        <span class="adm-text-dim">${t('dashboard.servicesApis')}: ${ext.requiredApis.join(', ')}</span>
        <span style="color:${ext.instancesSupported ? 'var(--green, #22c55e)' : 'var(--text-dim)'}">
          ${ext.instancesSupported ? t('dashboard.servicesMultiInstance') : t('dashboard.servicesSingleInstance')}
        </span>
        <span class="adm-text-dim">${actions.length} ${t('dashboard.servicesActionsCount').toLowerCase()}</span>
      </div>
      <div style="margin-top:4px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        ${isInstalled
          ? html`
            <button class="adm-btn-action" disabled=${isInstalling} onClick=${handleReinstall}>
              ${isInstalling ? '...' : t('dashboard.servicesReinstall')}
            </button>
            <span class="adm-text-sm adm-text-dim">${t('dashboard.servicesInstalled')}</span>
          `
          : html`<button class="adm-btn-action" disabled=${isInstalling} onClick=${() => onInstall(ext.name)}>
              ${isInstalling ? t('dashboard.servicesInstalling') : t('dashboard.servicesInstall')}
            </button>`
        }
        <button class="adm-btn-sm" onClick=${() => setShowEditor(!showEditor)}
          style="font-size:.8rem${showEditor ? ';color:#818cf8;border-color:rgba(79,70,229,0.4)' : ''}">
          \u{1F4DD} ${t('dashboard.servicesScriptEditor')}
        </button>
        ${msg && html`<span class="adm-text-sm" style="color:${msg.ok ? '#22c55e' : '#ef4444'}">${msg.text}</span>`}
      </div>

      ${showEditor && html`
        <div style="margin-top:4px;padding:10px;border:1px solid var(--glass-border);border-radius:6px;background:rgba(0,0,0,0.1)">
          <div class="adm-flex-center adm-mb-sm" style="flex-wrap:wrap">
            <strong style="font-size:.85rem">${t('dashboard.servicesScriptEditor')}</strong>
            ${actions.map(a => html`
              <button class="adm-btn-sm" onClick=${() => loadScript(a.id)}
                style="font-size:.75rem${selectedAction === a.id ? ';color:#818cf8;border-color:rgba(79,70,229,0.4)' : ''}">
                ${a.method} ${escHtml(a.id)}
              </button>
            `)}
            <button class="adm-btn-sm" onClick=${() => setShowAddAction(!showAddAction)}
              style="font-size:.75rem;color:var(--green, #22c55e)${showAddAction ? ';border-color:var(--green, #22c55e)' : ''}">
              + ${t('dashboard.servicesAddAction')}
            </button>
          </div>

          ${showAddAction && html`
            <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px;padding:8px;border:1px solid var(--glass-border);border-radius:4px">
              <div style=${fieldWrap}>
                <label class="${labelStyle}">ID</label>
                <input type="text" value=${newActionId} onInput=${e => setNewActionId(e.target.value)}
                  class="${inputStyle}" style="width:160px;padding:4px 8px;font-size:.85rem" placeholder="my-action" />
              </div>
              <div style=${fieldWrap}>
                <label class="${labelStyle}">Method</label>
                <select class="${inputStyle}" style="padding:4px 8px;font-size:.85rem" value=${newActionMethod}
                  onChange=${e => setNewActionMethod(e.target.value)}>
                  <option value="POST">POST</option><option value="GET">GET</option>
                  <option value="PUT">PUT</option><option value="DELETE">DELETE</option>
                </select>
              </div>
              <div style=${fieldWrap + ';flex:1;min-width:120px'}>
                <label class="${labelStyle}">${t('dashboard.servicesScaffoldDescLabel')}</label>
                <input type="text" value=${newActionDesc} onInput=${e => setNewActionDesc(e.target.value)}
                  class="${inputStyle}" style="padding:4px 8px;font-size:.85rem" placeholder="What does this action do?" />
              </div>
              <button class="adm-btn-action" style="font-size:.8rem" onClick=${handleAddAction}
                disabled=${adding || !newActionId.trim()}>
                ${adding ? '...' : t('dashboard.servicesAddAction')}</button>
            </div>
          `}

          ${loading && html`<p class="adm-text-dim adm-text-base">${t('dashboard.loading')}...</p>`}

          ${selectedAction && !loading && html`
            <div>
              <code class="adm-text-sm adm-text-dim">${ext.name}/actions/${selectedAction}.js</code>
              <textarea value=${script} onInput=${e => setScript(e.target.value)}
                style="width:100%;height:320px;font-family:'Fira Code',monospace;font-size:12px;line-height:1.5;padding:10px;border:1px solid var(--glass-border);border-radius:4px;background:rgba(0,0,0,0.3);color:var(--text-bright);resize:vertical;tab-size:2;margin-top:4px"
                spellcheck="false"
                onKeyDown=${e => {
                  if (e.key === 'Tab') {
                    e.preventDefault();
                    const ta = e.target;
                    const start = ta.selectionStart;
                    const end = ta.selectionEnd;
                    const val = ta.value;
                    ta.value = val.substring(0, start) + '  ' + val.substring(end);
                    ta.selectionStart = ta.selectionEnd = start + 2;
                    setScript(ta.value);
                  }
                  if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleSave();
                  }
                }}
              />
              <div class="adm-flex-center" style="margin-top:6px">
                <button class="adm-btn-action adm-text-sm" onClick=${handleSave} disabled=${saving}>
                  ${saving ? '...' : t('dashboard.servicesScriptSave')}</button>
                <span style="font-size:.75rem" class="adm-text-dim">Ctrl+S</span>
              </div>
            </div>
          `}

          ${actions.length === 0 && !showAddAction && html`
            <p class="adm-text-dim adm-text-base" style="margin:0">${t('dashboard.servicesNoActions')}</p>
          `}
        </div>
      `}
    </div>
    <${ConfirmUI} />
  `;
}

export default function ServicesTab({ data, reload }) {
  const [toast, showErr, showOk, clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();
  const extensions = data.extensions?.extensions || [];
  const [available, setAvailable] = useState([]);
  const [loadingAvailable, setLoadingAvailable] = useState(false);
  const [installingName, setInstallingName] = useState(null);

  function loadAvailable() {
    setLoadingAvailable(true);
    getAvailableExtensions()
      .then(res => setAvailable(res.data?.extensions || []))
      .catch(() => setAvailable([]))
      .finally(() => setLoadingAvailable(false));
  }

  // Load available bundled extensions
  useEffect(() => { loadAvailable(); }, [extensions.length]);

  async function handleInstall(name) {
    setInstallingName(name);
    try {
      await installBundledExtension(name);
      reload();
    } catch (e) {
      showErr(e.message);
    } finally {
      setInstallingName(null);
    }
  }

  function handleUninstall(name) {
    confirm(t('dashboard.servicesUninstallConfirm') + ': ' + name + '?', async () => {
      try {
        await uninstallExtension(name);
        reload();
      } catch (e) {
        showErr(e.message);
      }
    }, { danger: true });
  }

  async function handleReinstall(name) {
    setInstallingName(name);
    try {
      await reinstallExtension(name);
      reload();
    } catch (e) {
      showErr(e.message);
    } finally {
      setInstallingName(null);
    }
  }

  // ── Stats ──
  const totalExtensions = extensions.length;
  const activeExtensions = extensions.filter(e => e.status === 'active').length;
  const totalInstances = extensions.reduce((sum, e) => sum + (e.instanceCount || e.instance_count || 0), 0);

  const statsItems = [
    { label: t('dashboard.servicesTotal'), value: totalExtensions },
    { label: t('dashboard.servicesActive'), value: activeExtensions, color: 'var(--green, #22c55e)' },
    { label: t('dashboard.servicesInstances'), value: totalInstances },
  ];

  const installedNames = new Set(extensions.map(e => e.name));

  return html`
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <${ExpandableHelp} title=${t('dashboard.servicesHelpTitle')}>
      <p>${t('dashboard.servicesHelpDetail')}</p>
    <//>
    <${StatsGrid} items=${statsItems} />
    <p class="adm-text-dim" style="margin:8px 0 16px">${t('dashboard.servicesExplain')}</p>

    ${extensions.length > 0 && html`
      ${extensions.map(ext => html`
        <${ExtensionPanel} ext=${ext} onUninstall=${handleUninstall} />
      `)}
    `}

    <${ScaffoldForm} onCreated=${reload} />

    <h3 style="margin:24px 0 8px">${t('dashboard.servicesAvailable')}</h3>
    <p class="adm-text-dim" style="margin:0 0 16px;font-size:.9rem">${t('dashboard.servicesAvailableDesc')}</p>

    ${loadingAvailable
      ? html`<p>${t('dashboard.loading')}...</p>`
      : available.length === 0
        ? html`<${Empty} text=${t('dashboard.servicesNoExtensions')} />`
        : html`
          <div class="adm-flex-col" style="gap:12px">
            ${available.map(ext => {
              const isInstalled = ext.installed || installedNames.has(ext.name);
              const isInstalling = installingName === ext.name;
              return html`<${AvailableExtCard} ext=${ext} isInstalled=${isInstalled}
                isInstalling=${isInstalling}
                onInstall=${handleInstall} onReinstall=${handleReinstall} reload=${reload}
                loadAvailable=${loadAvailable} />`;
            })}
          </div>
        `
    }

    <div style="margin-top:32px;padding:20px;border:1px solid var(--glass-border);border-radius:8px;background:rgba(0,0,0,0.1)">
      <h3 style="margin:0 0 12px;font-size:1rem">${t('dashboard.servicesManualTitle')}</h3>

      <div class="adm-text-dim adm-text-base" style="line-height:1.6">
        <p style="margin:0 0 12px"><strong style="color:var(--text-bright)">${t('dashboard.servicesManualWorkflow')}</strong></p>
        <ol style="margin:0 0 16px;padding-left:20px">
          <li>${t('dashboard.servicesManualStep1')}</li>
          <li>${t('dashboard.servicesManualStep2')}</li>
          <li>${t('dashboard.servicesManualStep3')}</li>
          <li>${t('dashboard.servicesManualStep4')}</li>
          <li>${t('dashboard.servicesManualStep5')}</li>
        </ol>

        <p style="margin:0 0 8px"><strong style="color:var(--text-bright)">${t('dashboard.servicesManualCtxTitle')}</strong></p>
        <pre style="background:rgba(0,0,0,0.3);border-radius:4px;padding:10px;font-size:12px;line-height:1.5;overflow-x:auto;color:var(--text-bright);margin:0 0 16px"><code>// ${t('dashboard.servicesManualCtxAvailable')}
const { input, memory, wallet, caller, config, instance, log } = ctx;

// caller.gaii   — ${t('dashboard.servicesManualCtxCaller')}
// caller.owner  — ${t('dashboard.servicesManualCtxOwner')}
// input         — ${t('dashboard.servicesManualCtxInput')}
// instance.id   — ${t('dashboard.servicesManualCtxInstance')}

// memory.get(key)            — ${t('dashboard.servicesManualCtxMemGet')}
// memory.set(key, value)     — ${t('dashboard.servicesManualCtxMemSet')}
// memory.list(prefix)        — ${t('dashboard.servicesManualCtxMemList')}
// memory.delete(key)         — ${t('dashboard.servicesManualCtxMemDel')}

// wallet.balance(gaii)       — ${t('dashboard.servicesManualCtxWalBal')}
// wallet.transfer(from, to, amount) — ${t('dashboard.servicesManualCtxWalTx')}

// log(message)               — ${t('dashboard.servicesManualCtxLog')}

return { ok: true, data: {} }; // ${t('dashboard.servicesManualCtxReturn')}</code></pre>

        <p style="margin:0 0 8px"><strong style="color:var(--text-bright)">${t('dashboard.servicesManualTipsTitle')}</strong></p>
        <ul style="margin:0;padding-left:20px">
          <li>${t('dashboard.servicesManualTip1')}</li>
          <li>${t('dashboard.servicesManualTip2')}</li>
          <li>${t('dashboard.servicesManualTip3')}</li>
          <li>${t('dashboard.servicesManualTip4')}</li>
        </ul>
      </div>
    </div>
    <${ConfirmUI} />
  `;
}
