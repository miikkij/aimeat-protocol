/**
 * @file public/views/admin/cors-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard CORS tab — shows the node-default allowed origins and lets
 *   the operator add/edit/clear per-GHII and per-agent CORS allow-list overrides.
 *
 * @structure
 *   - OriginSuggestions: quick-add buttons for common origins (localhost ports, wildcard)
 *   - InlineEditor: edit an existing override's comma-separated origin list
 *   - AddOverrideForm: pick a GHII/agent and assign an origin allow-list
 *   - CorsTab (default): composes node-default + GHII + agent override cards, wires save/clear to admin service
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { clearGhiiCors, clearAgentCors, setGhiiCors, setAgentCors } from '/js/services/admin.js';

const COMMON_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8080',
  'https://yourdomain.com',
  '*',
];

/** Suggestion buttons that append an origin to an input value */
function OriginSuggestions({ value, onChange }) {
  function add(origin) {
    const parts = value ? value.split(',').map(s => s.trim()).filter(Boolean) : [];
    if (!parts.includes(origin)) { parts.push(origin); }
    onChange(parts.join(', '));
  }
  return html`
    <div class="adm-flex-wrap adm-mt-sm" style="gap:.35rem;align-items:center">
      <span class="adm-text-sm adm-text-dim">${t('dashboard.corsCommonOrigins')}</span>
      ${COMMON_ORIGINS.map(o => html`
        <button type="button" class="adm-btn-sm" style="font-size:.75rem;padding:2px 8px"
          onClick=${() => add(o)}>${o}</button>
      `)}
    </div>
  `;
}

/** Inline editor row for existing CORS overrides */
function InlineEditor({ origins, onSave, onCancel }) {
  const [val, setVal] = useState(origins.join(', '));
  function save() {
    const arr = val.split(',').map(s => s.trim()).filter(Boolean);
    if (arr.length === 0) return;
    onSave(arr);
  }
  return html`
    <div class="adm-flex-col" style="gap:.4rem;padding:.5rem 0">
      <input class="adm-input adm-input-full" type="text" value=${val} onInput=${e => setVal(e.target.value)}
        placeholder=${t('dashboard.corsOriginPlaceholder')}
        style="font-family:monospace" />
      <${OriginSuggestions} value=${val} onChange=${setVal} />
      <div class="adm-flex" style="gap:.4rem;margin-top:.25rem">
        <button class="adm-btn-action" onClick=${save}>${t('dashboard.corsSave')}</button>
        <button class="adm-btn-sm" onClick=${onCancel}>${t('dashboard.corsCancel')}</button>
      </div>
    </div>
  `;
}

/** Add-override form for GHII or Agent */
function AddOverrideForm({ items, labelKey, idKey, nameKey, onSave }) {
  const [selectedId, setSelectedId] = useState('');
  const [origins, setOrigins] = useState('');

  async function save() {
    if (!selectedId || !origins.trim()) return;
    const arr = origins.split(',').map(s => s.trim()).filter(Boolean);
    if (arr.length === 0) return;
    await onSave(selectedId, arr);
    setSelectedId('');
    setOrigins('');
  }

  return html`
    <div style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--glass-border)">
      <h3 style="font-size:.9rem;margin-bottom:.5rem">${t('dashboard.corsAddOverride')}</h3>
      <div class="adm-flex-col" style="gap:.4rem">
        <select class="adm-input" value=${selectedId} onChange=${e => setSelectedId(e.target.value)}>
          <option value="">${t(labelKey)}</option>
          ${items.map(it => html`
            <option value=${it[idKey]}>${escHtml(it[nameKey] || it[idKey])}</option>
          `)}
        </select>
        <input class="adm-input adm-input-full" type="text" value=${origins} onInput=${e => setOrigins(e.target.value)}
          placeholder=${t('dashboard.corsOriginPlaceholder')}
          style="font-family:monospace" />
        <${OriginSuggestions} value=${origins} onChange=${setOrigins} />
        <div style="margin-top:.25rem">
          <button class="adm-btn-action" onClick=${save}>${t('dashboard.corsSave')}</button>
        </div>
      </div>
    </div>
  `;
}

