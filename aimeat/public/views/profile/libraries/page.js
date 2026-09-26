/**
 * @file public/views/profile/libraries/page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Libraries page in the poster face: the builder's shelf. The mast and the strip;
 *   three shelves as rows (the base the app signs in and stores with, the ready-made UI a cortex
 *   gives, the third-party libraries served from this node at a fixed version), each with a filter
 *   row and a search; and the fourth section that says how an AI takes a library into use. What
 *   opens under a row is rows.js. Pure render over the ctx bag.
 * @structure renderPage · shelf · secAI
 * @usage import { renderPage } from './libraries/page.js';
 * @version-history
 *   v1.17.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.16.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.15.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.14.0 -- 2026-09-25 -- A filter's count is the Count (.poster-count, tally), a unification: Jouni's decision "Count".
 *   v1.13.0 -- 2026-09-25 -- The line under the list (show more, how many shown) is the More line (.more-line, css/components/more-line.css), a library part by a move.
 *   v1.12.0 -- 2026-09-25 -- The AI section facts are the Facts (facts, facts-k, facts-v), a unification: the look most tabs use.
 *   v1.11.0 -- 2026-09-25 -- The shelves are the Listing (listing, listing-row, its head row), a unification: the look most tabs use.
 *   v1.10.0 -- 2026-09-25 -- A search field over a list is the Search line (.search-line with the Text field); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.9.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.8.0 -- 2026-09-25 -- A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v1.7.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.6.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.5.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.4.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   v1.3.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.2.0 -- 2026-09-13 -- Compose the existing instruction frame from poster.css.
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { PageSection } from '/components/PageSection.js';
import { scrollTo } from '/views/profile/organisms/poster-parts.js';
import { x, shelfOf, isCommunity, crumb, pageLinks, aiRule } from './frame.js';
import { packRow } from './rows.js';
import { Hint } from '/components/Hint.js';

const PAGE = 20;
const facet = (on, label, n, onClick, key) => html`<button type="button" key=${key} class=${`poster-tab poster-tab--filter ${on ? 'is-on' : ''}`} onClick=${onClick}>${label}<span class="poster-count poster-count--tally">${n}</span></button>`;
const matches = (q, ...fields) => !q || fields.some((f) => String(f || '').toLowerCase().includes(q));
const used = (p) => p.used_by?.apps || 0;
const proven = (p) => (p.proofs || []).length > 0;

export function renderPage(ctx) {
  const packs = ctx.packs;   // null while loading
  const all = packs || [];
  const base = all.filter((p) => shelfOf(p) === 'base');
  const ui = all.filter((p) => shelfOf(p) === 'ui');
  const third = all.filter((p) => shelfOf(p) === 'third');
  const inUse = all.filter((p) => used(p) > 0).length;
  const provenN = all.filter(proven).length;
  const deprecatedN = all.filter((p) => p.status === 'deprecated').length;
  const appsUsing = ctx.appsUsing;   // { using, total } or null
  const chip = (text, cls = '') => html`<span class=${`poster-chip ${cls}`}>${text}</span>`;
  const top = all.slice().sort((a, b) => used(b) - used(a)).slice(0, 3).filter((p) => used(p) > 0).map((p) => `${p.id} ${used(p)}`).join(' · ');

  const strip = html`
    <div class="og-strip">
      <div><b>${packs ? base.length : '…'}</b><span>${x('stripBase')}</span><small>${x('stripBaseSub')}${deprecatedN && base.some((p) => p.status === 'deprecated') ? ` · ${x('deprecatedN', { n: base.filter((p) => p.status === 'deprecated').length })}` : ''}</small></div>
      <div><b>${packs ? ui.length : '…'}</b><span>${x('stripUi')}</span><small>${packs ? x('stripUiSub', { node: ui.filter((p) => !isCommunity(p)).length, community: ui.filter(isCommunity).length }) : ''}</small></div>
      <div><b>${packs ? third.length : '…'}</b><span>${x('stripThird')}</span><small>${x('stripThirdSub')}${third.some((p) => p.status === 'deprecated') ? ` · ${x('deprecatedN', { n: third.filter((p) => p.status === 'deprecated').length })}` : ''}</small></div>
      <div><b>${appsUsing ? appsUsing.using : (packs ? inUse : '…')}</b><span>${appsUsing ? x('stripApps', { total: appsUsing.total }) : x('stripInUse')}</span><small>${top ? x('stripTop', { list: top }) : ''}</small></div>
    </div>`;

  return html`
    <div class="og og-libs">
      ${crumb()}
      <div class="og-mast">
        <div class="og-mast-words">
          <h1 class="og-title poster-page-title">${t('librariesTab.tabLabel')}<small>${x('titleSub')}</small></h1>
          <div class="poster-chips">
            ${packs ? chip(x('chipAll', { n: all.length }), 'poster-chip--sun') : null}
            ${packs ? chip(x('chipInUse', { n: inUse })) : null}
            ${packs ? chip(x('chipProven', { n: provenN })) : null}
            ${packs && deprecatedN ? chip(x('chipDeprecated', { n: deprecatedN })) : null}
          </div>
          <p class="og-desc">${x('desc')}</p>
        </div>
        <div class="og-mast-actions">
          <${CopyButton} text=${aiRule(ctx.nodeUrl)} className="poster-slab" label=${x('copyRule')} copiedLabel=${x('copied')} onCopied=${() => ctx.showToast?.(x('ruleCopiedToast'))} />
          <div class="og-doors"><a class="poster-action poster-action--small" href="https://design-book.apps.aimeat.io/" target="_blank" rel="noopener">Design Book</a></div>
        </div>
      </div>
      ${strip}
      <div class="og-grid">
        <div class="og-main">
          ${shelf(ctx, 'base', '01', x('secBase'), x('secBaseSub'), base, true)}
          ${shelf(ctx, 'ui', '02', x('secUi'), x('secUiSub'), ui, false)}
          ${shelf(ctx, 'third', '03', x('secThird'), x('secThirdSub'), third, false)}
          ${secAI(ctx, '04', all)}
        </div>
        <nav class="og-rail" aria-label=${x('railTitle')}>
          <span class="og-rail-label">${x('railTitle')}</span>
          ${[['01', 'lb-base', x('secBase'), packs ? base.length : ''], ['02', 'lb-ui', x('secUi'), packs ? ui.length : ''], ['03', 'lb-third', x('secThird'), packs ? third.length : ''], ['04', 'lb-ai', x('secAi'), '']].map(([n, id, label, count]) => html`<button type="button" class="og-rail-link" key=${id} onClick=${() => scrollTo(id)}><i>${n}</i>${label}<em>${count}</em></button>`)}
          <hr />
          <span class="og-rail-label">${x('pages')}</span>
          ${pageLinks()}
        </nav>
      </div>
    </div>`;
}

/* ── One shelf: facets, search, rows ─────────────────────────────────────────────────────────── */

