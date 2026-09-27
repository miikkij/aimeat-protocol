/**
 * @file public/views/admin/extensions-tab.scaffold-form.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The form that writes a new extension: a name, a description, the parts of ctx it
 *   asks for, and whether it runs as several configured copies. It creates the manifest and one
 *   empty action, switched off, which is what section 04 of the Extensions page promises.
 * @version-history
 *   v3.0.0 — 2026-09-27 — The Field family (admin page group G7): two TextFields in Fields, the ctx
 *     parts a row of filter Tabs where each is its own on or off (aria-pressed, as before) with the
 *     multi-instance switch as one more tab in the row, the create the Loud action, the answer the
 *     form message. No class.
 *   v2.0.0 — 2026-09-12 — The poster face: og-field labels, one ink slab, the ctx parts as square
 *     chips instead of four checkboxes in a row of inline styles. Same call, same result.
 *   v1.0.0 — 2026-07-13 — Extracted from the tab file (max-file-lines)
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { scaffoldExtension } from '/js/services/admin.js';
import { Field, Fields, FormActions } from '/components/Field.js';
import { TextField } from '/components/TextField.js';
import { Tabs, Tab } from '/components/Tabs.js';
import { Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';

const X = (key, params) => t('admin.ext.' + key, params);

/** The parts of ctx a scaffolded extension can declare. The sandbox hands it nothing else. */
const CTX_PARTS = ['memory', 'wallet', 'consent', 'trust'];

function ScaffoldForm({ onCreated }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [multiInstance, setMultiInstance] = useState(true);
  const [apis, setApis] = useState(['memory', 'wallet']);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState(null);

  function toggleApi(api) {
    setApis(prev => prev.includes(api) ? prev.filter(a => a !== api) : [...prev, api]);
  }

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true); setMsg(null);
    try {
      await scaffoldExtension({ name: name.trim(), description: description.trim(), multiInstance, apis });
      setMsg({ ok: true, text: t('dashboard.servicesScaffoldDone') });
      setName(''); setDescription('');
      if (onCreated) onCreated();
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    setCreating(false);
  }

  return html`
    <${Fields}>
      <${TextField} id="adm-ex-new-name" label=${t('dashboard.servicesName')} value=${name}
        placeholder=${X('write.namePlaceholder')} onInput=${setName} />
      <${TextField} id="adm-ex-new-desc" label=${t('dashboard.servicesScaffoldDescLabel')} value=${description}
        placeholder=${X('write.descPlaceholder')} onInput=${setDescription} />
      <${Field} label=${X('write.apis')} group>
        <${Tabs} tone="filter" kind="toggle" value=${apis} onSelect=${toggleApi}
          items=${CTX_PARTS.map(api => ({ value: api, label: api }))}>
          <${Tab} tone="filter" on=${multiInstance} pressed=${multiInstance}
            onClick=${() => setMultiInstance(v => !v)}>${t('dashboard.servicesMultiInstance')}<//>
        <//>
      <//>
      <${FormActions}>
        <${Loud} control onClick=${handleCreate} disabled=${creating || !name.trim()}>
          ${creating ? '…' : t('dashboard.servicesScaffoldBtn')}<//>
        ${msg ? html`<${Note} kind="message" error=${!msg.ok}>${msg.text}<//>` : null}
      <//>
    <//>`;
}

export { ScaffoldForm };
export default ScaffoldForm;
