import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { num, dt, Empty, EconRow } from './shared.js';
import { getAgentDetail } from '/js/services/admin.js';

export default function AgentsTab({ data }) {
  const ag = data.agents;
  if (!ag?.agents?.length) return html`<${Empty} text=${t('dashboard.noAgentsRegistered')} />`;

  const [expanded, setExpanded] = useState({});

  async function toggleDetail(gaii, idx) {
    if (expanded[idx]) {
      setExpanded(prev => { const n = { ...prev }; delete n[idx]; return n; });
      return;
    }
    try {
      const r = await getAgentDetail(gaii);
      setExpanded(prev => ({ ...prev, [idx]: r.data }));
    } catch (e) { console.warn('Failed to load data:', e.message); }
  }

  return html`
    <p style="color:var(--text-dim);font-size:.85rem;margin-bottom:12px">${t('dashboard.gaiiExplain')}</p>
    <div class="adm-card">
      <div class="scrollable">
        <table>
          <thead><tr>
            <th>${t('dashboard.gaii')}</th>
            <th>${t('dashboard.owners')}</th>
            <th>${t('dashboard.displayName')}</th>
            <th>${t('dashboard.trust')}</th>
            <th>${t('dashboard.totalMorsels')}</th>
            <th>${t('dashboard.lastSeen')}</th>
            <th></th>
          </tr></thead>
          <tbody>
            ${ag.agents.map((a, i) => {
              const trust = typeof a.trust_score === 'number' ? a.trust_score.toFixed(1) : '\u2014';
              const tColor = a.trust_score >= 70 ? '#22c55e' : a.trust_score >= 30 ? '#eab308' : '#ef4444';
              const detail = expanded[i];
              return html`
                <tr>
                  <td class="mono">${escHtml(a.gaii)}</td>
                  <td>${escHtml(a.owner)}</td>
                  <td>${escHtml(a.display_name || '\u2014')}</td>
                  <td style="color:${tColor}">${trust}</td>
                  <td>${num(a.morsel_balance)}</td>
                  <td style="color:var(--text-dim)">${dt(a.last_seen)}</td>
                  <td><button class="adm-btn-sm" onClick=${() => toggleDetail(a.gaii, i)}>
                    ${detail ? t('dashboard.hide') : t('dashboard.details')}
                  </button></td>
                </tr>
                ${detail && html`<tr><td colspan="7">
                  <div class="adm-sub-panel">
                    <strong>${escHtml(detail.display_name || detail.gaii)}</strong>
                    ${detail.description && html`<p style="color:var(--text-dim);font-size:.8rem;margin:4px 0">${escHtml(detail.description)}</p>`}
                    ${detail.capabilities?.length > 0 && html`
                      <div style="margin:6px 0">${t('dashboard.capabilities')}: ${detail.capabilities.map(c => html`<span class="tag">${escHtml(c)}</span> `)}</div>
                    `}
                    ${detail.trust && html`
                      <div style="margin-top:8px"><strong style="font-size:.8rem;color:var(--text-dim)">${t('dashboard.trustDetails')}</strong></div>
                      <${EconRow} label=${t('dashboard.score')} value=${detail.trust.score} />
                      <${EconRow} label=${t('dashboard.deliveries')} value=${detail.trust.total_deliveries + ' (' + detail.trust.successful_deliveries + ' ok)'} />
                      <${EconRow} label=${t('dashboard.successRate')} value=${(detail.trust.success_rate * 100).toFixed(1) + '%'} />
                      <${EconRow} label=${t('dashboard.avgDeliveryTime')} value=${detail.trust.avg_delivery_time_seconds + 's'} />
                      <${EconRow} label=${t('dashboard.ratings')} value=${'+' + detail.trust.positive_ratings + ' / -' + detail.trust.negative_ratings} />
                      <${EconRow} label=${t('dashboard.age')} value=${detail.trust.age_days + ' ' + t('dashboard.daysUnit')} />
                    `}
                    <div style="margin-top:8px;font-size:.75rem;color:var(--text-dim)">${t('dashboard.created')}: ${dt(detail.created_at)} \u00B7 ${t('dashboard.home')}: ${escHtml(detail.home_node)}</div>
                  </div>
                </td></tr>`}
              `;
            })}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