export default function CorsTab({ data, reload }) {
  const configSchema = data.configSchema;
  const nodeOrigins = configSchema?.schema?.['cors.allowedOrigins']?.value
    || data.dash?.cors_allowed_origins || null;

  // GHII overrides
  const ghiiRows = (data.ghiiUsers || []).filter(u => u.allowed_origins?.length > 0);
  // Agent overrides
  const agentRows = (data.agents?.agents || []).filter(a => a.allowed_origins?.length > 0);

  // Track which row is being edited
  const [editGhii, setEditGhii] = useState(null);
  const [editAgent, setEditAgent] = useState(null);
  const [toast, showErr, , clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();

  async function doClearGhii(ghii) {
    confirm(t('dashboard.corsClearConfirm'), async () => {
      try {
        await clearGhiiCors(ghii);
        reload();
      } catch (e) { showErr(e.message); }
    }, { danger: true });
  }

  async function doClearAgent(gaii) {
    confirm(t('dashboard.corsClearConfirm'), async () => {
      try {
        await clearAgentCors(gaii);
        reload();
      } catch (e) { showErr(e.message); }
    }, { danger: true });
  }

  async function doSaveGhii(ghii, origins) {
    try {
      await setGhiiCors(ghii, origins);
      setEditGhii(null);
      reload();
    } catch (e) { showErr(e.message); }
  }

  async function doSaveAgent(gaii, origins) {
    try {
      await setAgentCors(gaii, origins);
      setEditAgent(null);
      reload();
    } catch (e) { showErr(e.message); }
  }

  // All GHII users (for add-override dropdown), excluding those already overridden
  const ghiiOverriddenSet = new Set(ghiiRows.map(r => r.ghii));
  const ghiiAvailable = (data.ghiiUsers || []).filter(u => !ghiiOverriddenSet.has(u.ghii));

  // All agents (for add-override dropdown), excluding those already overridden
  const agentOverriddenSet = new Set(agentRows.map(a => a.gaii));
  const agentAvailable = (data.agents?.agents || []).filter(a => !agentOverriddenSet.has(a.gaii));

  return html`
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <!-- Node default -->
    <div class="adm-card">
      <h2>${t('dashboard.corsNodeDefault')}</h2>
      <p class="adm-text-dim adm-text-base" style="margin-bottom:.75rem">${t('dashboard.corsNodeDefaultDesc')}</p>
      <code style="font-size:.85rem">${nodeOrigins ? escHtml(Array.isArray(nodeOrigins) ? nodeOrigins.join(', ') : String(nodeOrigins)) : '*'}</code>
    </div>

    <!-- GHII overrides -->
    <div class="adm-card">
      <h2>${t('dashboard.corsGhiiOverrides')}</h2>
      <p class="adm-text-dim adm-text-base" style="margin-bottom:.75rem">${t('dashboard.corsGhiiOverridesDesc')}</p>
      ${ghiiRows.length === 0
        ? html`<div class="adm-text-dim adm-text-base">${t('dashboard.corsNoOverrides')}</div>`
        : html`<table>
          <thead><tr><th>${t('dashboard.owner')}</th><th>${t('dashboard.corsOrigins')}</th><th></th></tr></thead>
          <tbody>
            ${ghiiRows.map(r => html`<tr>
              <td>${escHtml(r.owner_name || r.ghii)}</td>
              <td style="width:100%">
                ${editGhii === r.ghii
                  ? html`<${InlineEditor}
                      origins=${r.allowed_origins}
                      onSave=${(arr) => doSaveGhii(r.ghii, arr)}
                      onCancel=${() => setEditGhii(null)} />`
                  : html`<span class="mono adm-text-sm">${escHtml(r.allowed_origins.join(', '))}</span>`
                }
              </td>
              <td style="white-space:nowrap">
                ${editGhii !== r.ghii && html`<span style="display:inline-flex;gap:.3rem">
                  <button class="adm-btn-sm" onClick=${() => setEditGhii(r.ghii)}>${t('dashboard.corsEdit')}</button>
                  <button class="adm-btn-sm" onClick=${() => doClearGhii(r.ghii)}>${t('dashboard.corsClear')}</button>
                </span>`}
              </td>
            </tr>`)}
          </tbody>
        </table>`
      }
      <${AddOverrideForm}
        items=${ghiiAvailable}
        labelKey="dashboard.corsSelectUser"
        idKey="ghii"
        nameKey="owner_name"
        onSave=${(ghii, origins) => doSaveGhii(ghii, origins)} />
    </div>

    <!-- Agent overrides -->
    <div class="adm-card">
      <h2>${t('dashboard.corsAgentOverrides')}</h2>
      <p class="adm-text-dim adm-text-base" style="margin-bottom:.75rem">${t('dashboard.corsAgentOverridesDesc')}</p>
      ${agentRows.length === 0
        ? html`<div class="adm-text-dim adm-text-base">${t('dashboard.corsNoOverrides')}</div>`
        : html`<table>
          <thead><tr><th>GAII</th><th>${t('dashboard.owner')}</th><th>${t('dashboard.corsOrigins')}</th><th></th></tr></thead>
          <tbody>
            ${agentRows.map(a => html`<tr>
              <td class="mono adm-text-sm">${escHtml(a.gaii)}</td>
              <td>${escHtml(a.owner)}</td>
              <td style="width:100%">
                ${editAgent === a.gaii
                  ? html`<${InlineEditor}
                      origins=${a.allowed_origins}
                      onSave=${(arr) => doSaveAgent(a.gaii, arr)}
                      onCancel=${() => setEditAgent(null)} />`
                  : html`<span class="mono adm-text-sm">${escHtml(a.allowed_origins.join(', '))}</span>`
                }
              </td>
              <td style="white-space:nowrap">
                ${editAgent !== a.gaii && html`<span style="display:inline-flex;gap:.3rem">
                  <button class="adm-btn-sm" onClick=${() => setEditAgent(a.gaii)}>${t('dashboard.corsEdit')}</button>
                  <button class="adm-btn-sm" onClick=${() => doClearAgent(a.gaii)}>${t('dashboard.corsClear')}</button>
                </span>`}
              </td>
            </tr>`)}
          </tbody>
        </table>`
      }
      <${AddOverrideForm}
        items=${agentAvailable}
        labelKey="dashboard.corsSelectAgent"
        idKey="gaii"
        nameKey="name"
        onSave=${(gaii, origins) => doSaveAgent(gaii, origins)} />
    </div>
    <${ConfirmUI} />
  `;
}
