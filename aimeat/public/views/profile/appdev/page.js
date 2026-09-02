/**
 * @file public/views/profile/appdev/page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The AppDev page in the poster face (design canvas "AppDev: tieto ja kiihdytys",
 *   direction A): the mast and the strip; the two prompts a build starts from and the three tiers;
 *   the pitfalls the owner's agents filed, with severity, area and model filters, a text search,
 *   twenty rows at a time and a panel that opens under one; the template proposals; the platform's
 *   own registry, counts first and rows on demand; and how the page accrues. A person whose agents
 *   have filed nothing yet gets the same page with the empty sections saying what will appear.
 *   Pure render over the ctx bag; the rows are in rows.js.
 * @structure renderPage · secStart · secLearned · secProposals · secCurated · secHow
 * @usage import { renderPage } from './appdev/page.js';
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { Section, scrollTo } from '/views/profile/organisms/poster-parts.js';
import { a, areaLabel, crumb, pageLinks, buildPromptFileUrl, catalogUrl, locale } from './frame.js';
import { learnedRow, proposalRow, curatedRow } from './rows.js';

export function renderPage(ctx) {
  const L = ctx.learned;                       // the current page of filed pitfalls, null while loading
  const scope = L?.facets || {};
  const filed = sum(scope.status);             // every entry the owner's agents filed, any status
  const critical = scope.severity?.critical || 0;
  const none = L && filed === 0;
  const proposals = ctx.proposals || [];
  const curatedTotal = ctx.curatedSummary?.total || 0;
  const chip = (text, cls = '') => html`<span class=${`og-chip ${cls}`}>${text}</span>`;

  const strip = none ? html`
    <div class="og-strip">
      <div><b>0</b><span>${a('stripFiled')}</span><small>${a('stripNoneYet')}</small></div>
      <div><b>0</b><span>${a('stripProposals')}</span><small>${a('stripNoneYet')}</small></div>
      <div><b>${curatedTotal}</b><span>${a('stripCurated')}</span><small>${a('stripCuratedSub', { n: ctx.curatedSummary?.facets?.severity?.critical || 0 })}</small></div>
      <div><b>${ctx.templates}</b><span>${a('stripTemplates')}</span><small>${a('stripTemplatesSub')}</small></div>
    </div>` : html`
    <div class="og-strip">
      <div><b>${L ? filed : '…'}</b><span>${a('stripFiled')}</span><small>${L ? a('stripFiledSub', { models: Object.keys(scope.model || {}).length, apps: ctx.appsTaught, none: ctx.noApp }) : ''}</small></div>
      <div><b class=${critical ? 'og-strip-coral' : ''}>${L ? critical : '…'}</b><span>${a('stripCritical')}</span><small>${criticalSub(ctx)}</small></div>
      <div><b>${proposals.length}</b><span>${a('stripProposals')}</span><small>${proposals.length ? a('stripProposalsSub', { proven: proposals.filter((p) => (p.proofs || []).some((x) => x.verdict === 'pass')).length }) : a('stripNoneYet')}</small></div>
      <div><b>${curatedTotal}</b><span>${a('stripCurated')}</span><small>${a('stripCuratedSub', { n: ctx.curatedSummary?.facets?.severity?.critical || 0 })}</small></div>
    </div>`;

  const railItems = [
    ['01', 'ad-start', a('secStart'), ''],
    ['02', 'ad-learned', a('secLearned'), L ? filed : ''],
    ['03', 'ad-proposals', a('secProposals'), proposals.length],
    ['04', 'ad-curated', a('secCurated'), curatedTotal],
    ['05', 'ad-how', a('secHow'), ''],
  ];

  return html`
    <div class="og og-appdev">
      ${crumb()}
      <div class="og-mast">
        <div class="og-mast-words">
          <h1 class="og-title">${t('profile.tabs.appDev')}<small>${a('titleSub')}</small></h1>
          <div class="og-chips">
            ${none ? chip(a('chipNone'), 'og-chip--coral') : L ? chip(a('chipFiled', { n: filed })) : null}
            ${!none && critical ? chip(a('chipCritical', { n: critical }), 'og-chip--coral') : null}
            ${none ? chip(a('chipCuratedReady', { n: curatedTotal }), 'og-chip--dim') : L ? chip(a('chipShared', { n: scope.shared?.shared || 0 }), 'og-chip--dim') : null}
          </div>
          <p class="og-desc">${none ? a('descEmpty') : a('desc')}</p>
        </div>
        <div class="og-mast-actions">
          <${CopyButton} text=${ctx.flow} className="og-slab" label=${a('flowSlab')} copiedLabel=${a('promptCopied')} disabled=${!ctx.flow} onCopied=${() => ctx.showToast?.(a('flowCopiedToast'))} />
          <div class="og-doors"><button type="button" class="og-door" onClick=${() => ctx.goTab('apps')}>${a('appsDoor')}</button></div>
        </div>
      </div>
      ${strip}
      <div class="og-grid">
        <div class="og-main">
          ${secStart(ctx)}
          ${secLearned(ctx, none)}
          ${secProposals(ctx, proposals)}
          ${secCurated(ctx, none)}
          ${secHow(ctx, none)}
        </div>
        <nav class="og-rail" aria-label=${a('railTitle')}>
          <span class="og-rail-label">${a('railTitle')}</span>
          ${railItems.map(([n, id, label, count]) => html`<button type="button" class="og-rail-link" key=${id} onClick=${() => scrollTo(id)}><i>${n}</i>${label}<em>${count}</em></button>`)}
          <hr />
          <span class="og-rail-label">${a('pages')}</span>
          ${pageLinks()}
        </nav>
      </div>
      <${ctx.ConfirmUI} />
    </div>`;
}

const sum = (m) => Object.values(m || {}).reduce((s, n) => s + n, 0);
const top = (m) => Object.entries(m || {}).sort((p, q) => q[1] - p[1])[0];

/** Under the critical count: the area and the model with the most of them. */
function criticalSub(ctx) {
  const f = ctx.critical;
  if (!f) return '';
  const area = top(f.category);
  const model = top(f.model);
  if (!area) return a('stripCriticalNone');
  return a('stripCriticalSub', { area: areaLabel(area[0]), an: area[1], model: model ? model[0] : '', mn: model ? model[1] : 0 });
}

