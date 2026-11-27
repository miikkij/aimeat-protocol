/**
 * @file public/views/profile/appdev/page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The AppDev page in the poster face (design canvas "AppDev: tieto ja kiihdytys",
 *   direction A): the mast and the strip; the two prompts a build starts from and the three tiers;
 *   the pitfalls the owner's agents filed, with severity, area and model filters, a text search,
 *   twenty rows at a time and a panel that opens under one; the template proposals; the platform's
 *   own registry, counts first and rows on demand. How it accrues is the title's question mark
 *   (concept.appdev), and the page's start (PageStart "appdev") gives the first build's prompt with
 *   the flow prompt as the page's own button (.claude/rules/page-guidance.md). A person whose agents
 *   have filed nothing yet gets the same page with the empty sections saying what will appear.
 *   Pure render over the ctx bag, made of the component kit (the page passes data and never a
 *   class); the rows are in rows.js.
 * @structure renderPage · secStart · secLearned · secProposals · secCurated
 * @usage import { renderPage } from './appdev/page.js';
 * @version-history
 *   v2.2.0 -- 2026-11-27 -- Usability pass: the pitfalls the agents filed are the main thing, first and
 *     open (most severe first, appdev-tab.js); the template proposals are drawn only when there are
 *     some; the two prompts ("The start") and the platform's own registry are rows that open in place
 *     (the first open while nothing is filed), numbered after the filter. With nothing filed there is
 *     no strip; otherwise it says what was filed, what is critical (the notice tone, the one to look
 *     at), what is shared with other owners and the proposals when there are any; the registry's and
 *     the templates' counts stand in their own rows. The head's marks repeated the strip and are gone.
 *   v2.1.0 -- 2026-11-08 -- The page explains itself the designed way (.claude/rules/page-guidance.md):
 *     PageStart "appdev" (folded once an agent has filed a pitfall; its button copies the flow
 *     prompt) and the title's question mark concept.appdev. Section 05 "How this accrues" explained
 *     the concept, so its words moved into the concept and the section is gone; its line on other
 *     owners' shared pitfalls, a live count, now stands under the list in 02. The head's paragraph
 *     is two sentences.
 *   v2.0.0 -- 2026-09-26 -- Every part is a component call that gets data (page group G6): the frame
 *     is SettingsPage (crumb, head, marks, strip, rail as data), the strip FigureStrip, the two
 *     prompts and the three lists the List (the pitfall lists its state-name-who-doors cut; the flow
 *     prompt, shown, the List's Panel), the tiers the List's tag-name cut, the filters Filters and
 *     Filter, the search the SearchLine, "show more" the More line, how it accrues the Facts, the
 *     copies Action and Loud with `copy`. The shared-count and curated-ready tags are the dim Tag
 *     again (main's og-chip--dim, which the previous branch lost).
 *   v1.15.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.14.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.13.0 -- 2026-09-25 -- A filter's count is the Count (.poster-count, tally), a unification: Jouni's decision "Count".
 *   v1.12.0 -- 2026-09-25 -- The two prompts are the Listing (listing--name-desc-doors), a unification: the look most tabs use.
 *   v1.11.0 -- 2026-09-25 -- "N more areas" after the area filters is the small link (.poster-action--more), a unification: Jouni's decision "Small link".
 *   v1.10.0 -- 2026-09-25 -- The line under the list (show more, how many shown) is the More line (.more-line, css/components/more-line.css), a library part by a move.
 *   v1.9.0 -- 2026-09-25 -- How it accrues is the Facts (facts, facts-k, facts-v), a unification: the look most tabs use.
 *   v1.8.0 -- 2026-09-25 -- A search field over a list is the Search line (.search-line with the Text field); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.7.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.6.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.5.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.4.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.3.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   v1.2.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num as fmtNum } from '/js/format.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { Section } from '/components/Section.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { List, Row, Name, Desc, Cell, Doors, Panel, Filters, Filter, SearchLine, More } from '/components/List.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { PageStart } from '/components/PageStart.js';
import { a, areaLabel, crumb, pageLinks, buildPromptFileUrl, catalogUrl } from './frame.js';
import { learnedRow, proposalRow, curatedRow } from './rows.js';

/** One filter of a facet row: on or off, with its count. */
const facet = (on, label, n, onClick, key) => html`<${Filter} key=${key} on=${on} count=${n} onClick=${onClick}>${label}<//>`;

