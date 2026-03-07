import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { num, dt, StatsGrid, Empty } from './shared.js';

export default function ChatInstancesTab({ data }) {
  const ch = data.chatInstances;
  if (!ch) return html`<${Empty} text=${t('dashboard.noChatInstances')} />`;

  const sessions = ch.sessions || [];

  return html`
    <p style="color:var(--text-dim);font-size:.85rem;margin-bottom:12px">${t('dashboard.chatExplain')}</p>
    <${StatsGrid} items=${[
      { label: t('dashboard.totalSessions'), value: ch.total || sessions.length, color: '#06b6d4' },
      { label: t('dashboard.activeSessions'), value: sessions.filter(s => !s.ended_at).length, color: '#22c55e' },
      { label: t('dashboard.avgMessages'), value: sessions.length ? Math.round(sessions.reduce((a, s) => a + (s.message_count || 0), 0) / sessions.length) : 0, color: '#f59e0b' },
    ]} />

    ${!sessions.length
      ? html`<${Empty} text=${t('dashboard.noChatInstances')} />`
      : html`<div class="adm-card"><div class="scrollable"><table>
        <thead><tr>
          <th>ID</th>
          <th>GHII</th>
          <th>${t('dashboard.messages')}</th>
          <th>${t('dashboard.started')}</th>
          <th>${t('dashboard.ended')}</th>
          <th>${t('dashboard.statusLabel')}</th>
        </tr></thead>
        <tbody>
          ${sessions.map(s => html`<tr>
            <td class="mono" style="font-size:.8rem">${escHtml(String(s.id || s.session_id || '').substring(0, 16))}</td>
            <td class="mono" style="font-size:.8rem">${escHtml(String(s.ghii || s.user || '').substring(0, 16))}</td>
            <td>${num(s.message_count)}</td>
            <td style="color:var(--text-dim)">${dt(s.started_at || s.created_at)}</td>
            <td style="color:var(--text-dim)">${s.ended_at ? dt(s.ended_at) : '\u2014'}</td>
            <td><span class="badge ${s.ended_at ? 'bg-dim' : 'bg-green'}">${s.ended_at ? t('dashboard.ended') : t('dashboard.active')}</span></td>
          </tr>`)}
        </tbody>
      </table></div></div>`
    }
  `;
}