/* ── 01 · Start right ─────────────────────────────────────────────────────────────────────────── */

function secStart(ctx) {
  const fmt = (n) => Number(n || 0).toLocaleString(locale());
  const item = (id) => ctx.openItems?.[id];
  return html`
    <${Section} id="ad-start" num="01" title=${a('secStart')} count=${a('secStartSub')} first>
      <div class="ad-prl">
        <div class="ad-pr">
          <div class="ad-pr-nm">${a('flowTitle')}<small>${a('flowMeta', { n: fmt(ctx.flow ? ctx.flow.length : 0) })}</small></div>
          <div class="ad-pr-ds">${a('flowDesc')}</div>
          <div class="ad-pr-go">
            <${CopyButton} text=${ctx.flow} className="og-door" label=${a('copy')} copiedLabel=${a('promptCopied')} disabled=${!ctx.flow} onCopied=${() => ctx.showToast?.(a('flowCopiedToast'))} />
            <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.toggleShow('flow')}>${ctx.shown === 'flow' ? a('hide') : a('show')}</button>
            <button type="button" class="og-door og-door--quiet" disabled=${ctx.busy === 'item:flow'} onClick=${() => ctx.toggleOpenItem('flow')}>${item('flow') ? a('offWorklist') : a('toWorklist')}</button>
          </div>
        </div>
        ${ctx.shown === 'flow' ? html`<div class="ad-open"><p>${ctx.flow}</p></div>` : null}
        <div class="ad-pr">
          <div class="ad-pr-nm">${a('buildTitle')}<small>${ctx.buildLength ? a('buildMeta', { n: fmt(ctx.buildLength) }) : a('buildMetaShort')}</small></div>
          <div class="ad-pr-ds">${a('buildDesc')}</div>
          <div class="ad-pr-go">
            <button type="button" class="og-door" disabled=${ctx.busy === 'build'} onMouseEnter=${ctx.prefetchBuild} onFocus=${ctx.prefetchBuild} onClick=${ctx.copyBuild}>${a('copy')}</button>
            <a class="og-door og-door--quiet" href=${buildPromptFileUrl()} download="aimeat-build-app.txt">${a('downloadFile')}</a>
            <button type="button" class="og-door og-door--quiet" disabled=${ctx.busy === 'item:build'} onClick=${() => ctx.toggleOpenItem('build')}>${item('build') ? a('offWorklist') : a('toWorklist')}</button>
          </div>
        </div>
      </div>
      <div class="ad-tier">
        <b>T1</b><span>${a('tier1')}</span>
        <b>T2</b><span>${a('tier2')}</span>
        <b>T3</b><span>${a('tier3')}</span>
      </div>
      <p class="ad-hint">${a('startHint', { templates: ctx.templates, packs: ctx.packs, proven: ctx.packsProven })} <a class="og-crumb-link" href=${catalogUrl()} target="_blank" rel="noopener">${t('profile.apps.launcherTitle')}</a></p>
    <//>`;
}

