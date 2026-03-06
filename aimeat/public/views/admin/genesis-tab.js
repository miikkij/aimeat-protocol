import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, Badge, StatsGrid, Empty } from './shared.js';
import { approveGenesisPeer, suspendGenesisPeer, removeGenesisPeer } from '/js/services/admin.js';

export default function GenesisTab({ data, reload }) {
  const gen = data.genesis;
  if (!gen) return html`<${Empty} text=${t('dashboard.genesisNotAvailable')} />`;

  const peers = gen.peers || [];

  async function doAction(fn, nodeId, confirmKey) {
    if (!confirm(t(confirmKey || 'dashboard.confirmAction'))) return;
    try { await fn(nodeId); reload(); }
    catch (e) { alert(t('dashboard.errorLabel') + ': ' + e.message); }
  }

  return html`
    <${StatsGrid} items=${[
      { label: t('dashboard.totalPeers'), value: peers.length, color: '#06b6d4' },
      { label: t('dashboard.approved'), value: peers.filter(p => p.status === 'approved' || p.status === 'active').length, color: '#22c55e' },
      { label: t('dashboard.suspended'), value: peers.filter(p => p.status === 'suspended').length, color: '#ef4444' },
      { label: t('dashboard.pending'), value: peers.filter(p => p.status === 'pending').length, color: '#f59e0b' },
    ]} />

    ${!peers.length
      ? html`<${Empty} text=${t('dashboard.noGenesisPeers')} />`
      : html`<div class="adm-card" style="margin-top:12px"><div class="scrollable"><table>
        <thead><tr>
          <th>${t('dashboard.nodeId')}</th>
          <th>${t('dashboard.endpoint')}</th>
          <th>${t('dashboard.statusLabel')}</th>
          <th>${t('dashboard.lastSeen')}</th>
          <th>${t('dashboard.actions')}</th>
        </tr></thead>
        <tbody>
          ${peers.map(p => html`<tr>
            <td class="mono" style="font-size:.8rem">${escHtml(p.node_id)}</td>
            <td class="mono" style="font-size:.8rem">${escHtml(p.endpoint || '\u2014')}</td>
            <td><${Badge} type=${p.status === 'approved' || p.status === 'active' ? 'healthy' : p.status === 'suspended' ? 'critical' : 'watch'} label=${p.status} /></td>
            <td style="color:var(--text-dim)">${dt(p.last_seen)}</td>
            <td style="display:flex;gap:4px">
              ${(p.status === 'pending' || p.status === 'suspended') && html`
                <button class="adm-btn-sm" onClick=${() => doAction(approveGenesisPeer, p.node_id, 'dashboard.approveConfirm')}>${t('dashboard.approve')}</button>
              `}
              ${p.status !== 'suspended' && html`
                <button class="adm-btn-sm" onClick=${() => doAction(suspendGenesisPeer, p.node_id, 'dashboard.suspendConfirm')}>${t('dashboard.suspend')}</button>
              `}
              <button class="adm-btn-sm" onClick=${() => doAction(removeGenesisPeer, p.node_id, 'dashboard.removeConfirm')}>${t('dashboard.remove')}</button>
            </td>
          </tr>`)}
        </tbody>
      </table></div></div>`
    }
  `;
}
