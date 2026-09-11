/**
 * @file discovery-tab.apps.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Section 05 of the admin Discovery page: every published application's search
 *   visibility, and the two controls over it — stop one, and where the node is set to review,
 *   approve or refuse a request.
 *
 *   The mode chips sit in the section's header because they decide what the state column MEANS.
 *   On `owner` the column is a report of what each owner chose; on `review` it is a queue. The
 *   tally chips are the filters: a person clicks the number they want to see.
 *
 *   The block is deliberately narrower than the Applications tab's hide: a blocked app stays
 *   published, listed, usable and shareable by link, and only stops being findable in a search
 *   engine. Taking an app away from its users is not the proportionate answer to somebody farming
 *   keywords on the operator's domain, and having only the big instrument meant reaching for it.
 *
 * @structure DiscoveryApps({ status, onChanged }) — mode chips, tally filters, search, table, block dialog
 * @usage <${DiscoveryApps} status=${status} onChanged=${load} />
 * @version-history
 *   v2.0.0 — 2026-09-11 — The poster face: mode and tally as chips, the search as an underline
 *     field, the address and last-told columns (the address from the notice plan, the stamp from
 *     seo.announcedAt), twenty-five rows with the rest behind a word.
 *   v1.0.0 — 2026-08-25 — Initial.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Spinner, Badge, useToast, Toast } from './shared.js';
import { Modal } from '/components/Modal.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import * as adminService from '/js/services/admin.js';
import { when } from './discovery-tab.shared.js';
import { swallowed } from '/js/swallowed.js';

const S = (key, params) => t('dashboard.seo.' + key, params);

/** Which badge colour each state reads as. `pending` is amber because it is work, not a problem. */
const STATE_TONE = {
  on: 'healthy', off: 'muted', pending: 'watch', blocked: 'danger', hidden: 'muted', gated: 'muted',
};
const STATES = ['on', 'off', 'pending', 'blocked', 'hidden', 'gated'];
/** How many rows show before the rest are behind a word. */
const PAGE = 25;

