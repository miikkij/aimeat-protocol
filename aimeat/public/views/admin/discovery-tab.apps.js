/**
 * @file discovery-tab.apps.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's view of every published app's search visibility, and the two controls
 *   over it: block one app, and — where the node is set to review — approve or refuse a request.
 *
 *   The mode selector sits at the top because it decides what the column below MEANS. On `owner`
 *   the state column is a report of what each owner chose; on `review` it is a queue. An operator
 *   reading "pending" without knowing which mode they are in cannot tell whether they are looking at
 *   work.
 *
 *   The block is deliberately narrower than the Applications tab's hide: a blocked app stays
 *   published, listed, usable and shareable by link, and only stops being findable in a search
 *   engine. Taking an app away from its users is not the proportionate answer to somebody farming
 *   keywords on the operator's domain, and having only the big instrument meant reaching for it.
 *
 * @structure DiscoveryApps({ status, onChanged }) — mode selector, filter, table, block modal
 * @usage <${DiscoveryApps} status=${status} onChanged=${load} />
 * @version-history
 *   v1.0.0 — 2026-08-25 — Initial.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Spinner, Empty, Badge, useToast, Toast } from './shared.js';
import { Modal } from '/components/Modal.js';
import * as adminService from '/js/services/admin.js';

/** Which badge colour each state reads as. `pending` is amber because it is work, not a problem. */
const STATE_TONE = {
  on: 'green', off: 'grey', pending: 'amber', blocked: 'red', hidden: 'grey', gated: 'grey',
};