export function renderPage(ctx) {
  const L = ctx.learned;                       // the current page of filed pitfalls, null while loading
  const scope = L?.facets || {};
  const filed = sum(scope.status);             // every entry the owner's agents filed, any status
  const critical = scope.severity?.critical || 0;
  const none = L && filed === 0;
  const proposals = ctx.proposals || [];
  const curatedTotal = ctx.curatedSummary?.total || 0;
  const shared = scope.shared?.shared || 0;

  // With nothing filed the strip is not drawn: the head's paragraph says how the first entry comes,
  // the list's one line says the same, and the registry's and the templates' counts stand in their
  // own rows. Otherwise: what was filed, what is critical (the one to look at), what of it teaches
  // other owners (the person decides that), and the template proposals when there are any. The
  // registry's count left the strip: it is the same for everyone and its row says it.
  const strip = !L ? html`<${FigureStrip} loading=${3} />` : none ? null : html`<${FigureStrip} items=${[
    { key: 'filed', n: filed, label: a('stripFiled'), sub: a('stripFiledSub', { models: Object.keys(scope.model || {}).length, apps: ctx.appsTaught, none: ctx.noApp }) },
    { key: 'critical', n: critical, tone: critical ? 'notice' : undefined, label: a('stripCritical'), sub: criticalSub(ctx) },
    { key: 'shared', n: shared, label: a('stripShared'), sub: a('stripSharedSub', { n: scope.shared?.private || 0 }) },
    proposals.length ? { key: 'proposals', n: proposals.length, label: a('stripProposals'), sub: a('stripProposalsSub', { proven: proposals.filter((p) => (p.proofs || []).some((x) => x.verdict === 'pass')).length }) } : null,
  ]} />`;

  // The head's marks repeated the strip and are gone.
  const actions = html`
    <${Loud} control copy=${ctx.flow} copiedLabel=${a('promptCopied')} disabled=${!ctx.flow} onCopied=${() => ctx.showToast?.(a('flowCopiedToast'))}>${a('flowSlab')}<//>
    <${Actions}><${Action} small onClick=${() => ctx.goTab('apps')}>${a('appsDoor')}<//><//>`;
  // The start: its button copies the flow prompt.
  const start = html`<${PageStart} id="appdev" done=${L ? filed > 0 : null}
    action=${ctx.flow ? { copy: ctx.flow } : undefined} />`;

  // What the agents filed is the page's main thing, so it is first. The two prompts are a row that
  // opens in place: open while nothing is filed (a build from them is how the first entry comes),
  // shut after that. The proposals are drawn only when there are some; the platform's own registry
  // is a row with its count, since it is the same for everyone and read rarely here.
  const startOpen = ctx.folds.start ?? !!none;
  const curatedOpen = ctx.folds.curated ?? false;
  const parts = [
    { id: 'ad-learned', label: a('secLearned'), count: L ? filed : '', draw: (nr) => secLearned(ctx, nr, none) },
    proposals.length ? { id: 'ad-proposals', label: a('secProposals'), count: proposals.length, draw: (nr) => secProposals(ctx, nr, proposals) } : null,
    { id: 'ad-start', label: a('secStart'), count: '', open: () => ctx.setFold('start', true), draw: (nr) => secStart(ctx, nr, startOpen) },
    { id: 'ad-curated', label: a('secCurated'), count: curatedTotal, open: () => ctx.setFold('curated', true), draw: (nr) => secCurated(ctx, nr, none, curatedOpen) },
  ].filter(Boolean).map((s, i) => ({ ...s, num: String(i + 1).padStart(2, '0') }));

  return html`
    <${SettingsPage} name="appdev" crumb=${crumb()} title=${t('profile.tabs.appDev')} sub=${a('titleSub')} help="concept.appdev"
      desc=${none ? a('descEmpty') : a('desc')} actions=${actions} start=${start} strip=${strip}
      railTitle=${a('railTitle')}
      sections=${parts.map(({ id, num, label, count, open }) => ({ id, num, label, count, open }))}
      pagesLabel=${a('pages')} pages=${pageLinks()}
      after=${html`<${ctx.ConfirmUI} />`}>
      ${parts.map((s) => s.draw(s.num))}
    <//>`;
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

/* ── The start: the two prompts, one row that opens in place ──────────────────────────────────── */

function secStart(ctx, nr, open) {
  const fmt = (n) => fmtNum(Number(n || 0));
  const item = (id) => ctx.openItems?.[id];
  const flowShown = ctx.shown === 'flow';
  return html`
    <${Section} fold id="ad-start" num=${nr} title=${a('secStart')} sub=${a('secStartSub')} open=${open} onToggle=${() => ctx.setFold('start', !open)}>
      <${List} cols="name-desc-doors">
        <${Row} open=${flowShown}>
          <${Name} meta=${a('flowMeta', { n: fmt(ctx.flow ? ctx.flow.length : 0) })}>${a('flowTitle')}<//>
          <${Desc}>${a('flowDesc')}<//>
          <${Doors}>
            <${Action} small row copy=${ctx.flow} copiedLabel=${a('promptCopied')} disabled=${!ctx.flow} onCopied=${() => ctx.showToast?.(a('flowCopiedToast'))}>${a('copy')}<//>
            <${Action} small row soft onClick=${() => ctx.toggleShow('flow')}>${flowShown ? a('hide') : a('show')}<//>
            <${Action} small row soft disabled=${ctx.busy === 'item:flow'} onClick=${() => ctx.toggleOpenItem('flow')}>${item('flow') ? a('offWorklist') : a('toWorklist')}<//>
          <//>
          ${flowShown ? html`<${Panel} text=${ctx.flow} />` : null}
        <//>
        <${Row}>
          <${Name} meta=${ctx.buildLength ? a('buildMeta', { n: fmt(ctx.buildLength) }) : a('buildMetaShort')}>${a('buildTitle')}<//>
          <${Desc}>${a('buildDesc')}<//>
          <${Doors}>
            <${Action} small row disabled=${ctx.busy === 'build'} onMouseEnter=${ctx.prefetchBuild} onFocus=${ctx.prefetchBuild} onClick=${ctx.copyBuild}>${a('copy')}<//>
            <${Action} small row soft href=${buildPromptFileUrl()} download="aimeat-build-app.txt">${a('downloadFile')}<//>
            <${Action} small row soft disabled=${ctx.busy === 'item:build'} onClick=${() => ctx.toggleOpenItem('build')}>${item('build') ? a('offWorklist') : a('toWorklist')}<//>
          <//>
        <//>
      <//>
      <${List} cols="tag-name" keepCols dense apart>
        <${Row}><${Cell} sign>T1<//><${Cell}>${a('tier1')}<//><//>
        <${Row}><${Cell} sign>T2<//><${Cell}>${a('tier2')}<//><//>
        <${Row}><${Cell} sign>T3<//><${Cell}>${a('tier3')}<//><//>
      <//>
      <${Note}>${a('startHint', { templates: ctx.templates, packs: ctx.packs, proven: ctx.packsProven })} <${Action} tone="link" href=${catalogUrl()} newTab>${t('profile.apps.launcherTitle')}<//><//>
    <//>`;
}

/* ── 01 · The pitfalls the agents filed ───────────────────────────────────────────────────────── */

function secLearned(ctx, nr, none) {
  const L = ctx.learned;
  const F = ctx.filters;
  const scope = L?.facets || {};
  const areas = Object.entries(scope.category || {}).sort((p, q) => q[1] - p[1]);
  const shownAreas = ctx.allAreas ? areas : areas.slice(0, 7);
  const models = Object.entries(scope.model || {}).sort((p, q) => q[1] - p[1]);
  const rows = L?.pitfalls || [];
  const filed = sum(scope.status);
  return html`
    <${Section} id="ad-learned" num=${nr} title=${a('secLearned')} count=${L ? filed : null} first>
      ${none ? html`<${List} rows=${[]} empty=${html`<${Note} kind="quiet"><b>${a('learnedEmptyHead')}</b> ${a('learnedEmptyBody')}<//>`} />`
        : !L ? html`<${List} loading=${t('common.loading')} />` : html`
        <${Filters}>
          ${facet(!F.severity && F.status === 'active' && F.shared === undefined, a('facetAll'), scope.status?.active || 0, () => ctx.setFilters({ severity: '', status: 'active', shared: undefined }), 'all')}
          ${['critical', 'warn', 'info'].map((s) => facet(F.severity === s, a('facet.' + s), scope.severity?.[s] || 0, () => ctx.setFilters({ severity: F.severity === s ? '' : s }), s))}
          ${facet(F.shared === false, a('facetPrivate'), scope.shared?.private || 0, () => ctx.setFilters({ shared: F.shared === false ? undefined : false }), 'private')}
          ${facet(F.status === 'outdated', a('facetOutdated'), scope.status?.outdated || 0, () => ctx.setFilters({ status: F.status === 'outdated' ? 'active' : 'outdated' }), 'outdated')}
          ${L.community || F.includeShared ? facet(!!F.includeShared, a('communityMark'), L.community, () => ctx.setFilters({ includeShared: !F.includeShared }), 'community') : null}
        <//>
        <${Filters}>
          ${shownAreas.map(([k, n]) => facet(F.category === k, areaLabel(k), n, () => ctx.setFilters({ category: F.category === k ? '' : k }), 'c' + k))}
          ${areas.length > 7 && !ctx.allAreas ? html`<${Action} tone="more" onClick=${() => ctx.setAllAreas(true)}>${a('moreAreas', { n: areas.length - 7 })}<//>` : null}
          ${models.map(([k, n]) => facet(F.model === k, k, n, () => ctx.setFilters({ model: F.model === k ? '' : k }), 'm' + k))}
        <//>
        <${SearchLine} value=${ctx.q} placeholder=${a('searchPlaceholder')} onInput=${(e) => ctx.setQ(e.target.value)} note=${a('searchOrder', { n: L.limit })} />
        <${List} cols="state-name-who-doors" keepCols empty=${a('learnedNoMatch')}
          head=${[a('colSeverity'), a('colPitfall'), a('colAreaModel'), '']}>
          ${rows.map((p) => learnedRow(ctx, p))}
        <//>
        <${More} label=${a('showMore', { n: Math.min(L.limit, L.total - rows.length) })} onMore=${rows.length < L.total ? ctx.loadMore : null}
          disabled=${ctx.busy === 'more'} note=${a('shownOf', { shown: rows.length, total: L.total })} />
        <${Note}>${a('learnedHint')}<//>
        <${Note}>${L.community ? a('communityHint', { n: L.community }) : a('communityNone')}<//>`}
    <//>`;
}

/* ── Template proposals: drawn only when there are some ───────────────────────────────────────── */

function secProposals(ctx, nr, proposals) {
  return html`
    <${Section} id="ad-proposals" num=${nr} title=${a('secProposals')} count=${proposals.length}>
      <${List} cols="state-name-who-doors" keepCols empty=${a('proposalsEmpty')}
        head=${[a('colTier'), a('colTemplate'), a('colModelSource'), '']}
        rows=${proposals} render=${(p) => proposalRow(ctx, p)} />
      <${Note}>${a('proposalsHint')}<//>
    <//>`;
}

/* ── The platform's own registry: one row with its count, opened in place ─────────────────────── */

function secCurated(ctx, nr, none, open) {
  const S = ctx.curatedSummary;
  const C = ctx.curated;
  const F = ctx.curatedFilter;
  const areas = Object.entries(S?.facets?.applies_to || {}).sort((p, q) => q[1] - p[1]);
  let rows = C?.pitfalls || [];
  if (F.severity) rows = rows.filter((p) => p.severity === F.severity);
  if (F.area) rows = rows.filter((p) => (p.appliesTo || []).includes(F.area));
  return html`
    <${Section} fold id="ad-curated" num=${nr} title=${a('secCurated')} sub=${S ? a('curatedSub', { n: S.total }) : ''} open=${open} onToggle=${() => ctx.setFold('curated', !open)}>
      ${S && !C ? html`<${Actions}><${Action} small soft disabled=${ctx.busy === 'curated'} onClick=${ctx.loadCurated}>${a('showRows', { n: S.total })}<//><//>` : null}
      ${!S ? html`<${List} loading=${t('common.loading')} />` : html`
        <${Filters}>
          ${facet(!F.severity, a('facetAll'), S.total, () => ctx.setCuratedFilter({ severity: '' }), 'all')}
          ${['critical', 'warn', 'info'].map((s) => facet(F.severity === s, a('facet.' + s), S.facets?.severity?.[s] || 0, () => ctx.setCuratedFilter({ severity: F.severity === s ? '' : s }), s))}
          ${areas.map(([k, n]) => facet(F.area === k, areaLabel(k), n, () => ctx.setCuratedFilter({ area: F.area === k ? '' : k }), 'c' + k))}
        <//>
        ${C ? html`
          <${List} cols="state-name-who-doors" keepCols head=${[a('colSeverity'), a('colPitfall'), a('colAreas'), '']}>
            ${rows.map((p) => curatedRow(ctx, p))}
          <//>` : null}`}
      <${Note}>${none ? a('curatedHintNew') : a('curatedHint')}<//>
    <//>`;
}
