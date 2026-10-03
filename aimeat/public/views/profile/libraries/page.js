/**
 * @file public/views/profile/libraries/page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Libraries page in the poster face: the builder's shelf. The mast and the strip;
 *   three shelves as rows (the base the app signs in and stores with, the ready-made UI a cortex
 *   gives, the third-party libraries served from this node at a fixed version), each with a filter
 *   row and a search; and the fourth section that says how an AI takes a library into use. What
 *   opens under a row is rows.js. Pure render over the ctx bag.
 * @structure renderPage · shelf · secFaces · secAI
 * @usage import { renderPage } from './libraries/page.js';
 * @version-history
 *   v1.19.0 -- 2026-10-03 -- Section 04, Faces: every face this server serves with its licence, an added face marked as added and one with no licence data as a warning (the font manager); the AI section is 05.
 *   v1.18.0 -- 2026-09-26 -- Every part is a kit component (SettingsPage with its crumb, tags, loud copy, strip and rail as data; FigureStrip; Filters; SearchLine; List; More; Box; Facts; Note): the page passes data and writes no class (page group G8).
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
import { PageSection } from '/components/PageSection.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Facts } from '/components/Facts.js';
import { Box } from '/components/Box.js';
import { List, Filters, Filter, SearchLine, More } from '/components/List.js';
import { Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { x, shelfOf, isCommunity, crumb, pageLinks, aiRule } from './frame.js';
import { packRow } from './rows.js';
import { Hint } from '/components/Hint.js';

const PAGE = 20;
const facet = (on, label, n, onClick, key) => html`<${Filter} key=${key} on=${on} count=${n} onClick=${onClick}>${label}<//>`;
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
  const top = all.slice().sort((a, b) => used(b) - used(a)).slice(0, 3).filter((p) => used(p) > 0).map((p) => `${p.id} ${used(p)}`).join(' · ');

  const strip = html`<${FigureStrip} items=${[
    { key: 'base', n: packs ? base.length : '…', label: x('stripBase'),
      sub: `${x('stripBaseSub')}${deprecatedN && base.some((p) => p.status === 'deprecated') ? ` · ${x('deprecatedN', { n: base.filter((p) => p.status === 'deprecated').length })}` : ''}` },
    { key: 'ui', n: packs ? ui.length : '…', label: x('stripUi'),
      sub: packs ? x('stripUiSub', { node: ui.filter((p) => !isCommunity(p)).length, community: ui.filter(isCommunity).length }) : '' },
    { key: 'third', n: packs ? third.length : '…', label: x('stripThird'),
      sub: `${x('stripThirdSub')}${third.some((p) => p.status === 'deprecated') ? ` · ${x('deprecatedN', { n: third.filter((p) => p.status === 'deprecated').length })}` : ''}` },
    { key: 'apps', n: appsUsing ? appsUsing.using : (packs ? inUse : '…'), label: appsUsing ? x('stripApps', { total: appsUsing.total }) : x('stripInUse'),
      sub: top ? x('stripTop', { list: top }) : '' },
  ]} />`;

  return html`
    <${SettingsPage} name="libs"
      crumb=${crumb()}
      title=${t('librariesTab.tabLabel')}
      sub=${x('titleSub')}
      marks=${packs ? [
        { label: x('chipAll', { n: all.length }), tone: 'sun' },
        { label: x('chipInUse', { n: inUse }) },
        { label: x('chipProven', { n: provenN }) },
        deprecatedN ? { label: x('chipDeprecated', { n: deprecatedN }) } : null,
      ] : []}
      desc=${x('desc')}
      actions=${html`
        <${Loud} copy=${aiRule(ctx.nodeUrl)} copiedLabel=${x('copied')} onCopied=${() => ctx.showToast?.(x('ruleCopiedToast'))}>${x('copyRule')}<//>
        <${Actions}><${Action} small href="https://design-book.apps.aimeat.io/" newTab>Design Book<//><//>`}
      strip=${strip}
      railTitle=${x('railTitle')}
      sections=${[
        { id: 'lb-base', num: '01', label: x('secBase'), count: packs ? base.length : '' },
        { id: 'lb-ui', num: '02', label: x('secUi'), count: packs ? ui.length : '' },
        { id: 'lb-third', num: '03', label: x('secThird'), count: packs ? third.length : '' },
        { id: 'lb-faces', num: '04', label: x('secFaces'), count: ctx.fonts ? ctx.fonts.base.length + ctx.fonts.added.length : '' },
        { id: 'lb-ai', num: '05', label: x('secAi'), count: '' },
      ]}
      pagesLabel=${x('pages')}
      pages=${pageLinks()}>
      ${shelf(ctx, 'base', '01', x('secBase'), x('secBaseSub'), base, true)}
      ${shelf(ctx, 'ui', '02', x('secUi'), x('secUiSub'), ui, false)}
      ${shelf(ctx, 'third', '03', x('secThird'), x('secThirdSub'), third, false)}
      ${secFaces(ctx, '04')}
      ${secAI(ctx, '05', all)}
    <//>`;
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
      ${!ctx.packs ? html`<${Note} kind="loading">${t('common.loading')}<//>` : html`
        <${Filters}>${facets}<//>
        <${SearchLine} value=${ctx.queries[key] || ''} placeholder=${x('search.' + key)} label=${x('search.' + key)}
          onInput=${(e) => ctx.setQuery(key, e.target.value)} note=${x('searchOrder')} />
        <${List} cols="name-desc-api-doors"
          empty=${key === 'ui' && F.who === 'community' && !count(isCommunity) ? x('communityEmpty') : x('noMatch')}
          head=${rows.length ? [x('col.' + key), key === 'ui' ? x('colGives') : x('colDoes'), x('colInApp'), ''] : null}>
          ${shown.map((p) => packRow(ctx, p))}
        <//>
        <${More}
          label=${x('showMore', { n: Math.min(PAGE, rows.length - shown.length) })}
          onMore=${shown.length < rows.length ? () => ctx.setShown(key, ctx.shown[key] + PAGE) : null}
          note=${x('shownOf', { shown: shown.length, total: rows.length })} />
        <${Hint}>${x('hint.' + key)}<//>`}
    <//>`;
}

/* ── The faces this server serves, with their licences (the font manager) ─────────────────────── */