/* ── 02 · The pitfalls the agents filed ───────────────────────────────────────────────────────── */

function secLearned(ctx, none) {
  const L = ctx.learned;
  const F = ctx.filters;
  const scope = L?.facets || {};
  const facet = (on, label, n, onClick, key) => html`<button type="button" key=${key} class=${`ad-facet ${on ? 'is-on' : ''}`} onClick=${onClick}>${label}<em>${n}</em></button>`;
  const areas = Object.entries(scope.category || {}).sort((p, q) => q[1] - p[1]);
  const shownAreas = ctx.allAreas ? areas : areas.slice(0, 7);
  const models = Object.entries(scope.model || {}).sort((p, q) => q[1] - p[1]);
  const rows = L?.pitfalls || [];
  const filed = sum(scope.status);
  return html`
    <${Section} id="ad-learned" num="02" title=${a('secLearned')} count=${L ? filed : null}>
      ${none ? html`<p class="ad-empty"><b>${a('learnedEmptyHead')}</b> ${a('learnedEmptyBody')}</p>` : !L ? html`<p class="ad-empty">${t('common.loading')}</p>` : html`
        <div class="ad-facets">
          ${facet(!F.severity && F.status === 'active' && F.shared === undefined, a('facetAll'), scope.status?.active || 0, () => ctx.setFilters({ severity: '', status: 'active', shared: undefined }), 'all')}
          ${['critical', 'warn', 'info'].map((s) => facet(F.severity === s, a('facet.' + s), scope.severity?.[s] || 0, () => ctx.setFilters({ severity: F.severity === s ? '' : s }), s))}
          ${facet(F.shared === false, a('facetPrivate'), scope.shared?.private || 0, () => ctx.setFilters({ shared: F.shared === false ? undefined : false }), 'private')}
          ${facet(F.status === 'outdated', a('facetOutdated'), scope.status?.outdated || 0, () => ctx.setFilters({ status: F.status === 'outdated' ? 'active' : 'outdated' }), 'outdated')}
          ${L.community || F.includeShared ? facet(!!F.includeShared, a('communityMark'), L.community, () => ctx.setFilters({ includeShared: !F.includeShared }), 'community') : null}
        </div>
        <div class="ad-facets">
          ${shownAreas.map(([k, n]) => facet(F.category === k, areaLabel(k), n, () => ctx.setFilters({ category: F.category === k ? '' : k }), 'c' + k))}
          ${areas.length > 7 && !ctx.allAreas ? html`<button type="button" class="ad-facet" onClick=${() => ctx.setAllAreas(true)}>${a('moreAreas', { n: areas.length - 7 })}</button>` : null}
          ${models.map(([k, n]) => facet(F.model === k, k, n, () => ctx.setFilters({ model: F.model === k ? '' : k }), 'm' + k))}
        </div>
        <div class="ad-search">
          <input class="og-input" type="search" value=${ctx.q} placeholder=${a('searchPlaceholder')} aria-label=${a('searchPlaceholder')} onInput=${(e) => ctx.setQ(e.target.value)} />
          <small>${a('searchOrder', { n: L.limit })}</small>
        </div>
        ${!rows.length ? html`<p class="ad-empty">${a('learnedNoMatch')}</p>` : html`
          <div class="ad-pl">
            <div class="ad-p ad-p--head"><div>${a('colSeverity')}</div><div>${a('colPitfall')}</div><div>${a('colAreaModel')}</div><div></div></div>
            ${rows.map((p) => learnedRow(ctx, p))}
          </div>`}
        <div class="ad-more">
          ${rows.length < L.total ? html`<button type="button" class="og-door og-door--quiet" disabled=${ctx.busy === 'more'} onClick=${ctx.loadMore}>${a('showMore', { n: Math.min(L.limit, L.total - rows.length) })}</button>` : null}
          <small>${a('shownOf', { shown: rows.length, total: L.total })}</small>
        </div>
        <p class="ad-hint">${a('learnedHint')}</p>`}
    <//>`;
}

