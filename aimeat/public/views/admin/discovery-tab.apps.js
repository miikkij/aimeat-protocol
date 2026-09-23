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
 *   v2.2.0 -- 2026-09-22 -- Composed from the shared component set: the mode as radio tabs in the
 *     section's head, the tallies and the search as the shared toolbar, the list as a shared table
 *     that stacks on a phone, the block reason in the shared dialog; no sheet of its own.
 *   v2.1.0 — 2026-09-13 — Compose section headings from the shared poster B1 shape.
 *   v2.0.1 — 2026-09-13 — The block dialog's actions sit in the dialog's footer.
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
import { Spinner, Empty, Badge, useToast, Toast, when } from './shared.js';
import { Section, Stack, Text, Action, Toolbar, Table, Field, Dialog } from '/components/poster-parts.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import * as adminService from '/js/services/admin.js';
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

  const doCell = (a) => html`<${Stack} direction="wrap" align="end" density="compact">
    ${review && a.seo_state === 'pending'
      ? html`<${Action} kind="text" tone="success" disabled=${busy}
          onClick=${() => act(() => adminService.approveAppSeo(a.owner, a.filename, true), 'apps.approvedOk')}>${S('apps.approve')}<//>`
      : null}
    ${review && a.seo_state === 'on'
      ? html`<${Action} kind="text" disabled=${busy}
          onClick=${() => act(() => adminService.approveAppSeo(a.owner, a.filename, false), 'apps.withdrawnOk')}>${S('apps.withdraw')}<//>`
      : null}
    ${a.seo_state === 'blocked'
      ? html`<${Action} kind="text" disabled=${busy}
          onClick=${() => act(() => adminService.blockAppSeo(a.owner, a.filename, false), 'apps.unblockedOk')}>${S('apps.unblock')}<//>`
      : html`<${Action} kind="text" tone="danger" disabled=${busy}
          onClick=${() => setBlocking({ owner: a.owner, filename: a.filename, name: a.manifest?.name || a.filename, reason: '' })}>${S('apps.block')}<//>`}
  <//>`;

  return html`
    <${Section} id="adm-disc-05" title=${S('apps.title')} count="05"
      description=${`${S('apps.lead')} ${review ? S('apps.modeReviewHint') : S('apps.modeOwnerHint')}`}
      actions=${html`<${Stack} direction="wrap" align="center" density="compact" role="radiogroup" label=${S('apps.who')}>
        <${Text} kind="caption" tone="muted">${S('apps.who')}<//>
        <${Action} kind="tab" semantics="radio" selected=${!review} disabled=${busy} onClick=${() => setMode('owner')}>${S('apps.modeOwner')}<//>
        <${Action} kind="tab" semantics="radio" selected=${review} disabled=${busy} onClick=${() => setMode('review')}>${S('apps.modeReview')}<//>
      <//>`}>
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

      <${Toolbar} label=${S('apps.title')}
        search=${{ ariaLabel: S('apps.search'), placeholder: S('apps.search'), value: query, onInput: e => { setQuery(e.target.value); setAll(false); } }}
        filters=${STATES.map(s => ({
          id: s, label: `${status.apps[s] ?? 0} ${S('apps.state_' + s)}`, selected: only === s,
          onClick: () => { setOnly(only === s ? null : s); setAll(false); },
        }))} />

      ${apps === null
        ? html`<${Spinner} text=${S('loadingApps')} />`
        : filtered.length === 0
          ? html`<${Empty} text=${S('apps.noApps')} />`
          : html`<${Table} density="compact" collapse=${640} label=${S('apps.title')}
              headers=${[S('apps.colApp'), S('apps.colOwner'), S('apps.colAddress'), S('apps.colState'), S('apps.colTold'), '']}
              rows=${shown.map(a => [
                html`<${Stack} density="compact"><strong>${a.manifest?.name || a.filename}</strong><${Text} kind="mono" tone="muted">${a.filename}<//><//>`,
                a.owner,
                html`<${Text} kind="mono">${address(a)}<//>`,
                html`<${Stack} density="compact">
                  <span><${Badge} type=${STATE_TONE[a.seo_state] || 'muted'} label=${S('apps.state_' + a.seo_state)} /></span>
                  ${a.operator_seo_block_reason ? html`<${Text} kind="caption" tone="muted">${a.operator_seo_block_reason}<//>` : null}
                <//>`,
                { text: told(a), mono: true },
                doCell(a),
              ])} />`}
      ${apps !== null && filtered.length > 0 ? html`
        <${Stack} direction="wrap" align="between">
          <${Text} kind="mono" tone="muted">${S('apps.shown', { n: shown.length, total: filtered.length })}<//>
          ${filtered.length > PAGE ? html`<${Action} onClick=${() => setAll(!all)}>${all ? S('apps.showFewer') : S('apps.showAll', { n: filtered.length })}<//>` : null}
        <//>` : null}

      <${Dialog} open=${!!blocking} onClose=${() => setBlocking(null)} title=${S('apps.blockTitle', { name: blocking?.name ?? '' })}
        actions=${blocking && html`
          <${Action} onClick=${() => setBlocking(null)}>${S('cancel')}<//>
          <${Action} kind="primary" tone="danger" disabled=${busy}
            onClick=${() => act(() => adminService.blockAppSeo(blocking.owner, blocking.filename, true, blocking.reason?.trim() || undefined), 'apps.blockedOk')}>${S('apps.block')}<//>`}>
        ${blocking && html`
          <${Stack}>
            <${Text}>${S('apps.blockBody')}<//>
            <${Field} label=${S('apps.blockReason')} value=${blocking.reason} placeholder=${S('apps.blockReasonHint')}
              onInput=${e => setBlocking({ ...blocking, reason: e.target.value })} />
          <//>`}
      <//>
    <//>`;
}
