/**
 * @file public/views/admin/services-tab.action-editor.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Installed-extension action script editor for the admin Services tab. Extracted from services-tab.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from services-tab.js (max-file-lines)
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { getActionScript, updateActionScript } from '/js/services/admin.js';

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
          <textarea class="adm-textarea adm-input-full" value=${script} onInput=${e => setScript(e.target.value)}
            style="height:320px;font-size:12px"
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

export { ActionScriptEditor };
