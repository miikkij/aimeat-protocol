/**
 * @file public/views/admin/extensions-tab.scaffold-form.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The form that writes a new extension: a name, a description, the parts of ctx it
 *   asks for, and whether it runs as several configured copies. It creates the manifest and one
 *   empty action, switched off, which is what section 04 of the Extensions page promises.
 * @version-history
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
    <div class="adm-ex-new">
      <div class="og-field">
        <label class="og-label" for="adm-ex-new-name">${t('dashboard.servicesName')}</label>
        <input id="adm-ex-new-name" class="og-input" type="text" value=${name}
          placeholder=${X('write.namePlaceholder')} onInput=${e => setName(e.target.value)} />
      </div>
      <div class="og-field">
        <label class="og-label" for="adm-ex-new-desc">${t('dashboard.servicesScaffoldDescLabel')}</label>
        <input id="adm-ex-new-desc" class="og-input" type="text" value=${description}
          placeholder=${X('write.descPlaceholder')} onInput=${e => setDescription(e.target.value)} />
      </div>

      <div class="adm-ex-lbl adm-ex-lbl--gap">${X('write.apis')}</div>
      <div class="adm-ex-chips">
        ${CTX_PARTS.map(api => html`
          <button type="button" class="adm-ex-chip ${apis.includes(api) ? 'on' : ''}"
            aria-pressed=${apis.includes(api) ? 'true' : 'false'} onClick=${() => toggleApi(api)}>${api}</button>`)}
        <button type="button" class="adm-ex-chip ${multiInstance ? 'on' : ''}"
          aria-pressed=${multiInstance ? 'true' : 'false'}
          onClick=${() => setMultiInstance(v => !v)}>${t('dashboard.servicesMultiInstance')}</button>
      </div>

      <div class="adm-ex-new-go">
        <button class="adm-btn" onClick=${handleCreate} disabled=${creating || !name.trim()}>
          ${creating ? '…' : t('dashboard.servicesScaffoldBtn')}</button>
        ${msg && html`<span class=${msg.ok ? 'adm-ex-ok' : 'adm-ex-bad'}>${msg.text}</span>`}
      </div>
    </div>`;
}

export { ScaffoldForm };
export default ScaffoldForm;
