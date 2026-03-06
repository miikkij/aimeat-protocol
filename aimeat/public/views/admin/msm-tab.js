import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, Badge, Empty } from './shared.js';
import { getMsmDetail } from '/js/services/admin.js';

export default function MsmTab({ data }) {
  const integrations = data.msm?.integrations || [];
  const [detail, setDetail] = useState(null);

  async function showDetail(name) {
    try {
      const r = await getMsmDetail(name);
      setDetail(r.data);
    } catch {}
  }

  if (detail) {
    return html`
      <div>
        <button class="adm-btn-sm" onClick=${() => setDetail(null)}>\u2190 ${t('dashboard.back')}</button>
        <div class="adm-card" style="margin-top:12px">
          <h4 style="margin:0 0 8px">${escHtml(detail.name)}</h4>
          ${detail.description && html`<p style="font-size:.85rem;color:var(--text-dim);margin:0 0 12px">${escHtml(detail.description)}</p>`}
          ${detail.status && html`<div style="margin-bottom:8px"><${Badge} type=${detail.status === 'active' ? 'healthy' : 'critical'} label=${detail.status} /></div>`}
          ${detail.endpoint && html`<div style="font-size:.8rem;color:var(--text-dim);margin-bottom:8px">${t('dashboard.endpoint')}: <code>${escHtml(detail.endpoint)}</code></div>`}
          ${detail.config && html`
            <h5 style="margin:12px 0 4px">${t('dashboard.configuration')}</h5>
            <pre style="background:var(--bg-card);padding:12px;border-radius:6px;overflow:auto;font-size:.75rem">${JSON.stringify(detail.config, null, 2)}</pre>
          `}
          ${detail.capabilities?.length > 0 && html`
            <h5 style="margin:12px 0 4px">${t('dashboard.capabilities')}</h5>
            <div>${detail.capabilities.map(c => html`<span class="tag">${escHtml(c)}</span> `)}</div>
          `}
        </div>
      </div>
    `;
  }

  if (!integrations.length) return html`<${Empty} text=${t('dashboard.noMsmIntegrations')} />`;

  return html`
    <div class="adm-card">
      <div class="scrollable">
        <table>
          <thead><tr>
            <th>${t('dashboard.name')}</th>
            <th>${t('dashboard.description')}</th>
            <th>${t('dashboard.statusLabel')}</th>
            <th>${t('dashboard.created')}</th>
            <th></th>
          </tr></thead>
          <tbody>
            ${integrations.map(m => html`<tr>
              <td><strong>${escHtml(m.name)}</strong></td>
              <td style="font-size:.8rem;color:var(--text-dim);max-width:200px">${escHtml(m.description || '\u2014')}</td>
              <td><${Badge} type=${m.status === 'active' ? 'healthy' : 'critical'} label=${m.status || '\u2014'} /></td>
              <td style="color:var(--text-dim)">${dt(m.created_at)}</td>
              <td><button class="adm-btn-sm" onClick=${() => showDetail(m.name)}>${t('dashboard.details')}</button></td>
            </tr>`)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
