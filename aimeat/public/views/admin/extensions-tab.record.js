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

  return html`
    <div class="adm-ex-panel">
      <div class="adm-ex-lbl">${X('inst.title')}</div>
      ${loading && html`<p class="adm-ex-hint">${t('dashboard.loading')}</p>`}
      ${!loading && list.length === 0 && html`<p class="adm-ex-hint">${X('inst.none')}</p>`}
      ${list.map(inst => html`
        <div class="adm-ex-frow">
          <b>${inst.id}</b>
          <span class="adm-ex-box-row" style="border:0;padding:0">
            <em>${inst.status === 'active' ? X('inst.running') : X('inst.paused')}<small>${X('inst.madeBy', { who: inst.createdBy || inst.created_by || '—', when: dt(inst.createdAt || inst.created_at) })}</small></em>
            <span>
              ${schema && html`<button type="button" class="og-door og-door--quiet"
                onClick=${() => { setEditCfg(editCfg === inst.id ? null : inst.id); setCfgData({ ...(inst.config || {}) }); }}>${X('inst.config')}</button>`}
              <button type="button" class="og-door og-door--quiet" onClick=${() => setEditTl(editTl === inst.id ? null : inst.id)}>${X('inst.words')}</button>
              <button type="button" class="og-door og-door--quiet" onClick=${() => toggle(inst)}>${inst.status === 'active' ? X('inst.pause') : X('inst.start')}</button>
              <button type="button" class="og-door og-door--quiet og-door--danger" onClick=${() => remove(inst)}>${X('inst.remove')}</button>
            </span>
          </span>
        </div>
        ${editCfg === inst.id && html`<div class="adm-ex-panel">
          <${ConfigForm} schema=${schema} config=${cfgData} onChange=${setCfgData} />
          <div class="adm-ex-acts" style="border-top:0;padding-top:12px">
            <button class="adm-btn" onClick=${() => saveConfig(inst)}>${X('inst.save')}</button>
            <button type="button" class="og-door og-door--quiet" onClick=${() => setEditCfg(null)}>${X('inst.cancel')}</button>
          </div>
        </div>`}
        ${editTl === inst.id && html`<${TranslationEditor} extName=${ext.name} inst=${inst} onSave=${saveTranslations} />`}`)}

      <div class="adm-ex-acts" style="border-top:0">
        <div class="og-field" style="max-width:260px">
          <label class="og-label" for=${'ex-inst-' + ext.name}>${X('inst.newId')}</label>
          <input id=${'ex-inst-' + ext.name} class="og-input" type="text" value=${newId}
            placeholder="my-instance-01" onInput=${e => setNewId(e.target.value)} />
        </div>
        <button class="adm-btn" onClick=${create} disabled=${!newId.trim()}>${X('inst.create')}</button>
        <p>${X('inst.createWhy')}</p>
      </div>
      ${schema && newId.trim() && html`<${ConfigForm} schema=${schema} config=${newConfig} onChange=${setNewConfig} />`}
      <${ConfirmUI} />
    </div>`;
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

  return html`
    <div class="adm-ex-rec">
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <div class="adm-ex-rec-h">
        <div>
          <h3>${ext.name}</h3>
          <span class="adm-ex-rec-sub">${ext.description || X('noDescription')}</span>
          <div class="adm-ex-rec-chips">
            <span class=${active ? 'is-live' : 'is-off'}>${active ? X('active') : X('switchedOff')}</span>
            <span>${ext.version || '—'}</span>
            ${ext.author && html`<span>${X('by', { who: ext.author })}</span>`}
            <span class=${ext.federation?.enabled ? '' : 'is-off'}>${ext.federation?.enabled ? X('federating') : X('notFederating')}</span>
            ${ext.instances && html`<span>${X('supportsInstances')}</span>`}
          </div>
        </div>
        <button type="button" class="og-door og-door--quiet" onClick=${onClose}>${X('close')} ↩</button>
      </div>

      <div class="adm-ex-grid">
        <div>
          <div class="adm-ex-lbl">${X('actionsTitle', { n: num((ext.actions || []).length) })}</div>
          ${(ext.actions || []).map(a => html`
            <div class="adm-ex-act">
              <i>${a.method || 'POST'}</i>
              <code>/v1/ext/${ext.name}/${a.id}</code>
              <em>${a.id}</em>
            </div>`)}
          ${(ext.actions || []).length === 0 && html`<p class="adm-ex-hint">${X('noActions')}</p>`}

          <div class="adm-ex-lbl adm-ex-lbl--gap">${X('installedTitle')}</div>
          <div class="adm-ex-frow"><b>${X('f.when')}</b><span>${shortDate(ext.installedAt)}<small>${
  active ? X('f.activatedAt', { when: shortDate(ext.activatedAt) }) : X('f.notActive')}</small></span></div>
          <div class="adm-ex-frow"><b>${X('f.by')}</b><span>${who}<small>${who === ext.installedBy ? '' : (ext.installedBy || '')}</small></span></div>
          <div class="adm-ex-frow"><b>${X('f.asks')}</b><span>${asks.length ? asks.join(', ') : X('f.asksNone')}<small>${X('f.asksWhy')}</small></span></div>
          <div class="adm-ex-frow"><b>${X('f.storage')}</b><span>ext:${ext.name}<small>${X('f.storageWhy')}</small></span></div>
          ${schedules.length > 0 && html`
            <div class="adm-ex-frow"><b>${X('f.clock')}</b><span>${schedules.map(s => s.cron).join(', ')}<small>${
  X('f.clockWhy', { actions: schedules.map(s => s.action).join(', ') })}</small></span></div>`}
        </div>

        <div>
          <div class="adm-ex-lbl">${X('calledByTitle')}</div>
          <div class="adm-ex-box">
            ${callers.map(c => html`<div class="adm-ex-box-row"><em>${c.name}</em><span>${c.kind}</span></div>`)}
            ${callers.length === 0 && html`<div class="adm-ex-box-row"><em>${X('calledByNothing')}</em><span>—</span></div>`}
          </div>
          <p class="adm-ex-hint">${callers.length ? X('calledByWhy') : X('calledByNothingWhy')}</p>
        </div>
      </div>

      ${(ext.actions || []).length > 0 && html`
        <div class="adm-ex-panel">
          <button type="button" class="og-door og-door--quiet" onClick=${() => setScripts(!scripts)}>
            ${scripts ? X('hideScripts') : X('showScripts')}
          </button>
          ${scripts && html`<${ActionScriptEditor} extName=${ext.name} actions=${ext.actions || []} />`}
        </div>`}

      ${ext.instances && html`<${Instances} ext=${ext} schema=${schema} onError=${showErr} />`}

      <div class="adm-ex-acts">
        <button class="adm-btn" onClick=${() => setActive(!active)} disabled=${busy}>
          ${active ? X('switchOff') : X('switchOn')}
        </button>
        <button type="button" class="og-door og-door--quiet" onClick=${reinstall} disabled=${busy}>${X('reinstall')}</button>
        <button type="button" class="og-door og-door--quiet og-door--danger" onClick=${() => onUninstall(ext)}>${X('uninstall')}</button>
        <p>${active ? X('switchOffWhy') : X('switchOnWhy')}</p>
      </div>
    </div>`;
}
