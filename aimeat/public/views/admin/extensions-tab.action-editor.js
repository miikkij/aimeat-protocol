/**
 * @file public/views/admin/extensions-tab.action-editor.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Installed-extension action script editor for the admin Extensions tab: pick one of the
 *   extension's actions, read its script, change it and save it (Tab indents, Ctrl+S or Cmd+S saves).
 *   Extracted from the tab file to satisfy max-file-lines.
 * @version-history
 *   v2.0.0 — 2026-09-27 — The library's parts (admin page group G7): the editor stands in the dashed
 *     field Box, the actions are a row of Tabs (the open one chosen), the script a typewriter TextArea
 *     that owns its Tab-indent and its Ctrl+S save, the answer the form message. No class, no style.
 *   v1.0.0 — 2026-07-13 — Extracted from the tab file (max-file-lines)
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { getActionScript, updateActionScript } from '/js/services/admin.js';
import { Box } from '/components/Box.js';
import { Tabs } from '/components/Tabs.js';
import { TextArea } from '/components/TextField.js';
import { Action } from '/components/Action.js';
import { Label, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Stack, Row } from '/components/Layout.js';

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
    <${Box} tone="field">
      <${Label} block>${t('dashboard.servicesScriptEditor')}<//>
      <${Tabs} label=${t('dashboard.servicesScriptEditor')} value=${selectedAction} onSelect=${loadScript}
        items=${actions.map(a => ({ value: a.id, label: `${a.method} ${a.id}` }))} />

      ${loading ? html`<${Note} kind="loading">${t('dashboard.loading')}...<//>` : null}

      ${selectedAction && !loading ? html`
        <${Stack}>
          <${Code}>${extName}/${selectedAction}<//>
          <${TextArea} code indent rows=${14} ariaLabel=${`${extName}/${selectedAction}`} value=${script}
            onInput=${setScript} onSave=${handleSave} />
          <${Row} gap="medium" wrap>
            <${Action} small onClick=${handleSave} disabled=${saving}>${saving ? '...' : t('dashboard.servicesScriptSave')}<//>
            <${Note} inline>Ctrl+S<//>
            ${msg ? html`<${Note} kind="message" error=${!msg.ok}>${msg.text}<//>` : null}
          <//>
        <//>` : null}
    <//>
  `;
}

export { ActionScriptEditor };
