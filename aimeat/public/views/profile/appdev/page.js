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
 *   2026-09-22 -- Composed from the shared component set: Page, Rail, a plain NumeralBand strip,
 *     ListRow for a prompt, Toolbar filters for the facets, Field for the search, KeyValue for the
 *     tiers and the accrual; no own CSS. The lists' column heads are gone: each row says what it is.
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num as fmtNum } from '/js/format.js';
import { Page, Rail, Section, Stack, ListRow, NumeralBand, Toolbar, Field, KeyValue, Action, CopyAction, Chip, Text, Surface } from '/components/poster-parts.js';
import { a, areaLabel, crumb, pageLinks, buildPromptFileUrl, catalogUrl } from './frame.js';
import { learnedRow, proposalRow, curatedRow } from './rows.js';

export function renderPage(ctx) {
  const L = ctx.learned;                       // the current page of filed pitfalls, null while loading
  const scope = L?.facets || {};
  const filed = sum(scope.status);             // every entry the owner's agents filed, any status
  const critical = scope.severity?.critical || 0;
  const none = L && filed === 0;
  const proposals = ctx.proposals || [];
  const curatedTotal = ctx.curatedSummary?.total || 0;
  const curatedItem = { label: a('stripCurated'), value: curatedTotal, note: a('stripCuratedSub', { n: ctx.curatedSummary?.facets?.severity?.critical || 0 }) };

  const strip = html`<${NumeralBand} tone="plain" items=${none ? [
    { label: a('stripFiled'), value: 0, note: a('stripNoneYet') },
    { label: a('stripProposals'), value: 0, note: a('stripNoneYet') },
    curatedItem,
    { label: a('stripTemplates'), value: ctx.templates, note: a('stripTemplatesSub') },
  ] : [
    { label: a('stripFiled'), value: L ? filed : '…', note: L ? a('stripFiledSub', { models: Object.keys(scope.model || {}).length, apps: ctx.appsTaught, none: ctx.noApp }) : '' },
    { label: a('stripCritical'), value: L ? critical : '…', tone: critical ? 'coral' : undefined, note: criticalSub(ctx) },
    { label: a('stripProposals'), value: proposals.length, note: proposals.length ? a('stripProposalsSub', { proven: proposals.filter((p) => (p.proofs || []).some((x) => x.verdict === 'pass')).length }) : a('stripNoneYet') },
    curatedItem,
  ]} />`;

  const identity = html`<${Stack} density="compact">
    <${Text} kind="label">${a('titleSub')}<//>
    <${Stack} direction="wrap" density="compact">
      ${none ? html`<${Chip} tone="coral">${a('chipNone')}<//>` : L ? html`<${Chip}>${a('chipFiled', { n: filed })}<//>` : null}
      ${!none && critical ? html`<${Chip} tone="coral">${a('chipCritical', { n: critical })}<//>` : null}
      ${none ? html`<${Chip} tone="muted">${a('chipCuratedReady', { n: curatedTotal })}<//>` : L ? html`<${Chip} tone="muted">${a('chipShared', { n: scope.shared?.shared || 0 })}<//>` : null}
    <//>
  <//>`;
  const actions = html`<${CopyAction} kind="primary" text=${ctx.flow} label=${a('flowSlab')} copiedLabel=${a('promptCopied')} disabled=${!ctx.flow} onCopied=${() => ctx.showToast?.(a('flowCopiedToast'))} />
    <${Action} onClick=${() => ctx.goTab('apps')}>${a('appsDoor')}<//>`;
  const rail = html`<${Rail} kind="index" title=${a('railTitle')} entries=${[
    { href: '#ad-start', label: a('secStart') },
    { href: '#ad-learned', label: a('secLearned'), count: L ? filed : undefined },
    { href: '#ad-proposals', label: a('secProposals'), count: proposals.length },
    { href: '#ad-curated', label: a('secCurated'), count: curatedTotal },
    { href: '#ad-how', label: a('secHow') },
  ]}>${pageLinks()}<//>`;

  return html`<${Page} width="wide" title=${t('profile.tabs.appDev')} crumbs=${crumb()} identity=${identity} actions=${actions} rail=${rail}>
    <${Stack}>
      <${Text} kind="lead">${none ? a('descEmpty') : a('desc')}<//>
      ${strip}
      ${secStart(ctx)}
      ${secLearned(ctx, none)}
      ${secProposals(ctx, proposals)}
      ${secCurated(ctx, none)}
      ${secHow(ctx, none)}
    <//>
    <${ctx.ConfirmUI} />
  <//>`;
}

const sum = (m) => Object.values(m || {}).reduce((s, n) => s + n, 0);
const top = (m) => Object.entries(m || {}).sort((p, q) => q[1] - p[1])[0];

