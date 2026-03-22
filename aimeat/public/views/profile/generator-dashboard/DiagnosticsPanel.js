/**
 * @file DiagnosticsPanel.js
 * @description Diagnostics table sub-component — renders a table showing each
 *   component's generator status, live status, and last action. Pure component
 *   that derives diagnosticsData from its props.
 *
 *   Part of the hook-per-domain architecture.
 *
 * @structure
 *   - DiagnosticsPanel({ components, liveStatuses }): diagnostics table
 * @usage
 *   import { DiagnosticsPanel } from './generator-dashboard/DiagnosticsPanel.js';
 *   ${showDiagnostics && html`<${DiagnosticsPanel} components=${core.components} liveStatuses=${core.liveStatuses} />`}
 * @version-history
 *   v1.0.0 — 2026-03-22 — Extracted from generator-tab.js ProjectDashboard
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
      generatorStatus: c.status,
      registeredAs: c.registeredAs,
      liveStatus: live.status || 'unknown',
      active: live.active || false,
      installed: live.installed || false,
      lastAction: (c.history || []).slice(-1)[0] || null,
    };
  });

  return html`
    <div class="pf-gen-diagnostics-panel">
      <h4>${t('profile.generator.diagnostics')}</h4>
      <table class="pf-gen-diag-table">
        <thead>
          <tr>
            <th>${t('profile.generator.diagComponent')}</th>
            <th>${t('profile.generator.diagType')}</th>
            <th>${t('profile.generator.diagGenStatus')}</th>
            <th>${t('profile.generator.diagLiveStatus')}</th>
            <th>${t('profile.generator.diagLastAction')}</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(d => html`
            <tr class=${d.active ? 'diag-active' : d.installed ? 'diag-installed' : ''}>
              <td>${d.label}</td>
              <td><span class="pf-gen-type-badge type-${d.type}">${d.type}</span></td>
              <td><span class="pf-gen-status-badge status-${d.generatorStatus}">${d.generatorStatus}</span></td>
              <td>
                <span class=${d.active ? 'pf-gen-live-active' : d.installed ? 'pf-gen-live-installed' : 'pf-gen-live-missing'}>
                  ${d.liveStatus}
                </span>
              </td>
              <td class="pf-gen-diag-action">
                ${d.lastAction ? `${d.lastAction.action} (${new Date(d.lastAction.at).toLocaleTimeString()})` : '-'}
              </td>
            </tr>
          `)}
        </tbody>
      </table>
    </div>
  `;
}