export function DiscoveryApps({ status, onChanged }) {
  const [apps, setApps] = useState(null);
  const [query, setQuery] = useState('');
  const [onlyNeedingMe, setOnlyNeedingMe] = useState(false);
  // { owner, filename, name, reason } while the block-reason modal is open
  const [blocking, setBlocking] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, showError, showSuccess, clearToast] = useToast();

  const load = useCallback(async () => {
    try {
      const resp = await adminService.getAdminApps();
      setApps(resp?.data?.apps || []);
    } catch (err) {
      showError(err?.message || String(err));
      setApps([]);
    }
  }, [showError]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const handler = () => { load(); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  const review = status.apps.mode === 'review';

  const filtered = useMemo(() => {
    if (!apps) return [];
    const q = query.trim().toLowerCase();
    return apps.filter(a => {
      // "Needing me" is the queue in review mode and the blocked list otherwise — in both cases,
      // the rows where the operator is the one who has to do something.
      if (onlyNeedingMe && !(review ? a.seo_state === 'pending' : a.seo_state === 'blocked')) return false;
      if (!q) return true;
      return (a.filename || '').toLowerCase().includes(q)
        || (a.owner || '').toLowerCase().includes(q)
        || (a.manifest?.name || '').toLowerCase().includes(q);
    });
  }, [apps, query, onlyNeedingMe, review]);

  const setMode = useCallback(async (mode) => {
    setBusy(true);
    try {
      await adminService.saveConfig([{ path: 'apps.seo_mode', value: mode }]);
      showSuccess(mode === 'review' ? t('dashboard.seo.modeReviewOk') : t('dashboard.seo.modeOwnerOk'));
      await onChanged();
      await load();
    } catch (err) {
      showError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }, [onChanged, load, showSuccess, showError]);

  const doBlock = useCallback(async () => {
    if (!blocking) return;
    setBusy(true);
    try {
      await adminService.blockAppSeo(blocking.owner, blocking.filename, true, blocking.reason?.trim() || undefined);
      showSuccess(t('dashboard.seo.blockedOk'));
      setBlocking(null);
      await onChanged();
      await load();
    } catch (err) {
      showError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }, [blocking, onChanged, load, showSuccess, showError]);

  const act = useCallback(async (fn, okKey) => {
    setBusy(true);
    try {
      await fn();
      showSuccess(t(okKey));
      await onChanged();
      await load();
    } catch (err) {
      showError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }, [onChanged, load, showSuccess, showError]);

  return html`<section class="adm-card">
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <h3>${t('dashboard.seo.appsTitle')}</h3>
    <p class="adm-muted">${t('dashboard.seo.appsIntro')}</p>

    <div class="adm-seo-mode">
      <span class="adm-seo-field-label">${t('dashboard.seo.modeLabel')}</span>
      <div class="adm-seo-mode-options">
        <button class=${review ? 'btn-outline' : 'btn-primary'} disabled=${busy}
                onClick=${() => setMode('owner')}>${t('dashboard.seo.modeOwner')}</button>
        <button class=${review ? 'btn-primary' : 'btn-outline'} disabled=${busy}
                onClick=${() => setMode('review')}>${t('dashboard.seo.modeReview')}</button>
      </div>
      <p class="adm-muted">${review ? t('dashboard.seo.modeReviewHint') : t('dashboard.seo.modeOwnerHint')}</p>
    </div>

    <div class="adm-seo-tally">
      ${['on', 'pending', 'blocked', 'off', 'hidden', 'gated'].map(s => html`
        <span key=${s} class="adm-seo-tally-item">
          <${Badge} type=${STATE_TONE[s]} label=${String(status.apps[s] ?? 0)} />
          ${t(`dashboard.seo.state_${s}`)}
        </span>
      `)}
    </div>

    <div class="adm-seo-filter">
      <input type="search" value=${query} placeholder=${t('dashboard.seo.searchApps')}
             onInput=${e => setQuery(e.target.value)} />
      <label>
        <input type="checkbox" checked=${onlyNeedingMe}
               onChange=${e => setOnlyNeedingMe(e.target.checked)} />
        ${review ? t('dashboard.seo.onlyPending') : t('dashboard.seo.onlyBlocked')}
      </label>
    </div>

    ${apps === null
      ? html`<${Spinner} text=${t('dashboard.seo.loadingApps')} />`
      : filtered.length === 0
        ? html`<${Empty} text=${t('dashboard.seo.noApps')} />`
        : html`<div class="adm-table-scroll"><table class="adm-table">
            <thead><tr>
              <th>${t('dashboard.seo.colApp')}</th>
              <th>${t('dashboard.seo.colOwner')}</th>
              <th>${t('dashboard.seo.colState')}</th>
              <th>${t('dashboard.seo.colActions')}</th>
            </tr></thead>
            <tbody>
              ${filtered.map(a => html`<tr key=${`${a.owner}/${a.filename}`}>
                <td>
                  <strong>${a.manifest?.name || a.filename}</strong>
                  <div class="adm-muted">${a.filename}</div>
                </td>
                <td>${a.owner}</td>
                <td>
                  <${Badge} type=${STATE_TONE[a.seo_state] || 'grey'} label=${t(`dashboard.seo.state_${a.seo_state}`)} />
                  ${a.operator_seo_block_reason
                    ? html`<div class="adm-muted">${a.operator_seo_block_reason}</div>` : null}
                </td>
                <td class="adm-seo-actions">
                  ${a.seo_state === 'blocked'
                    ? html`<button class="btn-outline" disabled=${busy}
                             onClick=${() => act(() => adminService.blockAppSeo(a.owner, a.filename, false), 'dashboard.seo.unblockedOk')}>
                             ${t('dashboard.seo.unblock')}
                           </button>`
                    : html`<button class="btn-danger" disabled=${busy}
                             onClick=${() => setBlocking({ owner: a.owner, filename: a.filename, name: a.manifest?.name || a.filename, reason: '' })}>
                             ${t('dashboard.seo.block')}
                           </button>`}
                  ${review && a.seo_state === 'pending'
                    ? html`<button class="btn-primary" disabled=${busy}
                             onClick=${() => act(() => adminService.approveAppSeo(a.owner, a.filename, true), 'dashboard.seo.approvedOk')}>
                             ${t('dashboard.seo.approve')}
                           </button>`
                    : null}
                  ${review && a.seo_state === 'on'
                    ? html`<button class="btn-ghost" disabled=${busy}
                             onClick=${() => act(() => adminService.approveAppSeo(a.owner, a.filename, false), 'dashboard.seo.withdrawnOk')}>
                             ${t('dashboard.seo.withdraw')}
                           </button>`
                    : null}
                </td>
              </tr>`)}
            </tbody>
          </table></div>`}

    <${Modal} open=${!!blocking} onClose=${() => setBlocking(null)}
              title=${t('dashboard.seo.blockTitle', { name: blocking?.name ?? '' })}>
      ${blocking && html`
        <p>${t('dashboard.seo.blockBody')}</p>
        <label class="adm-seo-field">
          <span class="adm-seo-field-label">${t('dashboard.seo.blockReason')}</span>
          <input type="text" value=${blocking.reason}
                 onInput=${e => setBlocking({ ...blocking, reason: e.target.value })} />
          <span class="adm-seo-field-hint">${t('dashboard.seo.blockReasonHint')}</span>
        </label>
        <div class="adm-seo-actions">
          <button class="btn-danger" disabled=${busy} onClick=${doBlock}>${t('dashboard.seo.block')}</button>
          <button class="btn-ghost" onClick=${() => setBlocking(null)}>${t('dashboard.seo.cancel')}</button>
        </div>
      `}
    <//>
  </section>`;
}
