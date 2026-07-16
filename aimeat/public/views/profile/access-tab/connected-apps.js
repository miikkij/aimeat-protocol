/**
 * @file views/profile/access-tab/connected-apps.js
 * @description Connected Apps section (H-2 app grants) — list + revoke the
 *   scoped, user-approved access tokens published apps hold. Extracted from
 *   access-tab.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from access-tab.js (max-file-lines)
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { useConfirm } from '/components/Modal.js';
import { apiGet, apiDelete } from '/js/api.js';

// Apps the owner has explicitly granted scoped access to (the H-2 app-grant flow). Each
// holds its OWN revocable token bound to a narrow scope set — never the login session.
export function ConnectedAppsSection({ showToast, initial }) {
  const { confirm, ConfirmUI } = useConfirm();
  // `initial` (the app-grants slice of GET /v1/access/overview) seeds us so the mount does no fetch of
  // its own; live-update + post-revoke still reload via the individual endpoint. Absent → self-load.
  const [grants, setGrants] = useState(initial?.grants ?? null);

  const load = useCallback(async () => {
    try { const r = await apiGet('/v1/app-grants'); setGrants(r.data?.grants || []); }
    catch { setGrants([]); }
  }, []);
  useEffect(() => { if (!initial) load(); }, [load]);   // eslint-disable-line react-hooks/exhaustive-deps -- seed once from `initial`; fetch only when unseeded

  const liveRef = useRef(load);
  liveRef.current = load;
  useEffect(() => {
    const handler = () => liveRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  const handleRevoke = useCallback((id, name) => {
    confirm(
      (t('profile.access.agConfirmRevoke') || 'Revoke access for "{name}"? It loses access immediately.').replace('{name}', name),
      async () => {
        try {
          await apiDelete('/v1/app-grants/' + id);
          showToast(t('profile.access.agRevoked') || 'App access revoked');
          load();
        } catch (e) { showToast(e.message); }
      },
      { danger: true },
    );
  }, [confirm, showToast, load]);

  return html`
    <h3 class="card-h3 access-h3 mt-section">${t('profile.access.agTitle') || 'Connected Apps'}</h3>
    <div class="section-desc">${t('profile.access.agDesc') || 'Published apps you have granted scoped access to your data. Each holds its own revocable token — never your login session.'}</div>

    ${grants === null
      ? html`<div class="empty">${t('profile.access.agLoading') || 'Loading...'}</div>`
      : grants.length === 0
        ? html`<div class="access-empty-row"><span class="text-meta-sm">${t('profile.access.agEmpty') || 'No apps have access to your data.'}</span></div>`
        : grants.map(g => html`
            <div class="card" key=${g.grant_id}>
              <div class="flex-between">
                <div class="card-title">${escHtml(g.app_name || g.app)}</div>
                <span class="badge badge-info">${(g.scopes || []).length} ${t('profile.access.agScopes') || 'scopes'}</span>
              </div>
              <div class="card-subtitle access-mono">${escHtml(g.app_origin || '')}</div>
              <div class="detail-grid">
                <div class="detail-item"><span class="detail-label">${t('profile.access.agGrantedAt') || 'Granted'}</span><span class="detail-value">${g.granted_at ? new Date(g.granted_at).toLocaleDateString() : '-'}</span></div>
                <div class="detail-item"><span class="detail-label">${t('profile.access.agLastUsed') || 'Last used'}</span><span class="detail-value">${g.last_used_at ? new Date(g.last_used_at).toLocaleString() : (t('profile.access.agNever') || 'never')}</span></div>
              </div>
              ${(g.scopes || []).length > 0 && html`
                <div class="flex-row-wrap mt-half">
                  ${g.scopes.map(s => html`<span class="badge badge-muted" key=${s}>${escHtml(s)}</span>`)}
                </div>
              `}
              <div class="card-actions">
                <button class="btn-danger-solid btn-sm" onClick=${() => handleRevoke(g.grant_id, g.app_name || g.app)}>${t('profile.access.agRevoke') || 'Revoke'}</button>
              </div>
            </div>
          `)
    }
    <${ConfirmUI} />
  `;
}
