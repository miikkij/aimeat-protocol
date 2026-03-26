/**
 * @file DiagnosticsPanel.js
 * @description Diagnostics table sub-component — renders a table showing each
 *   component's foundry status, live status, and last action. Pure component
 *   that derives diagnosticsData from its props.
 *
 *   Part of the hook-per-domain architecture.
 *
 * @structure
 *   - DiagnosticsPanel({ components, liveStatuses }): diagnostics table
 * @usage
 *   import { DiagnosticsPanel } from './foundry-dashboard/DiagnosticsPanel.js';
 *   ${showDiagnostics && html`<${DiagnosticsPanel} components=${core.components} liveStatuses=${core.liveStatuses} />`}
 * @version-history
 *   v1.0.0 — 2026-03-22 — Extracted from foundry-tab.js ProjectDashboard
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

export function DiagnosticsPanel({ components, liveStatuses }) {
  const data = components.map(c => {
    const live = liveStatuses[c.id] || {};
    return {
      id: c.id, label: c.label, type: c.type,
      foundryStatus: c.status,
      registeredAs: c.registeredAs,
      liveStatus: live.status || 'unknown',
      active: live.active || false,
      installed: live.installed || false,
      lastAction: (c.history || []).slice(-1)[0] || null,
    };
  });

  return html`
    <div class="fnd-diagnostics-panel">
      <h4>${t('profile.foundry.diagnostics')}</h4>
      <table class="fnd-diag-table">
        <thead>
          <tr>
            <th>${t('profile.foundry.diagComponent')}</th>
            <th>${t('profile.foundry.diagType')}</th>
            <th>${t('profile.foundry.diagGenStatus')}</th>
            <th>${t('profile.foundry.diagLiveStatus')}</th>
            <th>${t('profile.foundry.diagLastAction')}</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(d => html`
            <tr class=${d.active ? 'diag-active' : d.installed ? 'diag-installed' : ''}>
              <td>${d.label}</td>
              <td><span class="fnd-type-badge type-${d.type}">${d.type}</span></td>
              <td><span class="fnd-status-badge status-${d.foundryStatus}">${d.foundryStatus}</span></td>
              <td>
                <span class=${d.active ? 'fnd-live-active' : d.installed ? 'fnd-live-installed' : 'fnd-live-missing'}>
                  ${d.liveStatus}
                </span>
              </td>
              <td class="fnd-diag-action">
                ${d.lastAction ? `${d.lastAction.action} (${new Date(d.lastAction.at).toLocaleTimeString()})` : '-'}
              </td>
            </tr>
          `)}
        </tbody>
      </table>
    </div>
  `;
}
