/**
 * @file public/views/admin/packages-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin Packages page in the poster face (design canvas "AIMEAT Admin Packages").
 *   Six numbered sections instead of four sub-tabs: what is here, the packages with what is inside
 *   each one, the instances, the store listings, the review board, and re-seeding the examples.
 *   Every count comes from the response's `total` rather than the length of the page fetched.
 *   Drawn only from library components: the page passes data and writes no class.
 *
 * @structure
 *   - PackagesAdminTab() — loads the four lists and renders the six sections
 *   - partChips(components) — `type ×N` chips for what a package installs
 *   - Suspend: a reason field opened on the listing's own row
 *   - ReviewBoard lives in packages-tab.review.js
 *
 * @version-history
 *   v3.0.0 — 2026-09-27 — Library components only (Jouni, 2026-09-22: "all admin pages onto the
 *     shared set"): the sections are Section, the status column Verdict with Readings, the strip
 *     FigureStrip (a coral figure for the installs, as before), the tables List with main's columns
 *     (each cell says its column on a phone: List labels), the parts the Name's marks, the store's
 *     three status chips a filter Tabs row with their counts, the suspend reason a TextField in the
 *     row's Panel, the doors Action and Loud. admin-packages.css goes.
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
import { h, Fragment } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { onLiveUpdate } from '/lib/live-updates.js';
import { t } from '/js/i18n.js';
import { num, when, Row, Badge, Spinner, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { Section } from '/components/Section.js';
import { Note } from '/components/Note.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Verdict } from '/components/Readings.js';
import { List, Row as ListRow, Name, Cell, Num, Doors } from '/components/List.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { TextField } from '/components/TextField.js';
import { Tabs } from '/components/Tabs.js';
import { Stack } from '/components/Layout.js';
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

  /** Publishing a new version is still a write every installer sees, so it says what and asks first.
   *  The three lines stand under each other (the dialog puts the question in one paragraph). */
  function askSeed() {
    const body = html`<${Stack}>
      ${P('seedAskBody')}
      <${Note}>${P('seedAskArchives')}<//>
      <${Note}>${P('seedAskKeeps')}<//>
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

  /** The reason field opened on a listed listing's own row. */
  const suspendPanel = (tpl) => html`
    <${TextField} label=${P('suspendReasonLabel')} value=${suspendReason} onInput=${setSuspendReason}
      placeholder=${P('suspendReasonPlaceholder')} />
    <${Actions}><${Loud} control onClick=${() => doSuspend(tpl.id)}>${P('suspendConfirm')}<//><//>
    <${Note}>${P('suspendNote')}<//>`;

  return html`
    <${Fragment}>
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

      <${Section} first num="01" title=${P('now')}>
        <${Verdict} word=${P('statusPackages', { n: num(totals.packages) })} line=${statusLine}
          stamp=${oldest ? P('oldest', { when: when(oldest) }) : ''}>
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
            value=${pendingCount ? P('nWaiting', { n: num(pendingCount) }) : P('nothing')} last=${true} />
        <//>
      <//>

      <${FigureStrip} items=${[
        { n: num(totals.packages), label: P('stripPackages'), sub: P('stripPackagesSub') },
        { n: num(totals.templates), label: P('stripListings'), sub: P('stripListingsSub') },
        { n: num(totals.instances), tone: totals.instances ? 'notice' : undefined, label: P('stripInstalled'), sub: P('stripInstalledSub') },
        { n: num(pendingCount), label: P('stripWaiting'), sub: pendingCount ? P('stripWaitingSome') : P('stripWaitingNone') },
      ]} />

      <${Section} num="02" title=${P('packages')}>
        <${Note} kind="lead">${P('packagesLead')}<//>
        <${List} cols="name-ver-kind-n-state" labels stackWide empty=${P('noPackages')}
          head=${[P('colPackage'), P('colVersion'), P('colCategory'), { label: P('colInstalls'), num: true }, P('colStatus')]}>
          ${packages.map((p) => {
      const n = installsOf(p);
      return html`
            <${ListRow} key=${p.id || p.packageGroupId}>
              <${Name} meta=${p.packageGroupId || ''} desc=${p.description || null} marks=${partChips(p.components)}>${p.name}<//>
              <${Cell} meta>${p.version || '–'}<//>
              <${Cell}>${p.category || '–'}<//>
              <${Num} dim=${!n}>${num(n)}<//>
              <${Cell}><${Badge} type=${p.status === 'published' ? 'healthy' : 'muted'} label=${p.status} /><//>
            <//>`;
    })}
        <//>
        ${packages.length > 0 && html`<${Note}>${P('packagesNote')}<//>`}
      <//>

      <${Section} num="03" title=${P('installed')}>
        ${instances.length > 0 && html`<${Note} kind="lead">${P('installedLead')}<//>`}
        <${List} cols="name-id-who-ver-n-when" labels stackWide empty=${P('noInstances')}
          head=${[P('colLabel'), P('colPackage'), P('colOwner'), P('colVersionTaken'), P('colParts'), P('colInstalledAt')]}>
          ${instances.map((inst) => html`
            <${ListRow} key=${inst.id}>
              <${Name}>${inst.label || '–'}<//>
              <${Cell} meta>${inst.packageGroupId || '–'}<//>
              <${Cell} meta>${inst.owner || '–'}<//>
              <${Cell} meta>${inst.packageVersion || '–'}<//>
              <${Cell} meta>${num(inst.installedComponents?.length ?? 0)}<//>
              <${Cell} meta>${when(inst.installedAt)}<//>
            <//>`)}
        <//>
      <//>

      <${Section} num="04" title=${P('store')} doors=${html`
        <${Tabs} tone="filter" value=${storeStatus} onSelect=${showStore}
          items=${STORE_FILTERS.map((s) => ({ value: s, label: P('filter_' + s), count: num(storeCounts[s] ?? 0),
            disabled: storeCounts[s] === 0 && s !== LISTED }))} />`}>
        ${shownListings.length > 0 && html`<${Note} kind="lead">${storeStatus === LISTED ? P('storeLead') : P('storeLeadOther')}<//>`}
        <${List} cols="name-id-score-n-mark-doors" labels stackWide empty=${storeStatus === LISTED ? P('noListings') : P('noneInStatus')}
          head=${[P('colListing'), P('colPackage'), P('colRating'), { label: P('colInstalls'), num: true }, P('colFeatured'), '']}>
          ${shownListings.map((tpl) => html`
            <${ListRow} key=${tpl.id} open=${suspendId === tpl.id} panel=${suspendPanel(tpl)}>
              <${Name} after=${tpl.status !== LISTED ? html` <${Badge} type=${tpl.status === 'rejected' ? 'critical' : 'watch'} label=${tpl.status} />` : null}>
                ${tpl.title || tpl.name || '–'}<//>
              <${Cell} meta>${tpl.packageGroupId || tpl.packageName || '–'}<//>
              <${Cell} meta>${tpl.reviewCount ? `${tpl.rating?.toFixed(1) ?? '0.0'} (${tpl.reviewCount})` : P('noRating')}<//>
              <${Num}>${num(tpl.installCount ?? 0)}<//>
              <${Cell}>${tpl.featured ? '✓' : '–'}<//>
              <${Doors}>${tpl.status === LISTED
      ? html`<${Action} small soft tone="danger" expanded=${suspendId === tpl.id}
                  onClick=${() => { setSuspendId(suspendId === tpl.id ? null : tpl.id); setSuspendReason(''); }}>
                  ${suspendId === tpl.id ? P('cancel') : P('suspendBtn')}<//>`
      : (tpl.status === 'suspended'
        ? html`<${Action} small soft onClick=${() => doRelist(tpl.id)}>${P('relistBtn')}<//>`
        : null)}<//>
            <//>`)}
        <//>
      <//>

      <${Section} num="05" title=${P('review')}
        doors=${pendingCount > 0 ? html`<${Badge} type="watch" label=${P('nWaiting', { n: num(pendingCount) })} />` : null}>
        <${ReviewBoard} pending=${pending} history=${history} onReload=${loadData} />
      <//>

      <${Section} num="06" title=${P('examples')}>
        <${Note} kind="lead">${P('examplesLead')}<//>
        <${Row} title=${P('rowArchives')} why=${P('rowArchivesWhy')} value=${P('systemPackages')} />
        <${Row} title=${P('rowKeeps')} why=${P('rowKeepsWhy')}
          value=${P('systemListings')} last=${true} />
        <${Actions}>
          <${Loud} control disabled=${seeding} onClick=${askSeed}>
            ${seeding ? t('dashboard.loading') : P('seedBtn')}<//>
          <${Note} kind="hint" slab inline>${P('seedAsks')}<//>
        <//>
        ${said && html`<${Note} kind="message" error=${!said.ok}>${said.msg}<//>`}
      <//>

      <${ConfirmUI} />
    <//>
  `;
}