function shelf(ctx, key, num, title, sub, list, first) {
  const F = ctx.filters[key];
  const q = (ctx.queries[key] || '').trim().toLowerCase();
  const count = (f) => list.filter(f).length;
  let rows = list;
  if (F.status) rows = rows.filter((p) => p.status === F.status);
  if (F.model) rows = rows.filter((p) => p.modelTier === F.model);
  if (F.use === 'used') rows = rows.filter((p) => used(p) > 0);
  if (F.use === 'unused') rows = rows.filter((p) => used(p) === 0);
  if (F.proven) rows = rows.filter(proven);
  if (F.who === 'node') rows = rows.filter((p) => !isCommunity(p));
  if (F.who === 'community') rows = rows.filter(isCommunity);
  if (q) rows = rows.filter((p) => matches(q, p.id, p.title, p.description, p.apiSurface, (p.interviewTriggers || []).join(' ')));
  rows = rows.slice().sort((a, b) => used(b) - used(a) || String(a.title || a.id).localeCompare(String(b.title || b.id)));
  const shown = rows.slice(0, ctx.shown[key]);
  const set = (patch) => ctx.setFilter(key, patch);
  const tog = (field, value) => set({ [field]: F[field] === value ? '' : value });
  const facets = [
    facet(!F.status && !F.model && !F.use && !F.proven && !F.who, x('facetAll'), list.length, () => set({ status: '', model: '', use: '', proven: false, who: '' }), 'all'),
    ...(key === 'ui' ? [
      facet(F.who === 'node', x('facetNode'), count((p) => !isCommunity(p)), () => tog('who', 'node'), 'node'),
      facet(F.who === 'community', x('facetCommunity'), count(isCommunity), () => tog('who', 'community'), 'community'),
    ] : []),
    ...(key === 'third' ? [
      facet(F.model === 'any', x('model.any'), count((p) => p.modelTier === 'any'), () => tog('model', 'any'), 'any'),
      facet(F.model === 'frontier', x('model.frontier'), count((p) => p.modelTier === 'frontier'), () => tog('model', 'frontier'), 'frontier'),
    ] : []),
    facet(F.status === 'stable', x('status.stable'), count((p) => p.status === 'stable'), () => tog('status', 'stable'), 'stable'),
    facet(F.status === 'preview', x('status.preview'), count((p) => p.status === 'preview'), () => tog('status', 'preview'), 'preview'),
    ...(count((p) => p.status === 'deprecated') ? [facet(F.status === 'deprecated', x('status.deprecated'), count((p) => p.status === 'deprecated'), () => tog('status', 'deprecated'), 'deprecated')] : []),
    facet(F.use === 'used', x('facetUsed'), count((p) => used(p) > 0), () => tog('use', 'used'), 'used'),
    facet(F.use === 'unused', x('facetUnused'), count((p) => used(p) === 0), () => tog('use', 'unused'), 'unused'),
    ...(count(proven) ? [facet(!!F.proven, x('facetProven'), count(proven), () => set({ proven: !F.proven }), 'proven')] : []),
  ];
  const ids = { base: 'lb-base', ui: 'lb-ui', third: 'lb-third' };
  return html`
    <${PageSection} id=${ids[key]} num=${num} title=${title} count=${ctx.packs ? sub : null} first=${first}>
      ${!ctx.packs ? html`<p class="poster-quiet lb-empty loading-mark">${t('common.loading')}</p>` : html`
        <div class="lb-facets">${facets}</div>
        <div class="search-line"><input class="og-input" type="search" value=${ctx.queries[key] || ''} placeholder=${x('search.' + key)} aria-label=${x('search.' + key)} onInput=${(e) => ctx.setQuery(key, e.target.value)} /><small>${x('searchOrder')}</small></div>
        ${!rows.length ? html`<p class="poster-quiet lb-empty">${key === 'ui' && F.who === 'community' && !count(isCommunity) ? x('communityEmpty') : x('noMatch')}</p>` : html`
          <div class="listing listing--name-desc-api-doors">
            <div class="listing-row listing-row--head"><div class="poster-label">${x('col.' + key)}</div><div class="poster-label">${key === 'ui' ? x('colGives') : x('colDoes')}</div><div class="poster-label">${x('colInApp')}</div><div class="poster-label"></div></div>
            ${shown.map((p) => packRow(ctx, p))}
          </div>`}
        <div class="more-line">
          ${shown.length < rows.length ? html`<button type="button" class="poster-action poster-action--more" onClick=${() => ctx.setShown(key, ctx.shown[key] + PAGE)}>${x('showMore', { n: Math.min(PAGE, rows.length - shown.length) })}</button>` : null}
          <small>${x('shownOf', { shown: shown.length, total: rows.length })}</small>
        </div>
        <${Hint}>${x('hint.' + key)}<//>`}
    <//>`;
}

