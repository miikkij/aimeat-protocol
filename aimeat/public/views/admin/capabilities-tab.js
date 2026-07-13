/**
 * @file public/views/admin/capabilities-tab.js
 * @description Admin dashboard tab listing all registered capabilities — searchable table with
 *   input/output schema keys, source type, invocation/error stats, and an expandable per-row
 *   panel showing full JSON schemas, owner, status, auth, vouches, and usage.
 *
 * @structure
 *   - CapabilitiesTab({ session }): default component; fetches /v1/admin/capabilities, filters, expands rows
 *   - schemaKeys(schema): summarizes a JSON schema's property keys + types for the compact columns
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { num, Badge, Empty } from './shared.js';

function schemaKeys(schema) {
  if (!schema || typeof schema !== 'object') return '';
  const props = schema.properties || schema;
  return Object.entries(props)
    .filter(([k]) => !['type','properties','items','required','description','nullable','enum'].includes(k))
    .map(([k, v]) => {
      const spec = (v && typeof v === 'object') ? v : {};
      let t = spec.type || '?';
      if (t === 'object' && spec.properties) t = '{...}';
      if (t === 'array' && spec.items) t = '[...]';
      return k + ':' + t;
    }).join(', ');
}

export default function CapabilitiesTab({ session }) {
  const [caps, setCaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState(null);

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
            <th>Input</th>
            <th>Output</th>
            <th>${t('capabilities.sourceType')}</th>
            <th>${t('capabilities.callable')}</th>
            <th>${t('capabilities.invocations')}</th>
            <th>${t('capabilities.errors')}</th>
          </tr></thead>
          <tbody>
            ${filtered.map(c => {
              const s = c.stats || {};
              const override = c.operatorOverride;
              const isExp = expanded === c.id;
              const inputKeys = schemaKeys(c.inputSchema);
              const outputKeys = schemaKeys(c.outputSchema);
              return html`
                <tr style=${override?.disabled ? 'opacity:0.5;cursor:pointer' : 'cursor:pointer'}
                    onClick=${() => setExpanded(isExp ? null : c.id)}>
                  <td class="mono" style="font-size:.72rem;max-width:180px;overflow:hidden;text-overflow:ellipsis">${escHtml(c.id)}</td>
                  <td>
                    <strong>${escHtml(c.name)}</strong>
                    ${c.summary ? html`<div style="font-size:.7rem;color:var(--text-dim);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(c.summary)}</div>` : ''}
                  </td>
                  <td style="font-size:.7rem;font-family:monospace;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${inputKeys || html`<span style="opacity:.4">—</span>`}</td>
                  <td style="font-size:.7rem;font-family:monospace;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${outputKeys || html`<span style="opacity:.4">—</span>`}</td>
                  <td><${Badge} type=${c.source?.type || 'manual'} /></td>
                  <td>${c.callable ? '✅' : '➖'}</td>
                  <td>${num(s.totalInvocations || 0)}</td>
                  <td style=${s.errorCount > 0 ? 'color:#E8564A' : ''}>${num(s.errorCount || 0)}</td>
                </tr>
                ${isExp ? html`<tr>
                  <td colspan="8" style="background:var(--bg-dim,#f5f5f5);padding:12px">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:.78rem">
                      <div>
                        <div style="font-weight:600;margin-bottom:4px">Input Schema</div>
                        ${c.inputSchema ? html`<pre style="margin:0;white-space:pre-wrap;font-size:.72rem;max-height:200px;overflow:auto">${JSON.stringify(c.inputSchema, null, 2)}</pre>` : html`<span style="opacity:.5">None</span>`}
                      </div>
                      <div>
                        <div style="font-weight:600;margin-bottom:4px">Output Schema</div>
                        ${c.outputSchema ? html`<pre style="margin:0;white-space:pre-wrap;font-size:.72rem;max-height:200px;overflow:auto">${JSON.stringify(c.outputSchema, null, 2)}</pre>` : html`<span style="opacity:.5">None</span>`}
                      </div>
                    </div>
                    <div style="margin-top:8px;font-size:.75rem;display:flex;gap:16px;flex-wrap:wrap">
                      <span>Owner: <code>${escHtml(c.ownerGhii || '')}</code></span>
                      <span>Status: <${Badge} type=${c.status === 'active' ? 'success' : c.status === 'disabled' ? 'danger' : 'warning'} label=${c.status} /></span>
                      <span>Auth: ${c.authRequired}</span>
                      <span>Vouches: ${c.trust?.vouchCount || 0}</span>
                      <span>Avg: ${s.avgResponseMs || 0}ms</span>
                      ${c.usage ? html`<div style="margin-top:4px;width:100%"><code style="font-size:.7rem;word-break:break-all">${escHtml(c.usage.slice(0,200))}</code></div>` : null}
                    </div>
                  </td>
                </tr>` : null}`;
            })}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
