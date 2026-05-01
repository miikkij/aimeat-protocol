import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { num, Badge, Empty } from './shared.js';

export default function CapabilitiesTab({ data, session }) {
  const [caps, setCaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!session) return;
    session.fetch('/v1/admin/capabilities?per_page=200').then(res => {
      setCaps(res.data?.capabilities || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [session]);

  if (loading) return html`<div class="adm-card">${t('common.loading')}</div>`;
  if (!caps.length) return html`<${Empty} text=${t('capabilities.noCapabilities')} />`;

  const filtered = filter
    ? caps.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()) || c.id.toLowerCase().includes(filter.toLowerCase()))
    : caps;

  return html`
    <div class="adm-card">
      <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center">
        <input type="text" placeholder=${t('common.search')} value=${filter}
          onInput=${e => setFilter(e.target.value)}
          style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:.85rem;flex:1;max-width:300px" />
        <span style="font-size:.8rem;color:var(--text-dim)">${filtered.length} / ${caps.length}</span>
      </div>
      <div class="scrollable">
        <table>
          <thead><tr>
            <th>ID</th>
            <th>${t('capabilities.name')}</th>
            <th>${t('capabilities.owner')}</th>
            <th>${t('capabilities.sourceType')}</th>
            <th>${t('capabilities.status')}</th>
            <th>${t('capabilities.callable')}</th>
            <th>${t('capabilities.invocations')}</th>
            <th>${t('capabilities.errors')}</th>
            <th>${t('capabilities.vouchCount')}</th>
          </tr></thead>
          <tbody>
            ${filtered.map(c => {
              const s = c.stats || {};
              const override = c.operatorOverride;
              return html`<tr style=${override?.disabled ? 'opacity:0.5' : ''}>
                <td class="mono" style="font-size:.75rem">${escHtml(c.id)}</td>
                <td>
                  <strong>${escHtml(c.name)}</strong>
                  ${c.summary ? html`<div style="font-size:.72rem;color:var(--text-dim);max-width:200px">${escHtml(c.summary.slice(0,80))}</div>` : ''}
                </td>
                <td class="mono" style="font-size:.75rem">${escHtml(c.ownerGhii?.split('@')[0] || '')}</td>
                <td><${Badge} type=${c.source?.type || 'manual'} /></td>
                <td><${Badge} type=${c.status === 'active' ? 'success' : c.status === 'disabled' ? 'danger' : 'warning'} label=${c.status} /></td>
                <td>${c.callable ? '✅' : '➖'}</td>
                <td>${num(s.totalInvocations || 0)}</td>
                <td style=${s.errorCount > 0 ? 'color:#E8564A' : ''}>${num(s.errorCount || 0)}</td>
                <td>${num(c.trust?.vouchCount || 0)}</td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
