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
 *   Every part is a library component; the page passes data and writes no class.
 *
 * @version-history
 *   v3.0.0 — 2026-09-27 — Library components only (admin group G2): Tabs (filter) for the mode,
 *     Filters and SearchLine over the list, the List (cut name-where-what-who-when-doors, with its
 *     column labels on a phone) for the applications, More for the foot, Loud and Action for the
 *     buttons, TextField for the reason.
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
import { Badge, useToast, Toast, when } from './shared.js';
import { Modal } from '/components/Modal.js';
import { Section } from '/components/Section.js';
import { Tabs } from '/components/Tabs.js';
import { List, Row, Name, Who, Cell, When, Doors, Filters, Filter, SearchLine, More } from '/components/List.js';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { TextField } from '/components/TextField.js';
import { Row as Line } from '/components/Layout.js';
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

  return html`
    <${Section} id="adm-disc-05" num="05" title=${S('apps.title')}
      doors=${html`
        <${Note} kind="hint" inline>${S('apps.who')}<//>
        <${Tabs} tone="filter" label=${S('apps.who')} disabled=${busy} value=${review ? 'review' : 'owner'} onSelect=${setMode}
          items=${[{ value: 'owner', label: S('apps.modeOwner') }, { value: 'review', label: S('apps.modeReview') }]} />`}>
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <${Note} kind="lead">${S('apps.lead')} ${review ? S('apps.modeReviewHint') : S('apps.modeOwnerHint')}<//>

      <${Line} wrap gap="medium" below="medium">
        <${Filters} label=${S('apps.title')}>
          ${STATES.map(s => html`
            <${Filter} key=${s} on=${only === s} count=${status.apps[s] ?? 0} onClick=${() => { setOnly(only === s ? null : s); setAll(false); }}>
              ${S('apps.state_' + s)}
            <//>`)}
        <//>
        <${SearchLine} find value=${query} placeholder=${S('apps.search')} onInput=${e => { setQuery(e.target.value); setAll(false); }} />
      <//>

      <${List} cols="name-where-what-who-when-doors" labels loading=${apps === null ? S('loadingApps') : undefined}
        empty=${S('apps.noApps')}
        head=${[S('apps.colApp'), S('apps.colOwner'), S('apps.colAddress'), S('apps.colState'), S('apps.colTold'), '']}>
        ${shown.map(a => html`
          <${Row} key=${`${a.owner}/${a.filename}`}>
            <${Name} meta=${a.filename}>${a.manifest?.name || a.filename}<//>
            <${Who}>${a.owner}<//>
            <${Cell} meta>${address(a)}<//>
            <${Cell}>
              <${Badge} type=${STATE_TONE[a.seo_state] || 'muted'} label=${S('apps.state_' + a.seo_state)} />
              ${a.operator_seo_block_reason ? html`<${Note} kind="meta">${a.operator_seo_block_reason}<//>` : null}
            <//>
            <${When}>${told(a)}<//>
            <${Doors}>
              ${review && a.seo_state === 'pending'
                ? html`<${Action} small row soft disabled=${busy}
                    onClick=${() => act(() => adminService.approveAppSeo(a.owner, a.filename, true), 'apps.approvedOk')}>${S('apps.approve')}<//>`
                : null}
              ${review && a.seo_state === 'on'
                ? html`<${Action} small row soft disabled=${busy}
                    onClick=${() => act(() => adminService.approveAppSeo(a.owner, a.filename, false), 'apps.withdrawnOk')}>${S('apps.withdraw')}<//>`
                : null}
              ${a.seo_state === 'blocked'
                ? html`<${Action} small row soft disabled=${busy}
                    onClick=${() => act(() => adminService.blockAppSeo(a.owner, a.filename, false), 'apps.unblockedOk')}>${S('apps.unblock')}<//>`
                : html`<${Action} small row soft tone="danger" disabled=${busy}
                    onClick=${() => setBlocking({ owner: a.owner, filename: a.filename, name: a.manifest?.name || a.filename, reason: '' })}>${S('apps.block')}<//>`}
            <//>
          <//>`)}
      <//>
      ${apps !== null && filtered.length > 0 ? html`
        <${More} note=${S('apps.shown', { n: shown.length, total: filtered.length })}
          label=${all ? S('apps.showFewer') : S('apps.showAll', { n: filtered.length })}
          onMore=${filtered.length > PAGE ? () => setAll(!all) : undefined} />` : null}

      <${Modal} open=${!!blocking} onClose=${() => setBlocking(null)} title=${S('apps.blockTitle', { name: blocking?.name ?? '' })}
        footer=${blocking && html`
          <${Action} onClick=${() => setBlocking(null)}>${S('cancel')}<//>
          <${Loud} control danger disabled=${busy}
            onClick=${() => act(() => adminService.blockAppSeo(blocking.owner, blocking.filename, true, blocking.reason?.trim() || undefined), 'apps.blockedOk')}>${S('apps.block')}<//>`}>
        ${blocking && html`
          <${Note} kind="lead">${S('apps.blockBody')}<//>
          <${TextField} label=${S('apps.blockReason')} value=${blocking.reason} placeholder=${S('apps.blockReasonHint')}
            onInput=${v => setBlocking({ ...blocking, reason: v })} />`}
      <//>
    <//>`;
}
