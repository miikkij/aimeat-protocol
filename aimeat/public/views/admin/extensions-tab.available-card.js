/**
 * @file public/views/admin/extensions-tab.available-card.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Available (bundled) extension card with disk-script editor + add-action for the admin Extensions tab. Extracted from the tab file to satisfy max-file-lines.
 * @version-history
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set: the card is a shared box, the
 *     editor's choices are tabs, its fields shared fields; every inline style is gone.
 *   v1.2.0 — 2026-09-12 — The action count is one translated string with the number in it. Gluing
 *     a number to a lowercased noun read as "7 toiminnot" in Finnish, which no Finnish says.
 *   v1.1.0 — 2026-09-05 — The script-editor button loses its emoji: no emoji anywhere in the interface.
 *   v1.0.0 — 2026-07-13 — Extracted from the tab file (max-file-lines)
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { useConfirm } from '/components/Modal.js';
import { getDiskScript, saveDiskScript, addDiskAction } from '/js/services/admin.js';
import { Surface, ListRow, Stack, Field, Action, Text } from '/components/poster-parts.js';
import { scriptKeys } from './extensions-tab.action-editor.js';

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

  return html`<${Surface} kind="box">
    <${Stack}>
      <${ListRow} density="compact" name=${escHtml(ext.name)} value=${html`<${Text} kind="mono" tone="muted">v${escHtml(ext.version)}<//>`} />
      <${Text} tone="muted">${escHtml(ext.description)}<//>
      <${Stack} direction="wrap" density="compact">
        <${Text} kind="caption" tone="muted">${t('dashboard.servicesApis')}: ${ext.requiredApis.join(', ')}<//>
        <${Text} kind="caption" tone=${ext.instancesSupported ? 'success' : 'muted'}>
          ${ext.instancesSupported ? t('dashboard.servicesMultiInstance') : t('dashboard.servicesSingleInstance')}<//>
        <${Text} kind="caption" tone="muted">${t('admin.ext.actionsCount', { n: actions.length })}<//>
      <//>
      <${Stack} direction="wrap" align="center">
        ${isInstalled
          ? html`<${Action} disabled=${isInstalling} onClick=${handleReinstall}>
              ${isInstalling ? '...' : t('dashboard.servicesReinstall')}<//>
            <${Text} kind="caption" tone="muted">${t('dashboard.servicesInstalled')}<//>`
          : html`<${Action} disabled=${isInstalling} onClick=${() => onInstall(ext.name)}>
              ${isInstalling ? t('dashboard.servicesInstalling') : t('dashboard.servicesInstall')}<//>`}
        <${Action} kind="tab" selected=${showEditor} onClick=${() => setShowEditor(!showEditor)}>
          ${t('dashboard.servicesScriptEditor')}<//>
        ${msg && html`<${Text} kind="caption" tone=${msg.ok ? 'success' : 'danger'}>${msg.text}<//>`}
      <//>

      ${showEditor && html`<${Stack}>
        <${Stack} direction="wrap" align="center" density="compact">
          <${Text} kind="label">${t('dashboard.servicesScriptEditor')}<//>
          ${actions.map(a => html`<${Action} key=${a.id} kind="tab" selected=${selectedAction === a.id}
            onClick=${() => loadScript(a.id)}>${a.method} ${escHtml(a.id)}<//>`)}
          <${Action} kind="tab" selected=${showAddAction} onClick=${() => setShowAddAction(!showAddAction)}>
            + ${t('dashboard.servicesAddAction')}<//>
        <//>

        ${showAddAction && html`<${Stack}>
          <${Field} label="ID" value=${newActionId} onInput=${e => setNewActionId(e.target.value)} placeholder="my-action" />
          <${Field} type="select" label="Method" value=${newActionMethod} onChange=${e => setNewActionMethod(e.target.value)}
            options=${['POST', 'GET', 'PUT', 'DELETE'].map(m => ({ value: m, label: m }))} />
          <${Field} label=${t('dashboard.servicesScaffoldDescLabel')} value=${newActionDesc}
            onInput=${e => setNewActionDesc(e.target.value)} placeholder="What does this action do?" />
          <${Action} onClick=${handleAddAction} disabled=${adding || !newActionId.trim()}>
            ${adding ? '...' : t('dashboard.servicesAddAction')}<//>
        <//>`}

        ${loading && html`<${Text} kind="caption" tone="muted">${t('dashboard.loading')}...<//>`}

        ${selectedAction && !loading && html`<${Stack} density="compact">
          <${Text} kind="mono" tone="muted">${ext.name}/actions/${selectedAction}.js<//>
          <${Field} type="textarea" rows=${16} ariaLabel=${`${ext.name}/actions/${selectedAction}.js`} value=${script}
            spellCheck=${false} onInput=${e => setScript(e.target.value)} onKeyDown=${scriptKeys(setScript, handleSave)} />
          <${Stack} direction="wrap" align="center">
            <${Action} onClick=${handleSave} disabled=${saving}>${saving ? '...' : t('dashboard.servicesScriptSave')}<//>
            <${Text} kind="mono" tone="muted">Ctrl+S<//>
          <//>
        <//>`}

        ${actions.length === 0 && !showAddAction && html`<${Text} kind="caption" tone="muted">${t('dashboard.servicesNoActions')}<//>`}
      <//>`}
    <//>
    <${ConfirmUI} />
  <//>`;
}

export { AvailableExtCard };
