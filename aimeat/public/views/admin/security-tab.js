/**
 * @file security-tab.js
 * @description Admin Security tab — lists security incidents (e.g. rejected/quarantined ZIP uploads):
 *   what happened, the machine code, on whose behalf, the source, when, and the status. Operators can
 *   download the quarantined payload for inspection, mark an incident resolved, or delete it.
 * @version-history
 *   v1.1.0 — 2026-08-17 — Refusal-log section: the tail of the auth refusal log as a table
 *     (who was turned away, at which door, from where, with what), plus top-doors/top-IPs
 *     summaries computed from the same rows.
 *   v1.0.0 — 2026-06-09 — Initial: incident list + resolve / delete / download-quarantine.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { getSecurityIncidents, resolveSecurityIncident, deleteSecurityIncident, getAuthRefusals } from '/js/services/admin.js';
import { authHeaders } from '/js/services/auth.js';

const html = htm.bind(h);

/** Top N values of one field across the refusal rows, as [value, count] pairs. */
function topOf(items, field, n = 5) {
  const counts = new Map();
  for (const r of items) {
    const v = r[field] || '?';
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

export default function SecurityTab() {
  const [state, setState] = useState({ incidents: [], open: 0, total: 0, loading: true });
  const [refusals, setRefusals] = useState({ enabled: true, items: [], loading: true });
  const [toast, showErr, showOk, clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();

  const load = async () => {
    try { const r = await getSecurityIncidents(); setState({ incidents: r?.data?.incidents || [], open: r?.data?.open || 0, total: r?.data?.total || 0, loading: false }); }
    catch (e) { setState({ incidents: [], open: 0, total: 0, loading: false }); showErr((e && e.message) || 'Failed to load incidents'); }
    try { const r = await getAuthRefusals(200); setRefusals({ enabled: r?.data?.enabled !== false, items: r?.data?.items || [], loading: false }); }
    catch (e) { setRefusals({ enabled: true, items: [], loading: false }); showErr((e && e.message) || 'Failed to load refusals'); }
  };
  // load once on mount. `load` is re-created each render and closes over showErr/setState; including
  // it would re-run every render (loop).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const resolve = async (id) => {
    try { await resolveSecurityIncident(id); showOk(t('admin.security.resolved') || 'Incident resolved'); load(); }
    catch (e) { showErr((e && e.message) || 'Failed'); }
  };
  const remove = (id) => confirm(
    t('admin.security.deleteConfirm') || 'Delete this incident and its quarantined file?',
    async () => { try { await deleteSecurityIncident(id); showOk(t('admin.security.deleted') || 'Deleted'); load(); } catch (e) { showErr((e && e.message) || 'Failed'); } },
    { danger: true, title: t('admin.security.title') || 'Security' },
  );
  const downloadQuarantine = async (id) => {
    try {
      const res = await fetch(`/v1/admin/security/incidents/${encodeURIComponent(id)}/quarantine`, { headers: authHeaders() });
      if (!res.ok) throw new Error('No quarantined payload');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `quarantine-${id}.zip`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { showErr((e && e.message) || 'No quarantined file'); }
  };

  return html`
    <div class="adm-section">
      <${ConfirmUI} />${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <div class="adm-card">
        <h2 class="adm-sec-title">${'🛡️ '}${t('admin.security.title') || 'Security'}</h2>
        <p class="adm-sec-desc">
          ${t('admin.security.desc') || 'Rejected / quarantined uploads and other security incidents.'}
          ${state.open > 0 ? html` <span class="adm-badge adm-badge--danger">${state.open} ${t('admin.security.open') || 'open'}</span>` : null}
        </p>
        ${state.loading
          ? html`<div class="adm-sec-empty">${t('common.loading') || 'Loading…'}</div>`
          : state.incidents.length === 0
            ? html`<div class="adm-sec-empty">${t('admin.security.none') || 'No security incidents 🎉'}</div>`
            : html`<div class="adm-sec-list">
                ${state.incidents.map(i => html`
                  <div class="adm-sec-row ${i.status === 'open' ? 'open' : ''}" key=${i.id}>
                    <div class="adm-sec-main">
                      <div class="adm-sec-line1">
                        <span class="adm-badge ${i.status === 'open' ? 'adm-badge--danger' : 'adm-badge--success'}">${escHtml(i.status)}</span>
                        <span class="adm-sec-type">${escHtml(i.type)}</span>
                        <code class="adm-sec-code">${escHtml(i.code)}</code>
                        <span class="adm-sec-when">${dt(i.createdAt)}</span>
                      </div>
                      <div class="adm-sec-line2">
                        ${escHtml(i.detail || '')}
                      </div>
                      <div class="adm-sec-line3">
                        <span>${t('admin.security.actor') || 'On behalf of'}: <strong>${escHtml(i.actor_name || i.actor || '?')}</strong></span>
                        ${i.source ? html`<span> · ${t('admin.security.source') || 'Source'}: ${escHtml(i.source)}</span>` : null}
                        ${i.size_bytes ? html`<span> · ${(i.size_bytes / 1024).toFixed(0)} KB</span>` : null}
                      </div>
                    </div>
                    <div class="adm-sec-actions">
                      ${i.quarantine_key ? html`<button class="adm-btn" onClick=${() => downloadQuarantine(i.id)}>${'⬇ '}${t('admin.security.evidence') || 'Payload'}</button>` : null}
                      ${i.status === 'open' ? html`<button class="adm-btn" onClick=${() => resolve(i.id)}>${t('admin.security.resolve') || 'Resolve'}</button>` : null}
                      <button class="adm-btn" onClick=${() => remove(i.id)}>${'✕ '}${t('admin.security.delete') || 'Delete'}</button>
                    </div>
                  </div>`)}
              </div>`}
      </div>

      <div class="adm-card">
        <h2 class="adm-sec-title">${t('admin.security.refusals.title')}</h2>
        <p class="adm-sec-desc">${t('admin.security.refusals.desc')}</p>
        ${refusals.loading
          ? html`<div class="adm-sec-empty">${t('common.loading') || 'Loading…'}</div>`
          : !refusals.enabled
            ? html`<div class="adm-sec-empty">${t('admin.security.refusals.disabled')} <code>AIMEAT_AUTH_LOG_PATH</code></div>`
            : refusals.items.length === 0
              ? html`<div class="adm-sec-empty">${t('admin.security.refusals.none')}</div>`
              : html`
                <div class="adm-sec-line3">
                  <span>${t('admin.security.refusals.topDoors')}: ${topOf(refusals.items, 'path').map(([v, n]) => html`<code class="adm-sec-code">${escHtml(v)}</code> ×${n} `)}</span>
                </div>
                <div class="adm-sec-line3">
                  <span>${t('admin.security.refusals.topIps')}: ${topOf(refusals.items, 'ip').map(([v, n]) => html`<code class="adm-sec-code">${escHtml(v)}</code> ×${n} `)}</span>
                </div>
                <table class="adm-db-table">
                  <thead>
                    <tr>
                      <th>${t('admin.security.refusals.time')}</th>
                      <th>${t('admin.security.refusals.answer')}</th>
                      <th>${t('admin.security.refusals.door')}</th>
                      <th>${t('admin.security.refusals.ip')}</th>
                      <th>${t('admin.security.refusals.credential')}</th>
                      <th>${t('admin.security.refusals.reason')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${refusals.items.map((r, i) => html`<tr key=${r.ts + i}>
                      <td class="adm-sec-when">${dt(r.ts)}</td>
                      <td><span class="adm-badge ${r.status === 401 ? 'adm-badge--warning' : 'adm-badge--danger'}">${r.status}</span> <code class="adm-sec-code">${escHtml(r.code || '')}</code></td>
                      <td class="adm-metrics-route">${escHtml(r.method || '')} ${escHtml(r.path || '')}</td>
                      <td class="adm-metrics-route">${escHtml(r.ip || '')}</td>
                      <td>${escHtml(r.credential || 'none')}${r.credential_digest ? html` <code class="adm-sec-code">${escHtml(r.credential_digest)}</code>` : null}</td>
                      <td class="adm-sec-line2">${escHtml((r.reason || '').slice(0, 120))}</td>
                    </tr>`)}
                  </tbody>
                </table>`}
      </div>
    </div>`;
}
