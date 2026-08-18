/**
 * @file public/views/admin/services-tab.scaffold-form.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description New-extension scaffold form for the admin Services tab. Extracted from services-tab.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from services-tab.js (max-file-lines)
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { scaffoldExtension } from '/js/services/admin.js';
import { inputStyle, labelStyle, fieldWrap } from './services-tab.config-form.js';

// ── Extension Scaffold Form ──
function ScaffoldForm({ onCreated }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [multiInstance, setMultiInstance] = useState(true);
  const [apis, setApis] = useState(['memory', 'wallet']);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState(null);

  const allApis = ['memory', 'wallet', 'consent', 'trust'];

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
    <div class="adm-card" style="padding:16px;margin-bottom:16px">
      <h3 style="margin:0 0 12px;font-size:1rem">${t('dashboard.servicesScaffoldTitle')}</h3>
      <p class="adm-text-dim adm-text-base adm-mb-md" style="margin:0">${t('dashboard.servicesScaffoldDesc')}</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div style=${fieldWrap}>
          <label class="${labelStyle}">${t('dashboard.servicesName')}</label>
          <input type="text" value=${name} onInput=${e => setName(e.target.value)}
            class="${inputStyle}" style="width:220px" placeholder="my-service" />
        </div>
        <div style=${fieldWrap + ';flex:1;min-width:200px'}>
          <label class="${labelStyle}">${t('dashboard.servicesScaffoldDescLabel')}</label>
          <input type="text" value=${description} onInput=${e => setDescription(e.target.value)}
            class="${inputStyle}" placeholder="What does this extension do?" />
        </div>
      </div>
      <div style="display:flex;gap:12px;align-items:center;margin-top:10px;flex-wrap:wrap">
        <div style="display:flex;gap:6px;align-items:center">
          <label style="font-size:.8rem;color:var(--text-dim)">APIs:</label>
          ${allApis.map(api => html`
            <label style="display:flex;align-items:center;gap:3px;font-size:.8rem;cursor:pointer;color:${apis.includes(api) ? 'var(--text-bright)' : 'var(--text-dim)'}">
              <input type="checkbox" checked=${apis.includes(api)} onChange=${() => toggleApi(api)} />
              ${api}
            </label>
          `)}
        </div>
        <label style="display:flex;align-items:center;gap:4px;font-size:.8rem;cursor:pointer;color:var(--text-dim)">
          <input type="checkbox" checked=${multiInstance} onChange=${e => setMultiInstance(e.target.checked)} />
          ${t('dashboard.servicesMultiInstance')}
        </label>
      </div>
      <div class="adm-flex-center adm-mt-md">
        <button class="adm-btn-action" onClick=${handleCreate} disabled=${creating || !name.trim()}>
          ${creating ? '...' : t('dashboard.servicesScaffoldBtn')}</button>
        ${msg && html`<span class="adm-text-base" style="color:${msg.ok ? '#22c55e' : '#ef4444'}">${msg.text}</span>`}
      </div>
    </div>
  `;
}

export { ScaffoldForm };
