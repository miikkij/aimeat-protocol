/**
 * @file public/views/admin/work-tab.js
 * @description Admin dashboard tab listing work items — a read-only table of tracking code, status,
 *   action, requester/provider GAIIs, morsel cost, and creation time.
 *
 * @structure
 *   - WorkTab (default export): renders data.work.items as a status-badged table, or an Empty state
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { num, dt, Badge, Empty } from './shared.js';

export default function WorkTab({ data }) {
  const work = data.work;
  if (!work?.items?.length) return html`<${Empty} text=${t('dashboard.noWorkItems')} />`;

  return html`
    <div class="adm-card">
      <div class="scrollable">
        <table>
          <thead><tr>
            <th>${t('dashboard.trackingCode')}</th>
            <th>${t('dashboard.statusLabel')}</th>
            <th>${t('dashboard.action')}</th>
            <th>${t('dashboard.requester')}</th>
            <th>${t('dashboard.provider')}</th>
            <th>${t('dashboard.cost')}</th>
            <th>${t('dashboard.created')}</th>
          </tr></thead>
          <tbody>
            ${work.items.map(w => {
              const statusType = w.status === 'completed' ? 'healthy' :
                w.status === 'failed' ? 'critical' :
                w.status === 'in_progress' ? 'watch' : 'info';
              return html`<tr>
                <td class="mono" style="font-size:.8rem">${escHtml(w.tracking_code || w.id)}</td>
                <td><${Badge} type=${statusType} label=${w.status} /></td>
                <td>${escHtml(w.action_name || w.action_id || '\u2014')}</td>
                <td class="mono" style="font-size:.8rem">${escHtml(w.requester_gaii?.substring(0, 20) || '\u2014')}</td>
                <td class="mono" style="font-size:.8rem">${escHtml(w.provider_gaii?.substring(0, 20) || '\u2014')}</td>
                <td>${num(w.cost || 0)} \u2B25</td>
                <td style="color:var(--text-dim)">${dt(w.created_at)}</td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
