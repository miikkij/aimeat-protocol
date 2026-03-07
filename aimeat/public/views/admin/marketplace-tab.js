import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { num, dt, StatsGrid, Empty, ExpandableHelp } from './shared.js';
import { apiPost } from '/js/api.js';

export default function MarketplaceTab({ data, reload }) {
  const mp = data.marketplace;
  const [showCreate, setShowCreate] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', type: 'node' });

  async function createMarketplace() {
    if (!newItem.name.trim()) return;
    try {
      await apiPost('/v1/admin/marketplace', { name: newItem.name, type: newItem.type });
      alert(t('dashboard.marketplaceCreateConfirm'));
      setNewItem({ name: '', type: 'node' });
      setShowCreate(false);
      reload();
    } catch (e) { alert(t('dashboard.errorLabel') + ': ' + e.message); }
  }

  if (!mp) return html`<${Empty} text=${t('dashboard.marketplaceEmpty')} />`;

  const listings = mp.recent_listings || mp.listings || [];

  return html`
    <p style="color:var(--text-dim);margin:0 0 12px">${t('dashboard.marketplaceExplain')}</p>
    <${ExpandableHelp} title=${t('dashboard.marketplaceHelpTitle')}>
      ${t('dashboard.marketplaceHelpDetail')}
    <//>

    <div style="margin-bottom:12px">
      <button class="adm-btn-action" onClick=${() => setShowCreate(!showCreate)}>
        + ${t('dashboard.marketplaceCreate')}
      </button>
      ${showCreate && html`
        <div class="adm-card" style="margin-top:8px">
          <div style="display:flex;flex-direction:column;gap:8px">
            <input value=${newItem.name} onInput=${e => setNewItem(prev => ({...prev, name: e.target.value}))}
              placeholder=${t('dashboard.marketplaceName')}
              style="background:var(--glass-bg);border:1px solid var(--glass-border);color:var(--text-bright);padding:8px 12px;border-radius:6px" />
            <select value=${newItem.type} onChange=${e => setNewItem(prev => ({...prev, type: e.target.value}))}
              style="background:var(--glass-bg);border:1px solid var(--glass-border);color:var(--text-bright);padding:8px 12px;border-radius:6px">
              <option value="node">${t('dashboard.marketplaceNodeLevel')}</option>
              <option value="federation">${t('dashboard.marketplaceFederationLevel')}</option>
            </select>
            <button class="adm-btn-action" onClick=${createMarketplace}>${t('dashboard.marketplaceCreate')}</button>
          </div>
        </div>
      `}
    </div>

    <${StatsGrid} items=${[
      { label: t('dashboard.totalListings'), value: mp.total || listings.length, color: '#06b6d4' },
      { label: t('dashboard.activeListings'), value: mp.active || listings.filter(l => l.status === 'active').length, color: '#22c55e' },
      { label: t('dashboard.totalTransactions'), value: mp.transactions || 0, color: '#f59e0b' },
    ]} />

    ${!listings.length
      ? html`<${Empty} text=${t('dashboard.noListings')} />`
      : html`<div class="adm-card" style="margin-top:12px">
        <h4 style="margin:0 0 12px">${t('dashboard.recentListings')}</h4>
        <div class="scrollable"><table>
          <thead><tr>
            <th>${t('dashboard.title')}</th>
            <th>${t('dashboard.seller')}</th>
            <th>${t('dashboard.price')}</th>
            <th>${t('dashboard.statusLabel')}</th>
            <th>${t('dashboard.created')}</th>
          </tr></thead>
          <tbody>
            ${listings.map(l => html`<tr>
              <td>${escHtml(l.title || l.name || '\u2014')}</td>
              <td class="mono" style="font-size:.8rem">${escHtml(String(l.seller || l.owner || '').substring(0, 20))}</td>
              <td>${num(l.price || 0)} \u2B25</td>
              <td><span class="badge ${l.status === 'active' ? 'bg-green' : 'bg-dim'}">${l.status || '\u2014'}</span></td>
              <td style="color:var(--text-dim)">${dt(l.created_at)}</td>
            </tr>`)}
          </tbody>
        </table></div>
      </div>`
    }
  `;
}