/* ── 03 · Template proposals ──────────────────────────────────────────────────────────────────── */

function secProposals(ctx, proposals) {
  return html`
    <${Section} id="ad-proposals" num="03" title=${a('secProposals')} count=${ctx.proposals ? proposals.length : null}>
      ${!ctx.proposals ? html`<p class="ad-empty">${t('common.loading')}</p>` : !proposals.length ? html`<p class="ad-empty">${a('proposalsEmpty')}</p>` : html`
        <div class="ad-pl">
          <div class="ad-p ad-p--head"><div>${a('colTier')}</div><div>${a('colTemplate')}</div><div>${a('colModelSource')}</div><div></div></div>
          ${proposals.map((p) => proposalRow(ctx, p))}
        </div>`}
      <p class="ad-hint">${a('proposalsHint')}</p>
    <//>`;
}

/* ── 04 · The platform's own registry ─────────────────────────────────────────────────────────── */

function secCurated(ctx, none) {
  const S = ctx.curatedSummary;
  const C = ctx.curated;
  const F = ctx.curatedFilter;
  const facet = (on, label, n, onClick, key) => html`<button type="button" key=${key} class=${`ad-facet ${on ? 'is-on' : ''}`} onClick=${onClick}>${label}<em>${n}</em></button>`;
  const areas = Object.entries(S?.facets?.applies_to || {}).sort((p, q) => q[1] - p[1]);
  let rows = C?.pitfalls || [];
  if (F.severity) rows = rows.filter((p) => p.severity === F.severity);
  if (F.area) rows = rows.filter((p) => (p.appliesTo || []).includes(F.area));
  const doors = S && !C ? html`<button type="button" class="og-door og-door--quiet" disabled=${ctx.busy === 'curated'} onClick=${ctx.loadCurated}>${a('showRows', { n: S.total })}</button>` : null;
  return html`
    <${Section} id="ad-curated" num="04" title=${a('secCurated')} count=${S ? S.total : null} doors=${doors}>
      ${!S ? html`<p class="ad-empty">${t('common.loading')}</p>` : html`
        <div class="ad-facets">
          ${facet(!F.severity, a('facetAll'), S.total, () => ctx.setCuratedFilter({ severity: '' }), 'all')}
          ${['critical', 'warn', 'info'].map((s) => facet(F.severity === s, a('facet.' + s), S.facets?.severity?.[s] || 0, () => ctx.setCuratedFilter({ severity: F.severity === s ? '' : s }), s))}
          ${areas.map(([k, n]) => facet(F.area === k, areaLabel(k), n, () => ctx.setCuratedFilter({ area: F.area === k ? '' : k }), 'c' + k))}
        </div>
        ${C ? html`
          <div class="ad-pl">
            <div class="ad-p ad-p--head"><div>${a('colSeverity')}</div><div>${a('colPitfall')}</div><div>${a('colAreas')}</div><div></div></div>
            ${rows.map((p) => curatedRow(ctx, p))}
          </div>` : null}`}
      <p class="ad-hint">${none ? a('curatedHintNew') : a('curatedHint')}</p>
    <//>`;
}

/* ── 05 · How this accrues ────────────────────────────────────────────────────────────────────── */

function secHow(ctx, none) {
  return html`
    <${Section} id="ad-how" num="05" title=${a('secHow')} count=${null}>
      <div class="ad-kv">
        <div class="ad-k">${a('how.before.k')}</div><div class="ad-v">${a('how.before.v')}<small>${a('how.before.s')}</small></div>
        <div class="ad-k">${a('how.after.k')}</div><div class="ad-v">${a('how.after.v')}<small>${a('how.after.s')}</small></div>
        <div class="ad-k">${a('how.you.k')}</div><div class="ad-v">${a('how.you.v')}<small>${a('how.you.s')}</small></div>
      </div>
      ${none ? null : html`<p class="ad-hint">${ctx.learned?.community ? a('communityHint', { n: ctx.learned.community }) : a('communityNone')}</p>`}
    <//>`;
}
