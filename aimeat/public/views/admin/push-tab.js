import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { num, dt, StatsGrid, Empty } from './shared.js';

export default function PushTab({ data }) {
  const push = data.push;
  if (!push) return html`<${Empty} text=${t('dashboard.pushNotConfigured')} />`;

  const subs = push.subscriptions || [];

  return html`
    <${StatsGrid} items=${[
      { label: t('dashboard.totalSubscriptions'), value: push.total || subs.length, color: '#06b6d4' },
      { label: t('dashboard.activeSubscriptions'), value: subs.filter(s => s.active !== false).length, color: '#22c55e' },
    ]} />

    ${!subs.length
      ? html`<${Empty} text=${t('dashboard.noSubscriptions')} />`
      : html`<div class="adm-card"><div class="scrollable"><table>
        <thead><tr>
          <th>${t('dashboard.endpoint')}</th>
          <th>GHII</th>
          <th>${t('dashboard.created')}</th>
        </tr></thead>
        <tbody>
          ${subs.map(s => html`<tr>
            <td class="mono" style="font-size:.8rem;max-width:200px;overflow:hidden;text-overflow:ellipsis">${escHtml(s.endpoint?.substring(0, 40) || '\u2014')}</td>
            <td class="mono" style="font-size:.8rem">${escHtml(String(s.ghii || '').substring(0, 16))}</td>
            <td style="color:var(--text-dim)">${dt(s.created_at)}</td>
          </tr>`)}
        </tbody>
      </table></div></div>`
    }
  `;
}
