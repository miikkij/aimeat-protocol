/**
 * @file public/views/admin/extensions-tab.action-editor.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Installed-extension action script editor for the admin Extensions tab. Extracted from the tab file to satisfy max-file-lines.
 * @version-history
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set: the actions as tabs, the script
 *     in a shared many-line field, the save as an underlined action. Tab and Ctrl+S work as before.
 *   v1.0.0 — 2026-07-13 — Extracted from the tab file (max-file-lines)
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Stack, Field, Action, Text } from '/components/poster-parts.js';
import { getActionScript, updateActionScript } from '/js/services/admin.js';

/**
 * Tab inserts two spaces and Ctrl+S saves: the keys a script editor answers to. Shared by the
 * installed-extension editor and the release card's disk-script editor.
 */
export function scriptKeys(setScript, save) {
  return (e) => {
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
      save();
    }
  };
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

  return html`<${Stack}>
    <${Stack} direction="wrap" align="center" density="compact">
      <${Text} kind="label">${t('dashboard.servicesScriptEditor')}<//>
      ${actions.map(a => html`<${Action} key=${a.id} kind="tab" selected=${selectedAction === a.id}
        onClick=${() => loadScript(a.id)}>${a.method} ${escHtml(a.id)}<//>`)}
    <//>

    ${loading && html`<${Text} kind="caption" tone="muted">${t('dashboard.loading')}...<//>`}

    ${selectedAction && !loading && html`<${Stack} density="compact">
      <${Text} kind="mono" tone="muted">${extName}/${selectedAction}<//>
      <${Field} type="textarea" rows=${16} ariaLabel=${`${extName}/${selectedAction}`} value=${script}
        spellCheck=${false} onInput=${e => setScript(e.target.value)} onKeyDown=${scriptKeys(setScript, handleSave)} />
      <${Stack} direction="wrap" align="center">
        <${Action} onClick=${handleSave} disabled=${saving}>${saving ? '...' : t('dashboard.servicesScriptSave')}<//>
        <${Text} kind="mono" tone="muted">Ctrl+S<//>
        ${msg && html`<${Text} tone=${msg.ok ? 'success' : 'danger'}>${msg.text}<//>`}
      <//>
    <//>`}
  <//>`;
}

export { ActionScriptEditor };
