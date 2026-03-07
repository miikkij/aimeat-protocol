import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, Empty, ExpandableHelp } from './shared.js';
import { getCsmDetail } from '/js/services/admin.js';

export default function CsmTab({ data }) {
  const templates = data.csm?.templates || [];
  const [detail, setDetail] = useState(null);

  async function showDetail(name) {
    try {
      const r = await getCsmDetail(name);
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
          ${detail.version && html`<div style="font-size:.8rem;color:var(--text-dim);margin-bottom:8px">${t('dashboard.version')}: ${detail.version}</div>`}
          ${detail.schema && html`
            <h5 style="margin:12px 0 4px">${t('dashboard.schema')}</h5>
            <pre style="background:var(--bg-card);padding:12px;border-radius:6px;overflow:auto;font-size:.75rem">${JSON.stringify(detail.schema, null, 2)}</pre>
          `}
          ${detail.fields && html`
            <h5 style="margin:12px 0 4px">${t('dashboard.fields')}</h5>
            <table>
              <thead><tr><th>${t('dashboard.name')}</th><th>${t('dashboard.type')}</th><th>${t('dashboard.required')}</th></tr></thead>
              <tbody>${detail.fields.map(f => html`<tr>
                <td>${escHtml(f.name)}</td>
                <td><code>${f.type}</code></td>
                <td>${f.required ? '\u2705' : ''}</td>
              </tr>`)}</tbody>
            </table>
          `}
        </div>
      </div>
    `;
  }

  if (!templates.length) return html`<${Empty} text=${t('dashboard.noCsmTemplates')} />`;

  return html`
    <p style="color:var(--text-dim);margin:0 0 12px">${t('dashboard.csmExplain')}</p>
    <${ExpandableHelp} title=${t('dashboard.csmHelpTitle')}>
      ${t('dashboard.csmHelpDetail')}
    <//>

    <div class="adm-card">
      <div class="scrollable">
        <table>
          <thead><tr>
            <th>${t('dashboard.name')}</th>
            <th>${t('dashboard.description')}</th>
            <th>${t('dashboard.version')}</th>
            <th>${t('dashboard.created')}</th>
            <th></th>
          </tr></thead>
          <tbody>
            ${templates.map(c => html`<tr>
              <td><strong>${escHtml(c.name)}</strong></td>
              <td style="font-size:.8rem;color:var(--text-dim);max-width:200px">${escHtml(c.description || '\u2014')}</td>
              <td>${c.version || '\u2014'}</td>
              <td style="color:var(--text-dim)">${dt(c.created_at)}</td>
              <td><button class="adm-btn-sm" onClick=${() => showDetail(c.name)}>${t('dashboard.details')}</button></td>
            </tr>`)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