/* ── How an AI takes a library into use ──────────────────────────────────────────────────────── */

function secAI(ctx, num, all) {
  const proofs = all.reduce((s, p) => s + (p.proofs || []).length, 0);
  const passed = all.reduce((s, p) => s + (p.proofs || []).filter((pr) => pr.verdict === 'pass').length, 0);
  const inUse = all.filter((p) => used(p) > 0).length;
  const appsUsing = ctx.appsUsing;
  return html`
    <${PageSection} id="lb-ai" num=${num} title=${x('secAi')} count=${null}>
      <p class="og-lead">${x('aiIntro')}</p>
      <div class="lb-rule poster-box">
        <span class="poster-label">${x('ruleLabel')}</span>
        <p class="og-lead">${x('ruleBody', { base: ctx.nodeUrl })}</p>
        <div class="og-doors"><${CopyButton} text=${aiRule(ctx.nodeUrl)} className="poster-action poster-action--small" label=${x('copyRule')} copiedLabel=${x('copied')} /></div>
      </div>
      <div class="facts facts--wide">
        <div class="facts-k poster-label">${x('aiModelK')}</div><div class="facts-v">${x('aiModelBody')}<small>${x('aiModelSub')}</small></div>
        <div class="facts-k poster-label">${x('aiProvenK')}</div><div class="facts-v">${x('aiProvenBody', { n: all.filter(proven).length, runs: proofs, passed, failed: proofs - passed })}<small>${x('aiProvenSub')}</small></div>
        <div class="facts-k poster-label">${x('aiUsedK')}</div><div class="facts-v">${appsUsing ? x('aiUsedBody', { using: appsUsing.using, total: appsUsing.total, libs: inUse, unused: all.length - inUse }) : x('aiUsedBodyShort', { libs: inUse, unused: all.length - inUse })}</div>
      </div>
    <//>`;
}
