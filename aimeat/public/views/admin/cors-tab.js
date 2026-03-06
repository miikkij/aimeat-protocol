import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Empty } from './shared.js';
import { clearGhiiCors, clearAgentCors } from '/js/services/admin.js';

export default function CorsTab({ data, reload }) {
  const configSchema = data.configSchema;
  const nodeOrigins = configSchema?.schema?.['cors.allowedOrigins']?.value
    || data.dash?.cors_allowed_origins || null;

  // GHII overrides
  const ghiiRows = (data.ghiiUsers || []).filter(u => u.allowed_origins?.length > 0);
  // Agent overrides
  const agentRows = (data.agents?.agents || []).filter(a => a.allowed_origins?.length > 0);

  async function doClearGhii(ghii) {
    if (!confirm(t('dashboard.corsClearConfirm'))) return;
    try {
      await clearGhiiCors(ghii);
      reload();
    } catch (e) { alert(t('dashboard.errorLabel') + ': ' + e.message); }
  }

  async function doClearAgent(gaii) {
    if (!confirm(t('dashboard.corsClearConfirm'))) return;
    try {
      await clearAgentCors(gaii);
      reload();
    } catch (e) { alert(t('dashboard.errorLabel') + ': ' + e.message); }
  }

  return html`
    <!-- Node default -->
    <div class="adm-card">
      <h2>${t('dashboard.corsNodeDefault')}</h2>
      <p style="color:var(--text-dim);font-size:.85rem;margin-bottom:.75rem">${t('dashboard.corsNodeDefaultDesc')}</p>
      <code style="font-size:.85rem">${nodeOrigins ? escHtml(Array.isArray(nodeOrigins) ? nodeOrigins.join(', ') : String(nodeOrigins)) : '*'}</code>
    </div>

    <!-- GHII overrides -->
    <div class="adm-card">
      <h2>${t('dashboard.corsGhiiOverrides')}</h2>
      <p style="color:var(--text-dim);font-size:.85rem;margin-bottom:.75rem">${t('dashboard.corsGhiiOverridesDesc')}</p>
      ${ghiiRows.length === 0
        ? html`<div style="color:var(--text-dim);font-size:.85rem">${t('dashboard.corsNoOverrides')}</div>`
        : html`<table>
          <thead><tr><th>${t('dashboard.owner')}</th><th>${t('dashboard.corsOrigins')}</th><th></th></tr></thead>
          <tbody>
            ${ghiiRows.map(r => html`<tr>
              <td>${escHtml(r.owner_name || r.ghii)}</td>
              <td class="mono" style="font-size:.8rem">${escHtml(r.allowed_origins.join(', '))}</td>
              <td><button class="adm-btn-sm" onClick=${() => doClearGhii(r.ghii)}>${t('dashboard.corsClear')}</button></td>
            </tr>`)}
          </tbody>
        </table>`
      }
    </div>

    <!-- Agent overrides -->
    <div class="adm-card">
      <h2>${t('dashboard.corsAgentOverrides')}</h2>
      <p style="color:var(--text-dim);font-size:.85rem;margin-bottom:.75rem">${t('dashboard.corsAgentOverridesDesc')}</p>
      ${agentRows.length === 0
        ? html`<div style="color:var(--text-dim);font-size:.85rem">${t('dashboard.corsNoOverrides')}</div>`
        : html`<table>
          <thead><tr><th>GAII</th><th>${t('dashboard.owner')}</th><th>${t('dashboard.corsOrigins')}</th><th></th></tr></thead>
          <tbody>
            ${agentRows.map(a => html`<tr>
              <td class="mono" style="font-size:.8rem">${escHtml(a.gaii)}</td>
              <td>${escHtml(a.owner)}</td>
              <td class="mono" style="font-size:.8rem">${escHtml(a.allowed_origins.join(', '))}</td>
              <td><button class="adm-btn-sm" onClick=${() => doClearAgent(a.gaii)}>${t('dashboard.corsClear')}</button></td>
            </tr>`)}
          </tbody>
        </table>`
      }
    </div>
  `;
}
