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
 *   - ExtensionRecord({ ext, onClose, onUninstall, onReload }) — the whole record, the List's Panel
 *   - Instances: create, pause, delete, edit config and translations for a multi-instance extension
 *
 * @version-history
 *   v2.0.0 — 2026-09-27 — Every part is a library component that gets data (admin page group G7): the
 *     record is the List's Panel (its title, the close door at its right, its doors at the foot), the
 *     chips Marks, the actions and the callers Lists, the installation facts Facts, the instances a
 *     List whose row opens its editors below it, the new instance a TextField with its Loud action.
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
import { List, Row, Name, Cell, Doors, Panel } from '/components/List.js';
import { Action, Loud } from '/components/Action.js';
import { Mark, Marks, Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Facts } from '/components/Facts.js';
import { Box } from '/components/Box.js';
import { Beside, Split, Stack } from '/components/Layout.js';
import { TextField } from '/components/TextField.js';
import { FormActions } from '/components/Field.js';
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

  /** What an instance's row opens under itself: its config form, its translations, or both. */
  const below = (inst) => {
    const cfg = editCfg === inst.id ? html`
      <${Stack} gap="medium">
        <${ConfigForm} schema=${schema} config=${cfgData} onChange=${setCfgData} />
        <${FormActions}>
          <${Loud} control onClick=${() => saveConfig(inst)}>${X('inst.save')}<//>
          <${Action} small soft onClick=${() => setEditCfg(null)}>${X('inst.cancel')}<//>
        <//>
      <//>` : null;
    const tl = editTl === inst.id ? html`<${TranslationEditor} extName=${ext.name} inst=${inst} onSave=${saveTranslations} />` : null;
    return cfg || tl ? html`${cfg}${tl}` : undefined;
  };

  return html`
    <${Split} above="large">
      <${Label} block>${X('inst.title')}<//>
      <${List} cols="label-words-doors" dense loading=${loading ? t('dashboard.loading') : false} empty=${X('inst.none')}>
        ${list.map(inst => html`
          <${Row} key=${inst.id} below=${below(inst)}>
            <${Cell} code>${inst.id}<//>
            <${Name} meta=${X('inst.madeBy', { who: inst.createdBy || inst.created_by || '—', when: dt(inst.createdAt || inst.created_at) })}>
              ${inst.status === 'active' ? X('inst.running') : X('inst.paused')}<//>
            <${Doors}>
              ${schema ? html`<${Action} small row soft
                onClick=${() => { setEditCfg(editCfg === inst.id ? null : inst.id); setCfgData({ ...(inst.config || {}) }); }}>${X('inst.config')}<//>` : null}
              <${Action} small row soft onClick=${() => setEditTl(editTl === inst.id ? null : inst.id)}>${X('inst.words')}<//>
              <${Action} small row soft onClick=${() => toggle(inst)}>${inst.status === 'active' ? X('inst.pause') : X('inst.start')}<//>
              <${Action} small row soft tone="danger" onClick=${() => remove(inst)}>${X('inst.remove')}<//>
            <//>
          <//>`)}
      <//>

      <${TextField} id=${'ex-inst-' + ext.name} size="medium" label=${X('inst.newId')} value=${newId}
        placeholder="my-instance-01" onInput=${setNewId}
        actions=${html`<${Loud} control onClick=${create} disabled=${!newId.trim()}>${X('inst.create')}<//>`} />
      <${Note}>${X('inst.createWhy')}<//>
      ${schema && newId.trim() ? html`<${ConfigForm} schema=${schema} config=${newConfig} onChange=${setNewConfig} />` : null}
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
  const actions = ext.actions || [];
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

  const calledBy = html`
    <${Label} block>${X('calledByTitle')}<//>
    <${Box}>
      <${List} cols="name-what" keepCols dense>
        ${callers.map(c => html`<${Row} key=${c.kind + c.name}><${Name}>${c.name}<//><${Cell} meta>${c.kind}<//><//>`)}
        ${callers.length === 0 ? html`<${Row}><${Name}>${X('calledByNothing')}<//><${Cell} meta>—<//><//>` : null}
      <//>
    <//>
    <${Note}>${callers.length ? X('calledByWhy') : X('calledByNothingWhy')}<//>`;

  const doors = html`
    <${Loud} control onClick=${() => setActive(!active)} disabled=${busy}>${active ? X('switchOff') : X('switchOn')}<//>
    <${Action} small soft onClick=${reinstall} disabled=${busy}>${X('reinstall')}<//>
    <${Action} small soft tone="danger" onClick=${() => onUninstall(ext)}>${X('uninstall')}<//>
    <${Note} inline>${active ? X('switchOffWhy') : X('switchOnWhy')}<//>`;

  return html`
    <${Panel} title=${ext.name} mark=${html`<${Action} small soft onClick=${onClose}>${X('close')} ↩<//>`} doors=${doors}>
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <${Note}>${ext.description || X('noDescription')}<//>
      <${Marks}>
        <${Mark} tone=${active ? 'fine' : 'dim'}>${active ? X('active') : X('switchedOff')}<//>
        <${Mark}>${ext.version || '—'}<//>
        ${ext.author ? html`<${Mark}>${X('by', { who: ext.author })}<//>` : null}
        <${Mark} tone=${ext.federation?.enabled ? undefined : 'dim'}>${ext.federation?.enabled ? X('federating') : X('notFederating')}<//>
        ${ext.instances ? html`<${Mark}>${X('supportsInstances')}<//>` : null}
      <//>

      <${Beside} narrow above="large" side=${calledBy}>
        <${Label} block>${X('actionsTitle', { n: num(actions.length) })}<//>
        <${List} cols="tag-name-desc" keepCols dense empty=${X('noActions')}>
          ${actions.map(a => html`
            <${Row} key=${a.id}>
              <${Cell} sign>${a.method || 'POST'}<//>
              <${Cell} code>/v1/ext/${ext.name}/${a.id}<//>
              <${Cell} meta clip>${a.id}<//>
            <//>`)}
        <//>

        <${Label} block>${X('installedTitle')}<//>
        <${Facts} rows=${[
          { k: X('f.when'), v: shortDate(ext.installedAt), sub: active ? X('f.activatedAt', { when: shortDate(ext.activatedAt) }) : X('f.notActive') },
          { k: X('f.by'), v: who, sub: who === ext.installedBy ? '' : (ext.installedBy || '') },
          { k: X('f.asks'), v: asks.length ? asks.join(', ') : X('f.asksNone'), sub: X('f.asksWhy') },
          { k: X('f.storage'), v: 'ext:' + ext.name, mono: true, sub: X('f.storageWhy') },
          schedules.length > 0 && { k: X('f.clock'), v: schedules.map(s => s.cron).join(', '), sub: X('f.clockWhy', { actions: schedules.map(s => s.action).join(', ') }) },
        ]} />
      <//>

      ${actions.length > 0 ? html`
        <${Split} above="large">
          <${Action} small soft expanded=${scripts} onClick=${() => setScripts(!scripts)}>
            ${scripts ? X('hideScripts') : X('showScripts')}
          <//>
          ${scripts ? html`<${ActionScriptEditor} extName=${ext.name} actions=${actions} />` : null}
        <//>` : null}

      ${ext.instances ? html`<${Instances} ext=${ext} schema=${schema} onError=${showErr} />` : null}
    <//>`;
}
