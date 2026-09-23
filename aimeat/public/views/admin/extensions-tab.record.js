/**
 * @file public/views/admin/extensions-tab.record.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The record one row of the Extensions list opens into (design canvas "AIMEAT Admin
 *   Extensions"): every action with its method and route, who installed it and when, the outside
 *   hosts it declared, what calls it, and the operator's three moves. The instance panel, the
 *   config form, the translation editor and the action-script editor are the ones that shipped
 *   before; they keep working and lose the card around them.
 *
 * @structure
 *   - ExtensionRecord({ ext, onClose, onUninstall, onReload }) — the whole record
 *   - Instances: create, pause, delete, edit config and translations for a multi-instance extension
 *
 * @version-history
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set: the record surface, chips, the
 *     actions and instances as list rows, the facts as key-value rows, underlined actions.
 *   2026-09-13 -- Compose the shared compact record title.
 *   v1.1.0 -- 2026-09-13 -- Compose the action rule and replace inline instance layout with classes.
 *   v1.0.0 — 2026-09-12 — Initial. What an extension exposes and what calls it were both invisible
 *     before: the list showed a name, a version and a HEALTHY badge that only meant "active".
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, dt, shortDate, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { Surface, Stack, Columns, ListRow, KeyValue, Field, Action, Chip, Text } from '/components/poster-parts.js';
import {
  getExtensionInstances, createExtensionInstance, updateExtensionInstance, deleteExtensionInstance,
  activateExtension, deactivateExtension, reinstallExtension,
} from '/js/services/admin.js';
import { buildDefaults, ConfigForm } from './extensions-tab.config-form.js';
import { TranslationEditor } from './extensions-tab.translation-editor.js';
import { ActionScriptEditor } from './extensions-tab.action-editor.js';

const X = (key, params) => t('admin.ext.' + key, params);

/** The instances of a multi-instance extension: create one, pause it, configure it, remove it. */
function Instances({ ext, schema, onError }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newId, setNewId] = useState('');
  const [newConfig, setNewConfig] = useState(() => buildDefaults(schema));
  const [editCfg, setEditCfg] = useState(null);
  const [cfgData, setCfgData] = useState({});
  const [editTl, setEditTl] = useState(null);
  const { confirm, ConfirmUI } = useConfirm();

  function load() {
    setLoading(true);
    getExtensionInstances(ext.name)
      .then(r => setList(r.data?.instances || []))
      .catch(() => setList([]))
      .finally(() => setLoading(false));
  }
  // One read per opened extension; the name is the only signal that should refetch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [ext.name]);

  async function create() {
    if (!newId.trim()) return;
    const cfg = {};
    for (const [k, v] of Object.entries(newConfig)) if (v !== '' && v != null) cfg[k] = v;
    try {
      await createExtensionInstance(ext.name, { id: newId.trim(), ...(Object.keys(cfg).length ? { config: cfg } : {}) });
      setNewId('');
      setNewConfig(buildDefaults(schema));
      load();
    } catch (e) { onError(e.message); }
  }
  async function toggle(inst) {
    try {
      await updateExtensionInstance(ext.name, inst.id, { status: inst.status === 'active' ? 'paused' : 'active' });
      load();
    } catch (e) { onError(e.message); }
  }
  function remove(inst) {
    confirm(X('inst.removeAsk', { id: inst.id }), async () => {
      try { await deleteExtensionInstance(ext.name, inst.id); load(); } catch (e) { onError(e.message); }
    }, { danger: true });
  }
  async function saveConfig(inst) {
    try { await updateExtensionInstance(ext.name, inst.id, { config: cfgData }); setEditCfg(null); load(); }
    catch (e) { onError(e.message); }
  }
  async function saveTranslations(extName, instId, translations) {
    await updateExtensionInstance(extName, instId, { translations });
    load();
  }

  return html`<${Stack}>
    <${Text} kind="label">${X('inst.title')}<//>
    ${loading && html`<${Text} kind="caption" tone="muted">${t('dashboard.loading')}<//>`}
    ${!loading && list.length === 0 && html`<${Text} kind="caption" tone="muted">${X('inst.none')}<//>`}
    ${list.length > 0 && html`<div>${list.map(inst => html`<${ListRow} key=${inst.id} density="compact" name=${inst.id}
      detail=${X('inst.madeBy', { who: inst.createdBy || inst.created_by || '—', when: dt(inst.createdAt || inst.created_at) })}
      value=${html`<${Chip} tone=${inst.status === 'active' ? 'success' : 'muted'}>${inst.status === 'active' ? X('inst.running') : X('inst.paused')}<//>`}
      actions=${html`
        ${schema && html`<${Action} expanded=${editCfg === inst.id}
          onClick=${() => { setEditCfg(editCfg === inst.id ? null : inst.id); setCfgData({ ...(inst.config || {}) }); }}>${X('inst.config')}<//>`}
        <${Action} expanded=${editTl === inst.id} onClick=${() => setEditTl(editTl === inst.id ? null : inst.id)}>${X('inst.words')}<//>
        <${Action} onClick=${() => toggle(inst)}>${inst.status === 'active' ? X('inst.pause') : X('inst.start')}<//>
        <${Action} tone="danger" onClick=${() => remove(inst)}>${X('inst.remove')}<//>`}>
      ${(editCfg === inst.id || editTl === inst.id) && html`<${Stack}>
        ${editCfg === inst.id && html`<${Stack}>
          <${ConfigForm} schema=${schema} config=${cfgData} onChange=${setCfgData} />
          <${Stack} direction="horizontal" align="center">
            <${Action} onClick=${() => saveConfig(inst)}>${X('inst.save')}<//>
            <${Action} kind="text" onClick=${() => setEditCfg(null)}>${X('inst.cancel')}<//>
          <//>
        <//>`}
        ${editTl === inst.id && html`<${TranslationEditor} extName=${ext.name} inst=${inst} onSave=${saveTranslations} />`}
      <//>`}
    <//>`)}</div>`}

    <${Stack} direction="wrap" align="end">
      <${Field} label=${X('inst.newId')} value=${newId} width="narrow"
        placeholder="my-instance-01" onInput=${e => setNewId(e.target.value)} />
      <${Action} onClick=${create} disabled=${!newId.trim()}>${X('inst.create')}<//>
    <//>
    <${Text} kind="caption" tone="muted">${X('inst.createWhy')}<//>
    ${schema && newId.trim() && html`<${ConfigForm} schema=${schema} config=${newConfig} onChange=${setNewConfig} />`}
    <${ConfirmUI} />
  <//>`;
}

export default function ExtensionRecord({ ext, onClose, onUninstall, onReload }) {
  const [toast, showErr, , clearToast] = useToast();
  const [busy, setBusy] = useState(false);
  const [scripts, setScripts] = useState(false);

  const active = ext.status === 'active';
  const schema = ext.instances?.configSchema || null;
  const asks = (ext.requiredApis || []).filter(Boolean);
  const schedules = ext.schedules || [];
  const uses = ext.used_by || {};
  // An agent's GAII carries the person's name before the #; an owner's GHII is already the name.
  // The full id goes on the small line only when it says something the name did not.
  const who = (ext.installedBy || '—').split('#')[0];
  const callers = [
    ...(uses.app_names || []).map(n => ({ name: n, kind: X('kind.app') })),
    ...(uses.cortex_names || []).map(n => ({ name: n, kind: X('kind.cortex') })),
  ];

  async function setActive(next) {
    setBusy(true);
    try {
      await (next ? activateExtension(ext.name) : deactivateExtension(ext.name));
      onReload();
    } catch (e) { showErr(e.message); }
    setBusy(false);
  }
  async function reinstall() {
    setBusy(true);
    try { await reinstallExtension(ext.name); onReload(); } catch (e) { showErr(e.message); }
    setBusy(false);
  }

  const fact = (label, value, note) => html`<${KeyValue} label=${label}><${Stack} density="compact">
    <span>${value}</span>${note && html`<${Text} kind="caption" tone="muted">${note}<//>`}<//><//>`;

  return html`<${Surface} kind="record">
    <${Stack}>
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <${Stack} direction="wrap" align="between">
        <${Stack} density="compact">
          <${Text} kind="heading" size="small">${ext.name}<//>
          <${Text} tone="muted">${ext.description || X('noDescription')}<//>
          <${Stack} direction="wrap" density="compact">
            <${Chip} tone=${active ? 'success' : 'muted'}>${active ? X('active') : X('switchedOff')}<//>
            <${Chip}>${ext.version || '—'}<//>
            ${ext.author && html`<${Chip}>${X('by', { who: ext.author })}<//>`}
            <${Chip} tone=${ext.federation?.enabled ? 'plain' : 'muted'}>${ext.federation?.enabled ? X('federating') : X('notFederating')}<//>
            ${ext.instances && html`<${Chip}>${X('supportsInstances')}<//>`}
          <//>
        <//>
        <${Action} onClick=${onClose}>${X('close')} ↩<//>
      <//>

      <${Columns} layout="leading" collapse=${900}>
        <${Stack}>
          <${Stack} density="compact">
            <${Text} kind="label">${X('actionsTitle', { n: num((ext.actions || []).length) })}<//>
            ${(ext.actions || []).length > 0 && html`<div>${(ext.actions || []).map(a => html`<${ListRow} key=${a.id} density="compact"
              mark=${html`<${Chip}>${a.method || 'POST'}<//>`} name=${a.id} detail=${`/v1/ext/${ext.name}/${a.id}`} />`)}</div>`}
            ${(ext.actions || []).length === 0 && html`<${Text} kind="caption" tone="muted">${X('noActions')}<//>`}
          <//>

          <${Stack} density="compact">
            <${Text} kind="label">${X('installedTitle')}<//>
            <div>
              ${fact(X('f.when'), shortDate(ext.installedAt), active ? X('f.activatedAt', { when: shortDate(ext.activatedAt) }) : X('f.notActive'))}
              ${fact(X('f.by'), who, who === ext.installedBy ? '' : (ext.installedBy || ''))}
              ${fact(X('f.asks'), asks.length ? asks.join(', ') : X('f.asksNone'), X('f.asksWhy'))}
              ${fact(X('f.storage'), `ext:${ext.name}`, X('f.storageWhy'))}
              ${schedules.length > 0 && fact(X('f.clock'), schedules.map(s => s.cron).join(', '),
                X('f.clockWhy', { actions: schedules.map(s => s.action).join(', ') }))}
            </div>
          <//>
        <//>

        <${Stack} density="compact">
          <${Text} kind="label">${X('calledByTitle')}<//>
          <div>
            ${callers.map(c => html`<${ListRow} key=${c.name} density="compact" name=${c.name} value=${html`<${Text} kind="mono">${c.kind}<//>`} />`)}
            ${callers.length === 0 && html`<${ListRow} density="compact" name=${X('calledByNothing')} value=${html`<${Text} kind="mono">—<//>`} />`}
          </div>
          <${Text} kind="caption" tone="muted">${callers.length ? X('calledByWhy') : X('calledByNothingWhy')}<//>
        <//>
      <//>

      ${(ext.actions || []).length > 0 && html`<${Stack}>
        <${Stack} direction="horizontal">
          <${Action} expanded=${scripts} onClick=${() => setScripts(!scripts)}>
            ${scripts ? X('hideScripts') : X('showScripts')}<//>
        <//>
        ${scripts && html`<${ActionScriptEditor} extName=${ext.name} actions=${ext.actions || []} />`}
      <//>`}

      ${ext.instances && html`<${Instances} ext=${ext} schema=${schema} onError=${showErr} />`}

      <${Stack} direction="wrap" align="center">
        <${Action} kind="primary" onClick=${() => setActive(!active)} disabled=${busy}>
          ${active ? X('switchOff') : X('switchOn')}<//>
        <${Action} onClick=${reinstall} disabled=${busy}>${X('reinstall')}<//>
        <${Action} tone="danger" onClick=${() => onUninstall(ext)}>${X('uninstall')}<//>
      <//>
      <${Text} kind="caption" tone="muted">${active ? X('switchOffWhy') : X('switchOnWhy')}<//>
    <//>
  <//>`;
}
