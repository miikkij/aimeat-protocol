/**
 * @file public/views/admin/extensions-tab.available-card.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Available (bundled) extension card with disk-script editor + add-action for the admin Extensions tab. Extracted from the tab file to satisfy max-file-lines.
 * @version-history
 *   v2.0.0 — 2026-09-27 — The library's parts (admin page group G7): the card is the Object Box with
 *     the name in its head and the version at its end, the facts a line of meta words (multi-instance
 *     support in the fine tone), the ways Action links, the answer the form message; the disk-script
 *     editor is the dashed field Box with the actions as Tabs, the add-action form Fields and the
 *     script a typewriter TextArea that owns its Tab-indent and its Ctrl+S save. escHtml goes: htm
 *     escapes every value, so the escaped names showed a literal &amp; to anyone whose name had one.
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
import { useConfirm } from '/components/Modal.js';
import { getDiskScript, saveDiskScript, addDiskAction } from '/js/services/admin.js';
import { Box } from '/components/Box.js';
import { Tabs } from '/components/Tabs.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Action, Actions } from '/components/Action.js';
import { Label, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Tinted } from '/components/Figure.js';
import { Row, Stack } from '/components/Layout.js';

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
    <${Box} packed name=${ext.name} end=${html`<${Note} kind="meta" inline mono>v${ext.version}<//>`}>
      <${Note}>${ext.description}<//>
      <${Row} gap="medium" wrap>
        <${Note} kind="meta" inline>${t('dashboard.servicesApis')}: ${ext.requiredApis.join(', ')}<//>
        <${Note} kind="meta" inline>${ext.instancesSupported
          ? html`<${Tinted} tone="fine">${t('dashboard.servicesMultiInstance')}<//>`
          : t('dashboard.servicesSingleInstance')}<//>
        <${Note} kind="meta" inline>${t('admin.ext.actionsCount', { n: actions.length })}<//>
      <//>
      <${Actions}>
        ${isInstalled
          ? html`
            <${Action} small disabled=${isInstalling} onClick=${handleReinstall}>
              ${isInstalling ? '...' : t('dashboard.servicesReinstall')}
            <//>
            <${Note} inline>${t('dashboard.servicesInstalled')}<//>`
          : html`<${Action} small disabled=${isInstalling} onClick=${() => onInstall(ext.name)}>
              ${isInstalling ? t('dashboard.servicesInstalling') : t('dashboard.servicesInstall')}
            <//>`}
        <${Action} small soft pressed=${showEditor} onClick=${() => setShowEditor(!showEditor)}>
          ${t('dashboard.servicesScriptEditor')}
        <//>
        ${msg ? html`<${Note} kind="message" error=${!msg.ok}>${msg.text}<//>` : null}
      <//>

      ${showEditor ? html`
        <${Box} tone="field">
          <${Label} block>${t('dashboard.servicesScriptEditor')}<//>
          <${Tabs} label=${t('dashboard.servicesScriptEditor')} value=${selectedAction} onSelect=${loadScript}
            items=${actions.map(a => ({ value: a.id, label: `${a.method} ${a.id}` }))}>
            <${Action} small soft pressed=${showAddAction} onClick=${() => setShowAddAction(!showAddAction)}>
              + ${t('dashboard.servicesAddAction')}
            <//>
          <//>

          ${showAddAction ? html`
            <${Row} gap="small" wrap align="end">
              <${TextField} size="medium" label="ID" value=${newActionId} onInput=${setNewActionId} placeholder="my-action" />
              <${Select} fit label="Method" value=${newActionMethod} onChange=${setNewActionMethod}
                options=${['POST', 'GET', 'PUT', 'DELETE']} />
              <${TextField} label=${t('dashboard.servicesScaffoldDescLabel')} value=${newActionDesc}
                onInput=${setNewActionDesc} placeholder="What does this action do?" />
              <${Action} small onClick=${handleAddAction} disabled=${adding || !newActionId.trim()}>
                ${adding ? '...' : t('dashboard.servicesAddAction')}<//>
            <//>
          ` : null}

          ${loading ? html`<${Note} kind="loading">${t('dashboard.loading')}...<//>` : null}

          ${selectedAction && !loading ? html`
            <${Stack}>
              <${Code}>${ext.name}/actions/${selectedAction}.js<//>
              <${TextArea} code indent rows=${14} ariaLabel=${`${ext.name}/actions/${selectedAction}.js`}
                value=${script} onInput=${setScript} onSave=${handleSave} />
              <${Row} gap="medium">
                <${Action} small onClick=${handleSave} disabled=${saving}>
                  ${saving ? '...' : t('dashboard.servicesScriptSave')}<//>
                <${Note} inline>Ctrl+S<//>
              <//>
            <//>
          ` : null}

          ${actions.length === 0 && !showAddAction ? html`
            <${Note} kind="quiet">${t('dashboard.servicesNoActions')}<//>
          ` : null}
        <//>
      ` : null}
    <//>
    <${ConfirmUI} />
  `;
}

export { AvailableExtCard };
