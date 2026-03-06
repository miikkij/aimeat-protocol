import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { num, dt, StatsGrid, Empty } from './shared.js';

export default function MarketplaceTab({ data }) {
  const mp = data.marketplace;
  if (!mp) return html`<${Empty} text=${t('dashboard.marketplaceEmpty')} />`;

  const listings = mp.recent_listings || mp.listings || [];

  return html`
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
