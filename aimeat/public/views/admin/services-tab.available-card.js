/**
 * @file public/views/admin/services-tab.available-card.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Available (bundled) extension card with disk-script editor + add-action for the admin Services tab. Extracted from services-tab.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from services-tab.js (max-file-lines)
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { useConfirm } from '/components/Modal.js';
import { getDiskScript, saveDiskScript, addDiskAction } from '/js/services/admin.js';
import { inputStyle, labelStyle, fieldWrap } from './services-tab.config-form.js';

// ── Available Extension Card (with disk script editor + add action) ──
function AvailableExtCard({ ext, isInstalled, isInstalling, onInstall, onReinstall, loadAvailable }) {
  const { ConfirmUI } = useConfirm();
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
              <textarea class="adm-textarea adm-input-full" value=${script} onInput=${e => setScript(e.target.value)}
                style="height:320px;font-size:12px;margin-top:4px"
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

export { AvailableExtCard };