/** A facet: a filter tab with its count. */
const facet = (id, on, label, n, onClick) => ({ id, selected: on, label: `${label} ${n}`, onClick });

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
  const fmt = (n) => fmtNum(Number(n || 0));
  const item = (id) => ctx.openItems?.[id];
  return html`
    <${Section} id="ad-start" title=${a('secStart')} count=${a('secStartSub')}>
      <${Stack}>
        <${Stack} density="compact">
          <${ListRow} name=${a('flowTitle')} detail=${a('flowMeta', { n: fmt(ctx.flow ? ctx.flow.length : 0) })}
            actions=${html`<${CopyAction} text=${ctx.flow} label=${a('copy')} copiedLabel=${a('promptCopied')} disabled=${!ctx.flow} onCopied=${() => ctx.showToast?.(a('flowCopiedToast'))} />
              <${Action} expanded=${ctx.shown === 'flow'} onClick=${() => ctx.toggleShow('flow')}>${ctx.shown === 'flow' ? a('hide') : a('show')}<//>
              <${Action} disabled=${ctx.busy === 'item:flow'} onClick=${() => ctx.toggleOpenItem('flow')}>${item('flow') ? a('offWorklist') : a('toWorklist')}<//>`}>
            <${Stack} density="compact">
              <${Text}>${a('flowDesc')}<//>
              ${ctx.shown === 'flow' ? html`<${Surface} kind="aside" height="scroll"><${Text} lines=${true}>${ctx.flow}<//><//>` : null}
            <//>
          <//>
          <${ListRow} name=${a('buildTitle')} detail=${ctx.buildLength ? a('buildMeta', { n: fmt(ctx.buildLength) }) : a('buildMetaShort')}
            actions=${html`<span onMouseEnter=${ctx.prefetchBuild} onFocusIn=${ctx.prefetchBuild}><${Action} disabled=${ctx.busy === 'build'} onClick=${ctx.copyBuild}>${a('copy')}<//></span>
              <${Action} href=${buildPromptFileUrl()} download="aimeat-build-app.txt">${a('downloadFile')}<//>
              <${Action} disabled=${ctx.busy === 'item:build'} onClick=${() => ctx.toggleOpenItem('build')}>${item('build') ? a('offWorklist') : a('toWorklist')}<//>`}>
            <${Text}>${a('buildDesc')}<//>
          <//>
        <//>
        <div>
          <${KeyValue} label="T1" value=${a('tier1')} />
          <${KeyValue} label="T2" value=${a('tier2')} />
          <${KeyValue} label="T3" value=${a('tier3')} />
        </div>
        <${Text} kind="caption" tone="muted">${a('startHint', { templates: ctx.templates, packs: ctx.packs, proven: ctx.packsProven })} <${Action} kind="text" href=${catalogUrl()} target="_blank">${t('profile.apps.launcherTitle')}<//><//>
      <//>
    <//>`;
}

/* ── 02 · The pitfalls the agents filed ───────────────────────────────────────────────────────── */

function secLearned(ctx, none) {
  const L = ctx.learned;
  const F = ctx.filters;
  const scope = L?.facets || {};
  const areas = Object.entries(scope.category || {}).sort((p, q) => q[1] - p[1]);
  const shownAreas = ctx.allAreas ? areas : areas.slice(0, 7);
  const models = Object.entries(scope.model || {}).sort((p, q) => q[1] - p[1]);
  const rows = L?.pitfalls || [];
  const filed = sum(scope.status);
  return html`
    <${Section} id="ad-learned" title=${a('secLearned')} count=${L ? filed : null}>
      ${none ? html`<${Text}><strong>${a('learnedEmptyHead')}</strong> ${a('learnedEmptyBody')}<//>` : !L ? html`<${Text} tone="muted">${t('common.loading')}<//>` : html`
        <${Stack}>
          <${Toolbar} filters=${[
            facet('all', !F.severity && F.status === 'active' && F.shared === undefined, a('facetAll'), scope.status?.active || 0, () => ctx.setFilters({ severity: '', status: 'active', shared: undefined })),
            ...['critical', 'warn', 'info'].map((s) => facet(s, F.severity === s, a('facet.' + s), scope.severity?.[s] || 0, () => ctx.setFilters({ severity: F.severity === s ? '' : s }))),
            facet('private', F.shared === false, a('facetPrivate'), scope.shared?.private || 0, () => ctx.setFilters({ shared: F.shared === false ? undefined : false })),
            facet('outdated', F.status === 'outdated', a('facetOutdated'), scope.status?.outdated || 0, () => ctx.setFilters({ status: F.status === 'outdated' ? 'active' : 'outdated' })),
            ...(L.community || F.includeShared ? [facet('community', !!F.includeShared, a('communityMark'), L.community, () => ctx.setFilters({ includeShared: !F.includeShared }))] : []),
          ]} />
          <${Toolbar} filters=${[
            ...shownAreas.map(([k, n]) => facet('c' + k, F.category === k, areaLabel(k), n, () => ctx.setFilters({ category: F.category === k ? '' : k }))),
            ...models.map(([k, n]) => facet('m' + k, F.model === k, k, n, () => ctx.setFilters({ model: F.model === k ? '' : k }))),
          ]} actions=${areas.length > 7 && !ctx.allAreas ? html`<${Action} kind="text" onClick=${() => ctx.setAllAreas(true)}>${a('moreAreas', { n: areas.length - 7 })}<//>` : null} />
          <${Field} type="search" value=${ctx.q} placeholder=${a('searchPlaceholder')} ariaLabel=${a('searchPlaceholder')} onInput=${(e) => ctx.setQ(e.target.value)} />
          <${Text} kind="caption" tone="muted">${a('searchOrder', { n: L.limit })}<//>
          ${!rows.length ? html`<${Text} tone="muted">${a('learnedNoMatch')}<//>` : html`
            <${Stack} density="compact">${rows.map((p) => learnedRow(ctx, p))}<//>`}
          <${Stack} direction="horizontal" align="between">
            ${rows.length < L.total ? html`<${Action} disabled=${ctx.busy === 'more'} onClick=${ctx.loadMore}>${a('showMore', { n: Math.min(L.limit, L.total - rows.length) })}<//>` : html`<span></span>`}
            <${Text} kind="mono" tone="muted">${a('shownOf', { shown: rows.length, total: L.total })}<//>
          <//>
          <${Text} kind="caption" tone="muted">${a('learnedHint')}<//>
        <//>`}
    <//>`;
}