export function DiscoveryApps({ status, onChanged }) {
  const [apps, setApps] = useState(null);
  // Origin per "owner/filename" for the findable apps, from the notice plan: the one place that
  // knows which host an app answers on without asking the subdomain table itself.
  const [hosts, setHosts] = useState({});
  const [query, setQuery] = useState('');
  const [only, setOnly] = useState(null);
  const [all, setAll] = useState(false);
  // { owner, filename, name, reason } while the block-reason dialog is open
  const [blocking, setBlocking] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, showError, showSuccess, clearToast] = useToast();

  const load = useCallback(async () => {
    try {
      const [list, plan] = await Promise.all([adminService.getAdminApps(), adminService.getIndexNowPlan('all')]);
      setApps(list?.data?.apps || []);
      const map = {};
      const urls = plan?.data?.urls || [];
      for (const a of plan?.data?.apps || []) {
        if (!a.subdomain) continue;
        const u = urls.find((x) => x.startsWith(`https://${a.subdomain}.`));
        if (u) map[`${a.owner}/${a.filename}`] = u.replace(/^https?:\/\//, '').replace(/\/$/, '');
      }
      setHosts(map);
    } catch (err) {
      swallowed('discovery apps: load', err);
      showError(err?.message || String(err));
      setApps([]);
    }
  }, [showError]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => onLiveUpdate(['apps'], () => load()), [load]);

  const review = status.apps.mode === 'review';

  const filtered = useMemo(() => {
    if (!apps) return [];
    const q = query.trim().toLowerCase();
    return apps.filter(a => {
      if (only && a.seo_state !== only) return false;
      if (!q) return true;
      return (a.filename || '').toLowerCase().includes(q)
        || (a.owner || '').toLowerCase().includes(q)
        || (a.manifest?.name || '').toLowerCase().includes(q);
    });
  }, [apps, query, only]);
  const shown = all ? filtered : filtered.slice(0, PAGE);

  const setMode = useCallback(async (mode) => {
    if ((mode === 'review') === review) return;
    setBusy(true);
    try {
      await adminService.saveConfig([{ path: 'apps.seo_mode', value: mode }]);
      showSuccess(mode === 'review' ? S('apps.modeReviewOk') : S('apps.modeOwnerOk'));
      await onChanged();
      await load();
    } catch (err) {
      showError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }, [review, onChanged, load, showSuccess, showError]);

  const act = useCallback(async (fn, okKey) => {
    setBusy(true);
    try {
      await fn();
      showSuccess(S(okKey));
      setBlocking(null);
      await onChanged();
      await load();
    } catch (err) {
      showError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }, [onChanged, load, showSuccess, showError]);

  const address = (a) => hosts[`${a.owner}/${a.filename}`] || `/v1/apps/${a.owner}/${a.filename}`;
  const told = (a) => {
    const at = a.manifest?.seo?.announcedAt;
    if (at) return when(at);
    return a.seo_state === 'on' ? S('apps.never') : '—';
  };

  return html`
    <section class="og-sec" id="adm-disc-05">
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <div class="og-sec-h"><h2>${S('apps.title')}<small>05</small></h2>
        <div class="adm-disc-chips">
          <span class="adm-disc-chips-lbl">${S('apps.who')}</span>
          <button type="button" class="adm-disc-fchip ${review ? '' : 'on'}" disabled=${busy} onClick=${() => setMode('owner')}>${S('apps.modeOwner')}</button>
          <button type="button" class="adm-disc-fchip ${review ? 'on' : ''}" disabled=${busy} onClick=${() => setMode('review')}>${S('apps.modeReview')}</button>
        </div></div>
      <p class="adm-disc-lead">${S('apps.lead')} ${review ? S('apps.modeReviewHint') : S('apps.modeOwnerHint')}</p>

      <div class="adm-disc-filters">
        ${STATES.map(s => html`
          <button type="button" key=${s} class="adm-disc-fchip ${only === s ? 'on' : ''}" onClick=${() => { setOnly(only === s ? null : s); setAll(false); }}>
            ${status.apps[s] ?? 0} ${S('apps.state_' + s)}
          </button>`)}
        <span class="adm-disc-sep"></span>
        <div class="adm-disc-fld">
          <svg viewBox="0 0 24 24" aria-hidden="true" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>
          <input type="search" value=${query} placeholder=${S('apps.search')} onInput=${e => { setQuery(e.target.value); setAll(false); }} />
        </div>
      </div>

      ${apps === null
        ? html`<${Spinner} text=${S('loadingApps')} />`
        : filtered.length === 0
          ? html`<div class="adm-disc-empty">${S('apps.noApps')}</div>`
          : html`<div class="adm-table-scroll"><table class="adm-table adm-disc-tbl">
              <thead><tr>
                <th>${S('apps.colApp')}</th><th>${S('apps.colOwner')}</th><th>${S('apps.colAddress')}</th>
                <th>${S('apps.colState')}</th><th>${S('apps.colTold')}</th><th></th>
              </tr></thead>
              <tbody>
                ${shown.map(a => html`<tr key=${`${a.owner}/${a.filename}`}>
                  <td><b>${a.manifest?.name || a.filename}</b><span class="adm-disc-why adm-disc-mono">${a.filename}</span></td>
                  <td>${a.owner}</td>
                  <td class="adm-disc-addr">${address(a)}</td>
                  <td>
                    <${Badge} type=${STATE_TONE[a.seo_state] || 'muted'} label=${S('apps.state_' + a.seo_state)} />
                    ${a.operator_seo_block_reason ? html`<span class="adm-disc-why">${a.operator_seo_block_reason}</span>` : null}
                  </td>
                  <td class="adm-disc-when">${told(a)}</td>
                  <td class="adm-disc-do">
                    ${review && a.seo_state === 'pending'
                      ? html`<button type="button" class="og-door og-door--quiet" disabled=${busy}
                          onClick=${() => act(() => adminService.approveAppSeo(a.owner, a.filename, true), 'apps.approvedOk')}>${S('apps.approve')}</button> `
                      : null}
                    ${review && a.seo_state === 'on'
                      ? html`<button type="button" class="og-door og-door--quiet" disabled=${busy}
                          onClick=${() => act(() => adminService.approveAppSeo(a.owner, a.filename, false), 'apps.withdrawnOk')}>${S('apps.withdraw')}</button> `
                      : null}
                    ${a.seo_state === 'blocked'
                      ? html`<button type="button" class="og-door og-door--quiet" disabled=${busy}
                          onClick=${() => act(() => adminService.blockAppSeo(a.owner, a.filename, false), 'apps.unblockedOk')}>${S('apps.unblock')}</button>`
                      : html`<button type="button" class="og-door og-door--quiet og-door--danger" disabled=${busy}
                          onClick=${() => setBlocking({ owner: a.owner, filename: a.filename, name: a.manifest?.name || a.filename, reason: '' })}>${S('apps.block')}</button>`}
                  </td>
                </tr>`)}
              </tbody>
            </table></div>`}
      ${apps !== null && filtered.length > 0 ? html`
        <div class="adm-disc-foot">
          <span class="adm-disc-mono">${S('apps.shown', { n: shown.length, total: filtered.length })}</span>
          ${filtered.length > PAGE ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => setAll(!all)}>${all ? S('apps.showFewer') : S('apps.showAll', { n: filtered.length })}</button>` : null}
        </div>` : null}

      <${Modal} open=${!!blocking} onClose=${() => setBlocking(null)} title=${S('apps.blockTitle', { name: blocking?.name ?? '' })}>
        ${blocking && html`
          <p>${S('apps.blockBody')}</p>
          <div class="adm-disc-lbl">${S('apps.blockReason')}</div>
          <div class="adm-disc-fld adm-disc-fld--wide">
            <input type="text" value=${blocking.reason} placeholder=${S('apps.blockReasonHint')}
              onInput=${e => setBlocking({ ...blocking, reason: e.target.value })} />
          </div>
          <div class="adm-disc-acts">
            <button type="button" class="og-slab og-slab--danger" disabled=${busy}
              onClick=${() => act(() => adminService.blockAppSeo(blocking.owner, blocking.filename, true, blocking.reason?.trim() || undefined), 'apps.blockedOk')}>${S('apps.block')}</button>
            <button type="button" class="og-door og-door--quiet" onClick=${() => setBlocking(null)}>${S('cancel')}</button>
          </div>`}
      <//>
    </section>`;
}
