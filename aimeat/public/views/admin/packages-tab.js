/**
 * @file public/views/admin/packages-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin Packages page in the poster face (design canvas "AIMEAT Admin Packages").
 *   Six numbered sections instead of four sub-tabs: what is here, the packages with what is inside
 *   each one, the instances, the store listings, the review board, and re-seeding the examples.
 *   Every count comes from the response's `total` rather than the length of the page fetched.
 *
 * @structure
 *   - PackagesAdminTab() — loads the four lists and renders the six sections
 *   - partChips(components) — `type ×N` chips for what a package installs
 *   - Suspend: a reason field opened on the listing's own row
 *   - ReviewBoard lives in packages-tab.review.js
 *
 * @version-history
 *   v3.0.0 -- 2026-09-22 -- Composed from the shared component set: sections, the metric rows, the
 *     numeral band, three shared tables (stacking on a phone), status filters as tabs, and the
 *     suspend reason in a box under the table naming the listing. The page's own sheet is gone.
 *   v2.2.0 — 2026-09-15 — The example-packages section describes the sync the node now runs: a
 *     changed package gets a new version, the listing and its counts stay, so the confirm is no
 *     longer a danger dialog.
 *   v2.1.0 — 2026-09-13 — Compose existing section headings from shared poster B1.
 *   v2.0.0 — 2026-09-12 — The poster face. The four sub-tabs go: with six packages, six listings
 *     and one instance the whole page fits on one screen, and hiding three quarters of it cost a
 *     click for nothing. The package row shows the description and the parts inside it, which is
 *     what tells an operator whether a package matters. Counts read `total` from the response
 *     instead of counting a 50-row page, so they stop being silently wrong past fifty. Re-seeding
 *     says what it archives and what it deletes (the listing, with its rating and install count)
 *     and asks before it runs; it was a one-click button in the middle of the page.
 *   v1.1.0 — 2026-09-05 — The rating loses its star and the featured cell says ✓: no emoji anywhere in the interface.
 *   v1.0.0 — 2026-03-15 — initial implementation (Phase 6)
 *   v1.1.0 — 2026-03-20 — add template moderation queue subtab
 *   v1.2.0 — 2026-06-02 — Admin design unification: main btn-* classes → adm-btn* (btn-success→adm-btn, btn-danger→adm-btn-action adm-btn-danger), error divs → <ErrorBox>.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { onLiveUpdate } from '/lib/live-updates.js';
import { t } from '/js/i18n.js';
import { num, when, Row, Badge, Spinner, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { Section, Columns, Stack, Table, Field, NumeralBand, Chip, Action, Surface, Text } from '/components/poster-parts.js';
import * as pkgService from '/js/services/packages.js';
import { seedExamples, listPendingTemplates, suspendTemplate, relistTemplate } from '/js/services/admin.js';
import { swallowed } from '/js/swallowed.js';
import { ReviewBoard } from './packages-tab.review.js';

const P = (key, vars) => t('dashboard.pkgPage.' + key, vars);

/** What a package installs, as `type` chips with a count when a type repeats. A name, an author
 *  and a version do not say whether a package matters; an extension, a cortex and two apps do. */