/* ── 03 · Template proposals ──────────────────────────────────────────────────────────────────── */

function secProposals(ctx, proposals) {
  return html`
    <${Section} id="ad-proposals" title=${a('secProposals')} count=${ctx.proposals ? proposals.length : null}>
      <${Stack}>
        ${!ctx.proposals ? html`<${Text} tone="muted">${t('common.loading')}<//>` : !proposals.length ? html`<${Text}>${a('proposalsEmpty')}<//>` : html`
          <${Stack} density="compact">${proposals.map((p) => proposalRow(ctx, p))}<//>`}
        <${Text} kind="caption" tone="muted">${a('proposalsHint')}<//>
      <//>
    <//>`;
}

/* ── 04 · The platform's own registry ─────────────────────────────────────────────────────────── */

function secCurated(ctx, none) {
  const S = ctx.curatedSummary;
  const C = ctx.curated;
  const F = ctx.curatedFilter;
  const areas = Object.entries(S?.facets?.applies_to || {}).sort((p, q) => q[1] - p[1]);
  let rows = C?.pitfalls || [];
  if (F.severity) rows = rows.filter((p) => p.severity === F.severity);
  if (F.area) rows = rows.filter((p) => (p.appliesTo || []).includes(F.area));
  const actions = S && !C ? html`<${Action} disabled=${ctx.busy === 'curated'} onClick=${ctx.loadCurated}>${a('showRows', { n: S.total })}<//>` : null;
  return html`
    <${Section} id="ad-curated" title=${a('secCurated')} count=${S ? S.total : null} actions=${actions}>
      <${Stack}>
        ${!S ? html`<${Text} tone="muted">${t('common.loading')}<//>` : html`
          <${Toolbar} filters=${[
            facet('all', !F.severity, a('facetAll'), S.total, () => ctx.setCuratedFilter({ severity: '' })),
            ...['critical', 'warn', 'info'].map((s) => facet(s, F.severity === s, a('facet.' + s), S.facets?.severity?.[s] || 0, () => ctx.setCuratedFilter({ severity: F.severity === s ? '' : s }))),
            ...areas.map(([k, n]) => facet('c' + k, F.area === k, areaLabel(k), n, () => ctx.setCuratedFilter({ area: F.area === k ? '' : k }))),
          ]} />
          ${C ? html`<${Stack} density="compact">${rows.map((p) => curatedRow(ctx, p))}<//>` : null}`}
        <${Text} kind="caption" tone="muted">${none ? a('curatedHintNew') : a('curatedHint')}<//>
      <//>
    <//>`;
}

/* ── 05 · How this accrues ────────────────────────────────────────────────────────────────────── */

function secHow(ctx, none) {
  const kv = (k) => html`<${KeyValue} label=${a('how.' + k + '.k')}>
    <${Stack} density="compact"><span>${a('how.' + k + '.v')}</span><${Text} kind="caption" tone="muted">${a('how.' + k + '.s')}<//><//>
  <//>`;
  return html`
    <${Section} id="ad-how" title=${a('secHow')}>
      <${Stack}>
        <div>${kv('before')}${kv('after')}${kv('you')}</div>
        ${none ? null : html`<${Text} kind="caption" tone="muted">${ctx.learned?.community ? a('communityHint', { n: ctx.learned.community }) : a('communityNone')}<//>`}
      <//>
    <//>`;
}
