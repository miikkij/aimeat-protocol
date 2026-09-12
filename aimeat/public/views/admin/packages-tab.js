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
import { useViewCSS } from '/components/useViewCSS.js';
import { num, when, Row, Badge, Spinner, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import * as pkgService from '/js/services/packages.js';
import { seedExamples, listPendingTemplates, suspendTemplate } from '/js/services/admin.js';
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

export default function PackagesAdminTab() {
  // A no-op these days: the sheet is a <link> in spa.html. The call stays because every other
  // tab makes it, and check:importmap holds the two together.
  useViewCSS('/css/views/admin-packages.css');

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

  /** Re-seeding is a write that throws things away, so it says what and asks first. */
  function askSeed() {
    const body = html`<span>
      <span>${P('seedAskBody')}</span>
      <span class="adm-pk-note">${P('seedAskArchives')}</span>
      <span class="adm-pk-note">${P('seedAskDeletes')}</span>
    </span>`;
    confirm(body, doSeed, { title: P('seedAskTitle'), confirmLabel: P('seedBtn'), danger: true });
  }

  async function doSeed() {
    setSeeding(true);
    setSaid(null);
    try {
      const res = await seedExamples();
      if (res.ok === false) setSaid({ ok: false, msg: res.error?.message ?? P('failed') });
      else {
        const names = (res.data?.seeded ?? []).map((s) => s.name);
        setSaid({ ok: true, msg: P('seedDone', { n: num(names.length), names: names.join(', ') }) });
        loadData();
      }
    } catch (e) { setSaid({ ok: false, msg: e.message }); }
    setSeeding(false);
  }

  async function doSuspend(id) {
    if (!suspendReason.trim()) { showErr(P('reasonRequired')); return; }
    try {
      const res = await suspendTemplate(id, suspendReason);
      if (res.ok === false) showErr(res.error?.message || P('failed'));
      else { setSuspendId(null); setSuspendReason(''); showOk(P('suspended')); loadData(); }
    } catch (e) { showErr(e.message); }
  }

  const statusLine = totals.packages === 0
    ? P('lineNone')
    : P('lineSome', { published: num(publishedCount), listed: num(listedCount), installed: num(installedPackages) });

  return html`
    <div class="og adm-pk">
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

      <section class="og-sec og-sec--first">
        <div class="og-sec-h"><h2>${P('now')}<small>01</small></h2></div>
        <div class="adm-ov-grid">
          <div>
            <div class="adm-ov-status">${P('statusPackages', { n: num(totals.packages) })}</div>
            <p class="adm-alert-line">${statusLine}</p>
            <div class="adm-ov-up">${oldest ? P('oldest', { when: when(oldest) }) : ''}</div>
          </div>
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
              value=${pendingCount ? P('nWaiting', { n: num(pendingCount) }) : P('nothing')} last=${true} />
          </div>
        </div>
      </section>

      <div class="og-strip">
        <div><b>${num(totals.packages)}</b><span>${P('stripPackages')}</span><small>${P('stripPackagesSub')}</small></div>
        <div><b>${num(totals.templates)}</b><span>${P('stripListings')}</span><small>${P('stripListingsSub')}</small></div>
        <div><b class=${totals.instances ? 'og-coral-num' : ''}>${num(totals.instances)}</b><span>${P('stripInstalled')}</span><small>${P('stripInstalledSub')}</small></div>
        <div><b>${num(pendingCount)}</b><span>${P('stripWaiting')}</span><small>${pendingCount ? P('stripWaitingSome') : P('stripWaitingNone')}</small></div>
      </div>

      <section class="og-sec">
        <div class="og-sec-h"><h2>${P('packages')}<small>02</small></h2></div>
        <p class="adm-pk-lead">${P('packagesLead')}</p>
        ${!packages.length
    ? html`<p class="adm-pk-quiet">${P('noPackages')}</p>`
    : html`
        <div class="adm-pk-phead">
          <span>${P('colPackage')}</span><span>${P('colVersion')}</span><span>${P('colCategory')}</span>
          <span>${P('colInstalls')}</span><span>${P('colStatus')}</span>
        </div>
        ${packages.map((p) => {
      const chips = partChips(p.components);
      const n = installsOf(p);
      return html`
          <div class="adm-pk-prow" key=${p.id || p.packageGroupId}>
            <span>
              <b>${p.name}</b>
              <span class="adm-pk-gid">${p.packageGroupId || ''}</span>
              ${p.description ? html`<span class="adm-pk-desc">${p.description}</span>` : null}
              ${chips.length ? html`<span class="adm-pk-parts">${chips.map((c) => html`<span>${c}</span>`)}</span>` : null}
            </span>
            <span class="adm-pk-ver" data-l=${P('colVersion')}>${p.version || '–'}</span>
            <span data-l=${P('colCategory')}>${p.category || '–'}</span>
            <span class="adm-pk-num ${n ? '' : 'is-zero'}" data-l=${P('colInstalls')}>${num(n)}</span>
            <span data-l=${P('colStatus')}><${Badge} type=${p.status === 'published' ? 'healthy' : 'muted'} label=${p.status} /></span>
          </div>`;
    })}
        <p class="adm-pk-note">${P('packagesNote')}</p>`}
      </section>

      <section class="og-sec">
        <div class="og-sec-h"><h2>${P('installed')}<small>03</small></h2></div>
        ${!instances.length
    ? html`<p class="adm-pk-quiet">${P('noInstances')}</p>`
    : html`
        <p class="adm-pk-lead">${P('installedLead')}</p>
        <div class="adm-pk-ihead">
          <span>${P('colLabel')}</span><span>${P('colPackage')}</span><span>${P('colOwner')}</span>
          <span>${P('colVersionTaken')}</span><span>${P('colParts')}</span><span>${P('colInstalledAt')}</span>
        </div>
        ${instances.map((inst) => html`
          <div class="adm-pk-irow" key=${inst.id}>
            <span><b>${inst.label || '–'}</b></span>
            <span class="adm-pk-mono" data-l=${P('colPackage')}>${inst.packageGroupId || '–'}</span>
            <span class="adm-pk-mono" data-l=${P('colOwner')}>${inst.owner || '–'}</span>
            <span class="adm-pk-mono" data-l=${P('colVersionTaken')}>${inst.packageVersion || '–'}</span>
            <span class="adm-pk-mono" data-l=${P('colParts')}>${num(inst.installedComponents?.length ?? 0)}</span>
            <span class="adm-pk-mono" data-l=${P('colInstalledAt')}>${when(inst.installedAt)}</span>
          </div>`)}`}
      </section>

      <section class="og-sec">
        <div class="og-sec-h"><h2>${P('store')}<small>04</small></h2></div>
        ${!templates.length
    ? html`<p class="adm-pk-quiet">${P('noListings')}</p>`
    : html`
        <p class="adm-pk-lead">${P('storeLead')}</p>
        <div class="adm-pk-lhead">
          <span>${P('colListing')}</span><span>${P('colPackage')}</span><span>${P('colRating')}</span>
          <span>${P('colInstalls')}</span><span>${P('colFeatured')}</span><span></span>
        </div>
        ${templates.map((tpl) => html`
          <div key=${tpl.id}>
            <div class="adm-pk-lrow">
              <span><b>${tpl.title || tpl.name || '–'}</b>
                ${tpl.status !== LISTED ? html` <${Badge} type=${tpl.status === 'rejected' ? 'critical' : 'watch'} label=${tpl.status} />` : null}</span>
              <span class="adm-pk-mono" data-l=${P('colPackage')}>${tpl.packageGroupId || tpl.packageName || '–'}</span>
              <span class="adm-pk-mono" data-l=${P('colRating')}>${tpl.reviewCount ? `${tpl.rating?.toFixed(1) ?? '0.0'} (${tpl.reviewCount})` : P('noRating')}</span>
              <span class="adm-pk-mono" data-l=${P('colInstalls')}>${num(tpl.installCount ?? 0)}</span>
              <span data-l=${P('colFeatured')}>${tpl.featured ? '✓' : '–'}</span>
              <span>
                ${tpl.status === LISTED
      ? html`<button type="button" class="og-door og-door--quiet og-door--danger"
                    onClick=${() => { setSuspendId(suspendId === tpl.id ? null : tpl.id); setSuspendReason(''); }}>
                    ${suspendId === tpl.id ? P('cancel') : P('suspendBtn')}</button>`
      : null}
              </span>
            </div>
            ${suspendId === tpl.id && html`
              <div class="adm-pk-panel">
                <div class="adm-pk-fld">
                  <div class="adm-pk-fldl">${P('suspendReasonLabel')}</div>
                  <input type="text" value=${suspendReason} onInput=${(e) => setSuspendReason(e.target.value)}
                    placeholder=${P('suspendReasonPlaceholder')} />
                </div>
                <div class="adm-pk-acts">
                  <button class="adm-btn" onClick=${() => doSuspend(tpl.id)}>${P('suspendConfirm')}</button>
                </div>
                <p class="adm-pk-note">${P('suspendNote')}</p>
              </div>`}
          </div>`)}`}
      </section>

      <section class="og-sec">
        <div class="og-sec-h">
          <h2>${P('review')}<small>05</small></h2>
          ${pendingCount > 0 && html`<span><${Badge} type="watch" label=${P('nWaiting', { n: num(pendingCount) })} /></span>`}
        </div>
        <${ReviewBoard} pending=${pending} history=${history} onReload=${loadData} />
      </section>

      <section class="og-sec">
        <div class="og-sec-h"><h2>${P('examples')}<small>06</small></h2></div>
        <p class="adm-pk-lead">${P('examplesLead')}</p>
        <${Row} title=${P('rowArchives')} why=${P('rowArchivesWhy')} value=${P('systemPackages')} />
        <${Row} title=${P('rowDeletes')} why=${P('rowDeletesWhy')}
          chip=${html`<${Badge} type="watch" label=${P('countsReset')} />`}
          value=${P('systemListings')} last=${true} />
        <div class="adm-pk-acts">
          <button class="adm-btn" disabled=${seeding} onClick=${askSeed}>
            ${seeding ? t('dashboard.loading') : P('seedBtn')}</button>
          <span class="adm-pk-note" style="margin: 0">${P('seedAsks')}</span>
        </div>
        ${said && html`<p class="adm-pk-said ${said.ok ? 'is-ok' : 'is-bad'}">${said.msg}</p>`}
      </section>

      <${ConfirmUI} />
    </div>
  `;
}
