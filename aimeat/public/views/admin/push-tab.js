import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, StatsGrid, Empty, ExpandableHelp } from './shared.js';

export default function PushTab({ data }) {
  const push = data.push;
  if (!push) return html`<${Empty} text=${t('dashboard.pushNotConfigured')} />`;

  const subs = push.subscriptions || [];

  return html`
    <p style="color:var(--text-dim);font-size:.85rem;margin-bottom:12px">${t('dashboard.pushExplain')}</p>
    <${ExpandableHelp} title=${t('dashboard.pushHelpTitle')}>${t('dashboard.pushHelpDetail')}</${ExpandableHelp}>

    <${StatsGrid} items=${[
      { label: t('dashboard.totalSubscriptions'), value: push.total || subs.length, color: '#06b6d4' },
      { label: t('dashboard.activeSubscriptions'), value: subs.filter(s => s.active !== false).length, color: '#22c55e' },
    ]} />

    <!-- Message Templates -->
    <div class="adm-card">
      <h3>${t('dashboard.pushTemplatesTitle')}</h3>
      <p style="color:var(--text-dim);font-size:.8rem;margin-bottom:12px">${t('dashboard.pushTemplatesExplain')}</p>

      <div style="display:flex;flex-direction:column;gap:12px">
        <!-- Web Push template -->
        <div style="border:1px solid var(--glass-border);border-radius:8px;padding:12px;background:rgba(255,255,255,0.02)">
          <div style="font-weight:700;font-size:.9rem;margin-bottom:4px">${t('dashboard.pushWebPushTitle')}</div>
          <div style="font-size:.8rem;color:var(--text-dim);margin-bottom:8px">${t('dashboard.pushWebPushUsed')}</div>
          <div style="display:flex;flex-direction:column;gap:4px">
            <div style="display:flex;gap:8px;align-items:baseline">
              <span style="font-size:.72rem;color:var(--text-dim);min-width:60px">${t('dashboard.pushTemplate')}:</span>
              <code style="font-size:.82rem;color:#06b6d4;background:rgba(0,0,0,0.2);padding:2px 8px;border-radius:4px">${t('dashboard.pushWebPushTitleTpl')}</code>
            </div>
            <div style="display:flex;gap:8px;align-items:baseline">
              <span style="font-size:.72rem;color:var(--text-dim);min-width:60px">Body:</span>
              <code style="font-size:.82rem;color:#06b6d4;background:rgba(0,0,0,0.2);padding:2px 8px;border-radius:4px">${t('dashboard.pushWebPushBodyTpl')}</code>
            </div>
          </div>
        </div>

        <!-- Email template -->
        <div style="border:1px solid var(--glass-border);border-radius:8px;padding:12px;background:rgba(255,255,255,0.02)">
          <div style="font-weight:700;font-size:.9rem;margin-bottom:4px">${t('dashboard.pushEmailTitle')}</div>
          <div style="font-size:.8rem;color:var(--text-dim);margin-bottom:8px">${t('dashboard.pushEmailUsed')}</div>
          <div style="display:flex;flex-direction:column;gap:4px">
            <div style="display:flex;gap:8px;align-items:baseline">
              <span style="font-size:.72rem;color:var(--text-dim);min-width:60px">Subject:</span>
              <code style="font-size:.82rem;color:#06b6d4;background:rgba(0,0,0,0.2);padding:2px 8px;border-radius:4px">${t('dashboard.pushEmailSubjectTpl')}</code>
            </div>
            <div style="margin-top:4px">
              <span style="font-size:.72rem;color:var(--text-dim)">Body:</span>
              <pre style="font-size:.78rem;color:var(--text-bright);background:rgba(0,0,0,0.2);padding:8px 10px;border-radius:4px;margin:4px 0 0;white-space:pre-wrap;line-height:1.4">${t('dashboard.pushEmailBodyTpl')}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Notification Triggers -->
    <div class="adm-card">
      <h3>${t('dashboard.pushNotifyTypesTitle')}</h3>
      <p style="color:var(--text-dim);font-size:.8rem;margin-bottom:10px">${t('dashboard.pushNotifyTypesExplain')}</p>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${['pushTypeWorkAssignment', 'pushTypeActionRequest', 'pushTypeBoardNotification', 'pushTypeFederationSync'].map(key => {
          const text = t('dashboard.' + key);
          const [code, ...descParts] = text.split(' \u2014 ');
          const desc = descParts.join(' \u2014 ');
          return html`
            <div style="display:flex;gap:10px;align-items:baseline;padding:6px 10px;border-radius:6px;background:rgba(255,255,255,0.02);border:1px solid var(--glass-border)">
              <code style="font-size:.8rem;color:#f59e0b;min-width:160px">${escHtml(code)}</code>
              <span style="font-size:.82rem;color:var(--text-dim)">${escHtml(desc)}</span>
            </div>
          `;
        })}
      </div>
    </div>

    <!-- Subscriptions -->
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
