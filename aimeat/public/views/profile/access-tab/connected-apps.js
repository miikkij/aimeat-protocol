/**
 * @file views/profile/access-tab/connected-apps.js
 * @description Connected Apps section (H-2 app grants) — list + revoke the
 *   scoped, user-approved access tokens published apps hold. Extracted from
 *   access-tab.js to satisfy max-file-lines.
 * @structure ConnectedAppsSection — loads GET /v1/app-grants, sorts by recency,
 *   renders one card per app (scopes collapsed behind their count), single revoke
 *   + a bulk revoke of grants unused for STALE_DAYS.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from access-tab.js (max-file-lines)
 *   v1.1.0 — 2026-07-25 — Readability pass: sort most-recently-used first, collapse the
 *     scope-badge wall behind its count, and add a bulk revoke for long-unused grants.
 *     (The duplicate rows that made this list unreadable are fixed server-side; this
 *     keeps it readable once an owner legitimately connects a couple dozen apps.)
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { useConfirm } from '/components/Modal.js';
import { apiGet, apiDelete } from '/js/api.js';

// A grant untouched for this long is offered for bulk revoke. Long enough that a seasonal app
// (something used a few times a year) is not swept away without the owner meaning to.
const STALE_DAYS = 90;

/** ms since the grant was last used, falling back to when it was granted (never-used grants). */
function idleMs(g, now) {
  const ts = g.last_used_at || g.granted_at;
  const parsed = ts ? Date.parse(ts) : NaN;
  return Number.isNaN(parsed) ? Infinity : now - parsed;
}

// Apps the owner has explicitly granted scoped access to (the H-2 app-grant flow). Each
// holds its OWN revocable token bound to a narrow scope set — never the login session.
export function ConnectedAppsSection({ showToast, initial }) {
  const { confirm, ConfirmUI } = useConfirm();
  // `initial` (the app-grants slice of GET /v1/access/overview) seeds us so the mount does no fetch of
  // its own; live-update + post-revoke still reload via the individual endpoint. Absent → self-load.
  const [grants, setGrants] = useState(initial?.grants ?? null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

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

  // Most recently used first (never-used sink to the bottom by their grant date), so the apps that
  // actually touch the owner's data are the ones they see without scrolling.
  const { sorted, stale } = useMemo(() => {
    const now = Date.now();
    const list = [...(grants || [])].sort((a, b) => idleMs(a, now) - idleMs(b, now));
    return { sorted: list, stale: list.filter(g => idleMs(g, now) > STALE_DAYS * 86400000) };
  }, [grants]);

  const toggleScopes = useCallback((id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
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

  // Bulk revoke of the stale set. Sequential DELETEs against the existing per-grant endpoint (no new
  // API surface); partial failures are reported with the count that did go through, never swallowed.
  const handleRevokeStale = useCallback(() => {
    confirm(
      (t('profile.access.agConfirmRevokeUnused') || 'Revoke access for {count} apps unused for over {days} days? They lose access immediately.')
        .replace('{count}', String(stale.length)).replace('{days}', String(STALE_DAYS)),
      async () => {
        setBusy(true);
        let done = 0, failed = 0;
        for (const g of stale) {
          try { await apiDelete('/v1/app-grants/' + g.grant_id); done++; }
          catch { failed++; }
        }
        setBusy(false);
        showToast(failed
          ? (t('profile.access.agRevokedSome') || '{done} revoked, {failed} failed').replace('{done}', String(done)).replace('{failed}', String(failed))
          : (t('profile.access.agRevokedCount') || '{count} app grants revoked').replace('{count}', String(done)));
        load();
      },
      { danger: true },
    );
  }, [confirm, showToast, load, stale]);

  return html`
    <h3 class="card-h3 access-h3 mt-section">${t('profile.access.agTitle') || 'Connected Apps'}</h3>
    <div class="section-desc">${t('profile.access.agDesc') || 'Published apps you have granted scoped access to your data. Each holds its own revocable token — never your login session.'}</div>

    ${stale.length > 0 && html`
      <div class="access-empty-row">
        <span class="text-meta-sm">
          ${(t('profile.access.agUnusedNote') || '{count} of these have not been used in over {days} days.')
            .replace('{count}', String(stale.length)).replace('{days}', String(STALE_DAYS))}
        </span>
        <button class="btn-outline btn-sm" disabled=${busy} onClick=${handleRevokeStale}>
          ${(t('profile.access.agRevokeUnused') || 'Revoke {count} unused').replace('{count}', String(stale.length))}
        </button>
      </div>
    `}

    ${grants === null
      ? html`<div class="empty">${t('profile.access.agLoading') || 'Loading...'}</div>`
      : sorted.length === 0
        ? html`<div class="access-empty-row"><span class="text-meta-sm">${t('profile.access.agEmpty') || 'No apps have access to your data.'}</span></div>`
        : sorted.map(g => html`
            <div class="card" key=${g.grant_id}>
              <div class="flex-between">
                <div class="card-title">${escHtml(g.app_name || g.app)}</div>
                <button
                  class="badge badge-info ag-scope-toggle"
                  aria-expanded=${expanded.has(g.grant_id) ? 'true' : 'false'}
                  title=${t('profile.access.agScopesToggle') || 'Show or hide the granted permissions'}
                  onClick=${() => toggleScopes(g.grant_id)}
                >${(g.scopes || []).length} ${t('profile.access.agScopes') || 'scopes'}</button>
              </div>
              <div class="card-subtitle access-mono">${escHtml(g.app_origin || '')}</div>
              <div class="detail-grid">
                <div class="detail-item"><span class="detail-label">${t('profile.access.agGrantedAt') || 'Granted'}</span><span class="detail-value">${g.granted_at ? new Date(g.granted_at).toLocaleDateString() : '-'}</span></div>
                <div class="detail-item"><span class="detail-label">${t('profile.access.agLastUsed') || 'Last used'}</span><span class="detail-value">${g.last_used_at ? new Date(g.last_used_at).toLocaleString() : (t('profile.access.agNever') || 'never')}</span></div>
              </div>
              ${expanded.has(g.grant_id) && (g.scopes || []).length > 0 && html`
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
