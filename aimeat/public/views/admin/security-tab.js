/**
 * @file security-tab.js
 * @description Admin Security tab — lists security incidents (e.g. rejected/quarantined ZIP uploads):
 *   what happened, the machine code, on whose behalf, the source, when, and the status. Operators can
 *   download the quarantined payload for inspection, mark an incident resolved, or delete it.
 * @version-history
 *   v1.0.0 — 2026-06-09 — Initial: incident list + resolve / delete / download-quarantine.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { getSecurityIncidents, resolveSecurityIncident, deleteSecurityIncident } from '/js/services/admin.js';
import { authHeaders } from '/js/services/auth.js';

const html = htm.bind(h);

export default function SecurityTab() {
  const [state, setState] = useState({ incidents: [], open: 0, total: 0, loading: true });
  const [toast, showErr, showOk, clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();

  const load = async () => {
    try { const r = await getSecurityIncidents(); setState({ incidents: r?.data?.incidents || [], open: r?.data?.open || 0, total: r?.data?.total || 0, loading: false }); }
    catch (e) { setState({ incidents: [], open: 0, total: 0, loading: false }); showErr((e && e.message) || 'Failed to load incidents'); }
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
    </div>`;
}
