import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, Badge, EconRow, Empty } from './shared.js';

export default function FederationTab({ data }) {
  const fed = data.federation;
  if (!fed) return html`<${Empty} text=${t('dashboard.federationNotAvailable')} />`;

  const peers = fed.peers || [];

  return html`
    <div class="adm-card">
      <h4 style="margin:0 0 12px">${t('dashboard.federationInfo')}</h4>
      <${EconRow} label=${t('dashboard.nodeId')} value=${fed.node_id || '\u2014'} />
      <${EconRow} label=${t('dashboard.clusterName')} value=${fed.cluster_name || '\u2014'} />
      <${EconRow} label=${t('dashboard.role')} value=${fed.role || '\u2014'} />
      <${EconRow} label=${t('dashboard.totalPeers')} value=${peers.length} />
    </div>

    ${peers.length > 0 && html`
      <div class="adm-card" style="margin-top:12px">
        <h4 style="margin:0 0 12px">${t('dashboard.peers')}</h4>
        <div class="scrollable"><table>
          <thead><tr>
            <th>${t('dashboard.nodeId')}</th>
            <th>${t('dashboard.endpoint')}</th>
            <th>${t('dashboard.statusLabel')}</th>
            <th>${t('dashboard.lastSeen')}</th>
          </tr></thead>
          <tbody>
            ${peers.map(p => html`<tr>
              <td class="mono" style="font-size:.8rem">${escHtml(p.node_id)}</td>
              <td class="mono" style="font-size:.8rem">${escHtml(p.endpoint || '\u2014')}</td>
              <td><${Badge} type=${p.status === 'active' ? 'healthy' : p.status === 'suspended' ? 'critical' : 'watch'} label=${p.status || 'unknown'} /></td>
              <td style="color:var(--text-dim)">${dt(p.last_seen)}</td>
            </tr>`)}
          </tbody>
        </table></div>
      </div>
    `}
  `;
}
