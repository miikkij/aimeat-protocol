/**
 * @file services-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin Dashboard — Services Tab. Manage installed service
 *   extensions and their instances, install bundled extensions one-click,
 *   edit action scripts and instance translations.
 * @version-history
 *   v1.1.0 — 2026-06-02 — Admin design unification: raw script/JSON textareas
 *     → adm-textarea adm-input-full (drop inline mono/resize/border styles).
 *   v1.2.0 — 2026-07-13 — Split sub-components (config-form/translation-editor/
 *     action-editor/scaffold-form/available-card) into siblings for max-file-lines.
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
  uninstallExtension, reinstallExtension,
} from '/js/services/admin.js';
import { useConfirm } from '/components/Modal.js';
import { inputStyle, labelStyle, fieldWrap, buildDefaults, ConfigForm } from './services-tab.config-form.js';
import { TranslationEditor } from './services-tab.translation-editor.js';
import { ActionScriptEditor } from './services-tab.action-editor.js';
import { ScaffoldForm } from './services-tab.scaffold-form.js';
import { AvailableExtCard } from './services-tab.available-card.js';

// Extension name → user-facing SPA URL (the marketplace-behaviors → /v1/marketplace
// entry was removed with the legacy marketplace SPA view; extensions are managed
// from this panel now, so the map is currently empty).
const EXT_SPA_URLS = {};

// ── Inline instance panel for a single extension ──
function ExtensionPanel({ ext, onUninstall }) {
  const [toast, showErr, , clearToast] = useToast();
  const { confirm } = useConfirm();
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

export default function ServicesTab({ data, reload }) {
  const [toast, showErr, , clearToast] = useToast();
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