/**
 * Every face, base and added, with its licence. An added face is always said to be added, never base
 * setup, and one whose licence or copyright holder nobody stated is a warning (Jouni, 2026-10-03).
 */
function secFaces(ctx, num) {
  const f = ctx.fonts;
  const row = (face) => {
    const unknown = face.licenceStatus === 'unknown';
    return {
      key: `${face.origin}:${face.family}`, k: face.family, warn: unknown,
      v: `${face.origin === 'added' ? x('facesAdded') : x('facesBase')} · ${face.licence || x('facesNoLicence')}`,
      sub: unknown ? x('facesUnknown') : (face.copyright || ''), subTone: unknown ? 'notice' : undefined,
    };
  };
  return html`
    <${PageSection} id="lb-faces" num=${num} title=${x('secFaces')} count=${f ? x('facesCount', { base: f.base.length, added: f.added.length }) : null}>
      ${!f ? html`<${Note} kind="loading">${t('common.loading')}<//>` : html`
        <${Note} kind="lead">${x('facesIntro')}<//>
        <${Facts} wide rows=${[...f.added.map(row), ...f.base.map(row)]} />`}
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
      <${Note} kind="lead">${x('aiIntro')}<//>
      <${Box} doors=${html`<${Action} small copy=${aiRule(ctx.nodeUrl)} copiedLabel=${x('copied')}>${x('copyRule')}<//>`}>
        <${Label} block>${x('ruleLabel')}<//>
        <${Note} kind="lead">${x('ruleBody', { base: ctx.nodeUrl })}<//>
      <//>
      <${Facts} wide rows=${[
        { k: x('aiModelK'), v: x('aiModelBody'), sub: x('aiModelSub') },
        { k: x('aiProvenK'), v: x('aiProvenBody', { n: all.filter(proven).length, runs: proofs, passed, failed: proofs - passed }), sub: x('aiProvenSub') },
        { k: x('aiUsedK'), v: appsUsing ? x('aiUsedBody', { using: appsUsing.using, total: appsUsing.total, libs: inUse, unused: all.length - inUse }) : x('aiUsedBodyShort', { libs: inUse, unused: all.length - inUse }) },
      ]} />
    <//>`;
}
