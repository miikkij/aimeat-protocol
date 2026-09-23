/**
 * @file public/views/admin/extensions-tab.scaffold-form.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The form that writes a new extension: a name, a description, the parts of ctx it
 *   asks for, and whether it runs as several configured copies. It creates the manifest and one
 *   empty action, switched off, which is what section 04 of the Extensions page promises.
 * @version-history
 *   v3.0.0 -- 2026-09-22 -- Composed from the shared component set: fields, the ctx parts as tab
 *     toggles, and the one loud action. No classes of its own are left.
 *   v2.0.0 — 2026-09-12 — The poster face: og-field labels, one ink slab, the ctx parts as square
 *     chips instead of four checkboxes in a row of inline styles. Same call, same result.
 *   v1.0.0 — 2026-07-13 — Extracted from the tab file (max-file-lines)
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Stack, Field, Action, Text } from '/components/poster-parts.js';
import { scaffoldExtension } from '/js/services/admin.js';

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

  return html`<${Stack}>
    <${Field} label=${t('dashboard.servicesName')} value=${name}
      placeholder=${X('write.namePlaceholder')} onInput=${e => setName(e.target.value)} />
    <${Field} label=${t('dashboard.servicesScaffoldDescLabel')} value=${description}
      placeholder=${X('write.descPlaceholder')} onInput=${e => setDescription(e.target.value)} />

    <${Stack} density="compact">
      <${Text} kind="label">${X('write.apis')}<//>
      <${Stack} direction="wrap" density="compact">
        ${CTX_PARTS.map(api => html`<${Action} key=${api} kind="tab" selected=${apis.includes(api)}
          onClick=${() => toggleApi(api)}>${api}<//>`)}
        <${Action} kind="tab" selected=${multiInstance}
          onClick=${() => setMultiInstance(v => !v)}>${t('dashboard.servicesMultiInstance')}<//>
      <//>
    <//>

    <${Stack} direction="wrap" align="center">
      <${Action} kind="primary" onClick=${handleCreate} disabled=${creating || !name.trim()}>
        ${creating ? '…' : t('dashboard.servicesScaffoldBtn')}<//>
      ${msg && html`<${Text} tone=${msg.ok ? 'success' : 'danger'}>${msg.text}<//>`}
    <//>
  <//>`;
}

export { ScaffoldForm };
export default ScaffoldForm;