function partChips(components) {
  const counts = {};
  for (const c of components || []) {
    const type = c.type || c.kind || 'part';
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return Object.entries(counts).map(([type, n]) => (n > 1 ? `${type} ×${n}` : type));
}

/** A listing's life: pending_review, then listed or rejected, and a listed one can be suspended.
 *  The card-face page filtered its published list on approved|published|active, none of which a
 *  listing has ever had, so that section was empty on every node and looked like an empty store. */
const LISTED = 'listed';
/** The three the store section can show. pending_review is section 05's, not this one's. */
const STORE_FILTERS = ['listed', 'suspended', 'rejected'];

export default function PackagesAdminTab() {
  const [packages, setPackages] = useState([]);
  const [instances, setInstances] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [pending, setPending] = useState([]);
  const [history, setHistory] = useState([]);
  // The response says how many there are; the array is at most one page of them. Counting the
  // array made every number on this page silently wrong past the fifty it fetches.
  const [totals, setTotals] = useState({ packages: 0, instances: 0, templates: 0 });
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [said, setSaid] = useState(null);
  const [suspendId, setSuspendId] = useState(null);
  const [suspendReason, setSuspendReason] = useState('');
  // Section 04 shows one status at a time. A suspended listing used to be invisible at every door,
  // so the counts are fetched for all three and the chips say how many there are before you press.
  const [storeStatus, setStoreStatus] = useState(LISTED);
  const [storeRows, setStoreRows] = useState([]);
  const [storeCounts, setStoreCounts] = useState({ listed: 0, suspended: 0, rejected: 0 });
  const { confirm, ConfirmUI } = useConfirm();
  const [toast, showErr, showOk, clearToast] = useToast();

  const loadData = useCallback(async ({ showSpinner = true } = {}) => {
    if (showSpinner) setLoading(true);
    try {
      const [pkgRes, instRes, tplRes, pendRes] = await Promise.all([
        pkgService.listPackages({ limit: 50 }),
        pkgService.listInstances({ limit: 50 }),
        pkgService.listTemplates({ limit: 50 }),
        listPendingTemplates().catch(() => ({ ok: false })),
      ]);
      const next = { packages: 0, instances: 0, templates: 0 };
      if (pkgRes.ok !== false) {
        const rows = pkgRes.data?.packages ?? [];
        setPackages(rows);
        next.packages = pkgRes.data?.total ?? rows.length;
      }
      if (instRes.ok !== false) {
        const rows = instRes.data?.instances ?? [];
        setInstances(rows);
        next.instances = instRes.data?.total ?? rows.length;
      }
      if (tplRes.ok !== false) {
        const rows = tplRes.data?.listings ?? tplRes.data?.templates ?? [];
        setTemplates(rows);
        next.templates = tplRes.data?.total ?? rows.length;
      }
      // One request per status, limit 1, read for the total alone. Three cheap reads buy chips
      // that say what is behind them rather than making the operator press to find out.
      const counts = { listed: next.templates, suspended: 0, rejected: 0 };
      for (const status of ['suspended', 'rejected']) {
        const r = await pkgService.listTemplates({ limit: 1, status }).catch(() => ({ ok: false }));
        if (r.ok !== false) counts[status] = r.data?.total ?? 0;
      }
      setStoreCounts(counts);
      setTotals(next);
      if (pendRes.ok !== false) {
        setPending(pendRes.data?.pending ?? pendRes.data?.templates ?? []);
        setHistory(pendRes.data?.history ?? []);
      }
    } catch (err) { swallowed('packages-tab: load', err); }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => onLiveUpdate(['packages'], () => loadData({ showSpinner: false })), [loadData]);

  if (loading) return html`<${Spinner} text=${t('dashboard.loading')} />`;

  const pendingCount = pending.length;
  const installsOf = (pkg) => instances.filter((i) => i.packageGroupId === pkg.packageGroupId).length;
  const publishedCount = packages.filter((p) => p.status === 'published').length;
  const listedCount = templates.filter((tpl) => tpl.status === LISTED).length;
  const installedPackages = new Set(instances.map((i) => i.packageGroupId).filter(Boolean)).size;
  const oldest = packages.reduce((min, p) => (!min || String(p.createdAt) < min ? String(p.createdAt) : min), '');
  const shownListings = storeStatus === LISTED ? templates : storeRows;

  /** Publishing a new version is still a write every installer sees, so it says what and asks first. */
  function askSeed() {
    const body = html`<${Stack} density="compact">
      <${Text}>${P('seedAskBody')}<//>
      <${Text} kind="caption" tone="muted">${P('seedAskArchives')}<//>
      <${Text} kind="caption" tone="muted">${P('seedAskKeeps')}<//>
    <//>`;
    confirm(body, doSeed, { title: P('seedAskTitle'), confirmLabel: P('seedBtn') });
  }

  async function doSeed() {
    setSeeding(true);
    setSaid(null);
    try {
      const res = await seedExamples();
      if (res.ok === false) setSaid({ ok: false, msg: res.error?.message ?? P('failed') });
      else {
        const names = (res.data?.seeded ?? []).map((s) => s.name);
        setSaid({ ok: true, msg: names.length === 0 ? P('seedNone') : P('seedDone', { n: num(names.length), names: names.join(', ') }) });
        loadData();
      }
    } catch (e) { setSaid({ ok: false, msg: e.message }); }
    setSeeding(false);
  }

  /** Show one status in section 04. `listed` is already loaded; the other two are their own read,
   *  which is the door that did not exist before and is why a suspended listing was invisible. */
  async function showStore(status) {
    setStoreStatus(status);
    setSuspendId(null);
    if (status === LISTED) { setStoreRows([]); return; }
    const r = await pkgService.listTemplates({ limit: 50, status }).catch(() => ({ ok: false }));
    setStoreRows(r.ok === false ? [] : (r.data?.listings ?? r.data?.templates ?? []));
  }

  async function doSuspend(id) {
    if (!suspendReason.trim()) { showErr(P('reasonRequired')); return; }
    try {
      const res = await suspendTemplate(id, suspendReason);
      if (res.ok === false) showErr(res.error?.message || P('failed'));
      else { setSuspendId(null); setSuspendReason(''); showOk(P('suspended')); loadData(); showStore(storeStatus); }
    } catch (e) { showErr(e.message); }
  }

  async function doRelist(id) {
    try {
      const res = await relistTemplate(id);
      if (res.ok === false) showErr(res.error?.message || P('failed'));
      else { showOk(P('relisted')); loadData(); showStore(storeStatus); }
    } catch (e) { showErr(e.message); }
  }

  const statusLine = totals.packages === 0
    ? P('lineNone')
    : P('lineSome', { published: num(publishedCount), listed: num(listedCount), installed: num(installedPackages) });

  const suspending = suspendId && shownListings.find((tpl) => tpl.id === suspendId);

  return html`<${Stack}>
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

    <${Section} title=${P('now')} count="01">
      <${Columns} layout="trailing" collapse=${900}>
        <${Stack} density="compact">
          <${Text} kind="number" size="large">${P('statusPackages', { n: num(totals.packages) })}<//>
          <${Text} kind="lead">${statusLine}<//>
          <${Text} kind="mono" tone="muted">${oldest ? P('oldest', { when: when(oldest) }) : ''}<//>
        <//>
        <div>
          <${Row} title=${P('rowPublished')} why=${P('rowPublishedWhy')}
            chip=${html`<${Badge} type=${publishedCount ? 'healthy' : 'muted'} label=${num(publishedCount)} />`}
            value=${P('ofAll', { n: num(publishedCount), all: num(totals.packages) })} />
          <${Row} title=${P('rowListed')} why=${P('rowListedWhy')}
            chip=${html`<${Badge} type=${listedCount ? 'healthy' : 'muted'} label=${num(listedCount)} />`}
            value=${P('ofAll', { n: num(listedCount), all: num(totals.packages) })} />
          <${Row} title=${P('rowInstalled')} why=${P('rowInstalledWhy')}
            chip=${html`<${Badge} type="muted" label=${num(totals.instances)} />`}
            value=${P('ofAllPackages', { n: num(installedPackages), all: num(totals.packages) })} />
          <${Row} title=${P('rowWaiting')} why=${P('rowWaitingWhy')}
            chip=${html`<${Badge} type=${pendingCount ? 'watch' : 'muted'} label=${num(pendingCount)} />`}
            value=${pendingCount ? P('nWaiting', { n: num(pendingCount) }) : P('nothing')} />
        </div>
      <//>
    <//>

    <${NumeralBand} tone="plain" items=${[
      { label: P('stripPackages'), value: num(totals.packages), note: P('stripPackagesSub') },
      { label: P('stripListings'), value: num(totals.templates), note: P('stripListingsSub') },
      { label: P('stripInstalled'), value: num(totals.instances), note: P('stripInstalledSub'), tone: totals.instances ? 'coral' : undefined },
      { label: P('stripWaiting'), value: num(pendingCount), note: pendingCount ? P('stripWaitingSome') : P('stripWaitingNone') },
    ]} />

    <${Section} title=${P('packages')} count="02" description=${P('packagesLead')}>
      ${!packages.length
        ? html`<${Text} tone="muted">${P('noPackages')}<//>`
        : html`<${Stack}>
          <${Table} collapse=${900} label=${P('packages')}
            headers=${[P('colPackage'), P('colVersion'), P('colCategory'), P('colInstalls'), P('colStatus')]}
            rows=${packages.map((p) => {
              const chips = partChips(p.components);
              const n = installsOf(p);
              return [
                html`<${Stack} density="compact">
                  <strong>${p.name}</strong>
                  <${Text} kind="mono" tone="muted">${p.packageGroupId || ''}<//>
                  ${p.description ? html`<${Text} kind="caption">${p.description}<//>` : null}
                  ${chips.length ? html`<${Stack} direction="wrap" density="compact">${chips.map((c) => html`<${Chip} key=${c}>${c}<//>`)}<//>` : null}
                <//>`,
                { text: p.version || '–', mono: true },
                p.category || '–',
                html`<${Text} kind="number" size="small" tone=${n ? 'plain' : 'muted'}>${num(n)}<//>`,
                html`<${Badge} type=${p.status === 'published' ? 'healthy' : 'muted'} label=${p.status} />`,
              ];
            })} />
          <${Text} kind="caption" tone="muted">${P('packagesNote')}<//>
        <//>`}
    <//>

    <${Section} title=${P('installed')} count="03" description=${instances.length ? P('installedLead') : null}>
      ${!instances.length
        ? html`<${Text} tone="muted">${P('noInstances')}<//>`
        : html`<${Table} collapse=${900} label=${P('installed')}
          headers=${[P('colLabel'), P('colPackage'), P('colOwner'), P('colVersionTaken'), P('colParts'), P('colInstalledAt')]}
          rows=${instances.map((inst) => [
            html`<strong>${inst.label || '–'}</strong>`,
            { text: inst.packageGroupId || '–', mono: true },
            { text: inst.owner || '–', mono: true },
            { text: inst.packageVersion || '–', mono: true },
            { text: num(inst.installedComponents?.length ?? 0), mono: true },
            { text: when(inst.installedAt), mono: true },
          ])} />`}
    <//>

    <${Section} title=${P('store')} count="04" description=${shownListings.length ? (storeStatus === LISTED ? P('storeLead') : P('storeLeadOther')) : null}
      actions=${STORE_FILTERS.map((st) => html`<${Action} key=${st} kind="tab" selected=${storeStatus === st}
        disabled=${storeCounts[st] === 0 && st !== LISTED} onClick=${() => showStore(st)}>
        ${P('filter_' + st)} · ${num(storeCounts[st] ?? 0)}<//>`)}>
      ${!shownListings.length
        ? html`<${Text} tone="muted">${storeStatus === LISTED ? P('noListings') : P('noneInStatus')}<//>`
        : html`<${Stack}>
          <${Table} collapse=${900} label=${P('store')}
            headers=${[P('colListing'), P('colPackage'), P('colRating'), P('colInstalls'), P('colFeatured'), '']}
            rows=${shownListings.map((tpl) => [
              html`<${Stack} direction="wrap" align="center" density="compact"><strong>${tpl.title || tpl.name || '–'}</strong>
                ${tpl.status !== LISTED ? html`<${Badge} type=${tpl.status === 'rejected' ? 'critical' : 'watch'} label=${tpl.status} />` : null}<//>`,
              { text: tpl.packageGroupId || tpl.packageName || '–', mono: true },
              { text: tpl.reviewCount ? `${tpl.rating?.toFixed(1) ?? '0.0'} (${tpl.reviewCount})` : P('noRating'), mono: true },
              { text: num(tpl.installCount ?? 0), mono: true },
              tpl.featured ? '✓' : '–',
              tpl.status === LISTED
                ? html`<${Action} tone="danger" expanded=${suspendId === tpl.id}
                    onClick=${() => { setSuspendId(suspendId === tpl.id ? null : tpl.id); setSuspendReason(''); }}>
                    ${suspendId === tpl.id ? P('cancel') : P('suspendBtn')}<//>`
                : (tpl.status === 'suspended'
                  ? html`<${Action} onClick=${() => doRelist(tpl.id)}>${P('relistBtn')}<//>`
                  : ''),
            ])} />
          ${suspending && html`<${Surface} kind="box"><${Stack}>
            <${Text} kind="heading" size="small">${suspending.title || suspending.name || '–'}<//>
            <${Field} label=${P('suspendReasonLabel')} value=${suspendReason} autoFocus=${true}
              placeholder=${P('suspendReasonPlaceholder')} onInput=${(e) => setSuspendReason(e.target.value)} />
            <${Stack} direction="horizontal">
              <${Action} kind="primary" tone="danger" onClick=${() => doSuspend(suspending.id)}>${P('suspendConfirm')}<//>
            <//>
            <${Text} kind="caption" tone="muted">${P('suspendNote')}<//>
          <//><//>`}
        <//>`}
    <//>

    <${Section} title=${P('review')} count="05"
      actions=${pendingCount > 0 ? html`<${Badge} type="watch" label=${P('nWaiting', { n: num(pendingCount) })} />` : null}>
      <${ReviewBoard} pending=${pending} history=${history} onReload=${loadData} />
    <//>

    <${Section} title=${P('examples')} count="06" description=${P('examplesLead')}>
      <${Stack}>
        <div>
          <${Row} title=${P('rowArchives')} why=${P('rowArchivesWhy')} value=${P('systemPackages')} />
          <${Row} title=${P('rowKeeps')} why=${P('rowKeepsWhy')} value=${P('systemListings')} />
        </div>
        <${Stack} direction="wrap" align="center">
          <${Action} kind="primary" disabled=${seeding} onClick=${askSeed}>
            ${seeding ? t('dashboard.loading') : P('seedBtn')}<//>
          <${Text} kind="caption" tone="muted">${P('seedAsks')}<//>
        <//>
        ${said && html`<${Text} tone=${said.ok ? 'success' : 'danger'}>${said.msg}<//>`}
      <//>
    <//>

    <${ConfirmUI} />
  <//>`;
}
