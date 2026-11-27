/**
 * @file public/views/profile/libraries/page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Libraries page in the poster face: the builder's shelf. The mast and the strip;
 *   three shelves as rows (the base the app signs in and stores with, the ready-made UI a cortex
 *   gives, the third-party libraries served from this node at a fixed version), each with a filter
 *   row and a search; as rows that open in place, the faces with their licences and the rule an AI
 *   copies with the facts of how a library is chosen, proven and used. The page explains itself the
 *   designed way (.claude/rules/page-guidance.md): the start (PageStart "libraries") and the
 *   title's question mark (concept.library). What opens under a row is rows.js. Pure render over
 *   the ctx bag.
 * @structure renderPage · shelf · secFaces · secAI
 * @usage import { renderPage } from './libraries/page.js';
 * @version-history
 *   v1.23.0 -- 2026-11-27 -- Usability round 3: each shelf is one row that says how many libraries it
 *     holds, how many an app loads and how many deprecated ones the reader's apps still load; a shelf
 *     opens by itself only when it holds a library in use (the 84 open rows made the page 12 800 px).
 *     The shelf's old count words are its lead. The head's deprecated tag went: it counted every
 *     deprecated library on the node (3) where the strip counts the ones the reader's apps still load
 *     (1); the strip's rule is the one kept, and each shelf's Deprecated filter counts the node's.
 *   v1.22.0 -- 2026-11-27 -- Usability pass of the Settings pages: the three shelves stay open; the
 *     faces and the AI rule with its facts are rows that say their state and open in place. A
 *     deprecated library one of the reader's own apps still loads leads its shelf, its count leads
 *     the strip in the notice tone, and its row names the apps. The strip is the whole shelf (its
 *     three parts under it) and the apps that load a library, instead of one figure per shelf that
 *     repeated the rail's counts; the head's marks that repeated the strip are gone (the proven and
 *     deprecated marks stay). The AI row's heading is a noun phrase.
 *   v1.21.0 -- 2026-11-08 -- A shelf's filter row names its two groups whose words a person cannot read, and each group label opens its explanation: Model (third-party shelf, term libraries.modelTier) and Status (every shelf, term libraries.status) (.claude/rules/page-guidance.md).
 *   v1.20.0 -- 2026-11-08 -- The page explains itself the designed way (.claude/rules/page-guidance.md): PageStart "libraries" and the title's question mark concept.library; the lead of section 05 explained the concept, so its words moved into the concept; the head's paragraph is two sentences.
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
import { FoldSection } from '/components/FoldSection.js';
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
import { PageStart } from '/components/PageStart.js';
import { HelpLabel } from '/components/HelpTip.js';

const PAGE = 20;
const facet = (on, label, n, onClick, key) => html`<${Filter} key=${key} on=${on} count=${n} onClick=${onClick}>${label}<//>`;
/** The label before a group of filters whose words need explaining; it opens the explanation. */
const groupLabel = (term, words) => html`<${Label} key=${'k-' + term}><${HelpLabel} term=${term} label=${words}>${words}<//><//>`;
const matches = (q, ...fields) => !q || fields.some((f) => String(f || '').toLowerCase().includes(q));
const used = (p) => p.used_by?.apps || 0;
const proven = (p) => (p.proofs || []).length > 0;
/** Deprecated, and loaded by one of the reader's own apps (libraries-tab.js `appsUsing.mine`). */
const isStale = (ctx, p) => p.status === 'deprecated' && (ctx.appsUsing?.mine?.[p.id] || []).length > 0;

export function renderPage(ctx) {
  const packs = ctx.packs;   // null while loading
  const all = packs || [];
  const base = all.filter((p) => shelfOf(p) === 'base');
  const ui = all.filter((p) => shelfOf(p) === 'ui');
  const third = all.filter((p) => shelfOf(p) === 'third');
  const inUse = all.filter((p) => used(p) > 0).length;
  const provenN = all.filter(proven).length;
  const appsUsing = ctx.appsUsing;   // { using, total, mine } or null
  const top = all.slice().sort((a, b) => used(b) - used(a)).slice(0, 3).filter((p) => used(p) > 0).map((p) => `${p.id} ${used(p)}`).join(' · ');
  // A deprecated library that one of the reader's own apps still loads: the one thing here that
  // asks something of them (move the app to the named replacement).
  const stale = all.filter((p) => isStale(ctx, p));

  // The figures, from what the page already read: the deprecated libraries the reader's apps still
  // load (only when there are any, first and in the notice tone), the whole shelf with its three
  // parts, and how many apps load a library. The shelf is the node's, never empty, so the strip
  // has no empty case.
  const strip = !packs ? html`<${FigureStrip} loading=${2} />` : html`<${FigureStrip} items=${[
    stale.length ? { key: 'stale', n: stale.length, tone: 'notice', label: x('stripStale'), sub: x('stripStaleSub', { list: stale.map((p) => p.id).join(', ') }) } : null,
    { key: 'all', n: all.length, label: x('stripAll'), sub: x('stripAllSub', { base: base.length, ui: ui.length, third: third.length }) },
    { key: 'apps', n: appsUsing ? appsUsing.using : inUse, label: appsUsing ? x('stripApps', { total: appsUsing.total }) : x('stripInUse'),
      sub: top ? x('stripTop', { list: top }) : '' },
  ]} />`;
  const sections = [
    { id: 'lb-base', label: x('secBase'), count: packs ? base.length : '', open: () => ctx.setFold('base', true) },
    { id: 'lb-ui', label: x('secUi'), count: packs ? ui.length : '', open: () => ctx.setFold('ui', true) },
    { id: 'lb-third', label: x('secThird'), count: packs ? third.length : '', open: () => ctx.setFold('third', true) },
    { id: 'lb-faces', label: x('secFaces'), count: ctx.fonts ? ctx.fonts.base.length + ctx.fonts.added.length : '' },
    { id: 'lb-ai', label: x('secAi'), count: '' },
  ].map((s, i) => ({ ...s, num: String(i + 1).padStart(2, '0') }));

  return html`
    <${SettingsPage} name="libs"
      crumb=${crumb()}
      title=${t('librariesTab.tabLabel')}
      sub=${x('titleSub')}
      help="concept.library"
      marks=${/* The deprecated count is said once: the strip's (deprecated AND loaded by the reader's
        own apps), the one that asks something of the reader. The tag counted every deprecated library
        on the node (3 against the strip's 1); each shelf's Deprecated filter still counts those. */
        packs ? [{ label: x('chipProven', { n: provenN }) }] : []}
      desc=${x('desc')}
      actions=${html`
        <${Loud} copy=${aiRule(ctx.nodeUrl)} copiedLabel=${x('copied')} onCopied=${() => ctx.showToast?.(x('ruleCopiedToast'))}>${x('copyRule')}<//>
        <${Actions}><${Action} small href="https://design-book.apps.aimeat.io/" newTab>Design Book<//><//>`}
      start=${html`<${PageStart} id="libraries" />`}
      strip=${strip}
      railTitle=${x('railTitle')}
      sections=${sections}
      pagesLabel=${x('pages')}
      pages=${pageLinks()}>
      ${shelf(ctx, 'base', '01', x('secBase'), base)}
      ${shelf(ctx, 'ui', '02', x('secUi'), ui)}
      ${shelf(ctx, 'third', '03', x('secThird'), third)}
      ${secFaces(ctx, '04')}
      ${secAI(ctx, '05', all)}
    <//>`;
}

/* ── One shelf: facets, search, rows ─────────────────────────────────────────────────────────── */

function shelf(ctx, key, num, title, list) {
  const F = ctx.filters[key];
  // One row that says how many libraries the shelf holds and how many an app loads. It opens by
  // itself only when it holds a library in use (or a deprecated one the reader's apps still load):
  // 84 open rows made a 12 800 px page. The person's own press wins from then on.
  const inUseN = list.filter((p) => used(p) > 0).length;
  const staleN = list.filter((p) => isStale(ctx, p)).length;
  const open = ctx.folds?.[key] ?? (inUseN > 0 || staleN > 0);
  const foldSub = !ctx.packs ? null : [x('shelfCount', { n: list.length }), x('shelfInUse', { n: inUseN }),
    staleN ? x('shelfStale', { n: staleN }) : null].filter(Boolean).join(' · ');
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
  // A deprecated library one of the reader's apps still loads comes first; then the most used.
  const staleRank = (p) => (isStale(ctx, p) ? 0 : 1);
  rows = rows.slice().sort((a, b) => staleRank(a) - staleRank(b) || used(b) - used(a) || String(a.title || a.id).localeCompare(String(b.title || b.id)));
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
      groupLabel('libraries.modelTier', x('filterModel')),
      facet(F.model === 'any', x('model.any'), count((p) => p.modelTier === 'any'), () => tog('model', 'any'), 'any'),
      facet(F.model === 'frontier', x('model.frontier'), count((p) => p.modelTier === 'frontier'), () => tog('model', 'frontier'), 'frontier'),
    ] : []),
    groupLabel('libraries.status', x('filterStatus')),
    facet(F.status === 'stable', x('status.stable'), count((p) => p.status === 'stable'), () => tog('status', 'stable'), 'stable'),
    facet(F.status === 'preview', x('status.preview'), count((p) => p.status === 'preview'), () => tog('status', 'preview'), 'preview'),
    ...(count((p) => p.status === 'deprecated') ? [facet(F.status === 'deprecated', x('status.deprecated'), count((p) => p.status === 'deprecated'), () => tog('status', 'deprecated'), 'deprecated')] : []),
    facet(F.use === 'used', x('facetUsed'), count((p) => used(p) > 0), () => tog('use', 'used'), 'used'),
    facet(F.use === 'unused', x('facetUnused'), count((p) => used(p) === 0), () => tog('use', 'unused'), 'unused'),
    ...(count(proven) ? [facet(!!F.proven, x('facetProven'), count(proven), () => set({ proven: !F.proven }), 'proven')] : []),
  ];
  const ids = { base: 'lb-base', ui: 'lb-ui', third: 'lb-third' };
  return html`
    <${FoldSection} id=${ids[key]} num=${num} title=${title} sub=${foldSub} open=${open} onToggle=${() => ctx.setFold(key, !open)}>
      ${!ctx.packs ? html`<${Note} kind="loading">${t('common.loading')}<//>` : html`
        <${Note} kind="lead">${x(`sec${key === 'base' ? 'Base' : key === 'ui' ? 'Ui' : 'Third'}Sub`)}<//>
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
  // One row that says how many faces there are, and how many nobody stated a licence for.
  const unknown = f ? [...f.added, ...f.base].filter((face) => face.licenceStatus === 'unknown').length : 0;
  const sub = f ? `${x('facesCount', { base: f.base.length, added: f.added.length })}${unknown ? ` · ${x('facesUnknownN', { n: unknown })}` : ''}` : null;
  return html`
    <${FoldSection} id="lb-faces" num=${num} title=${x('secFaces')} sub=${sub} open=${!!ctx.folds?.faces} onToggle=${() => ctx.setFold('faces', !ctx.folds?.faces)}>
      ${!f ? html`<${Note} kind="loading">${t('common.loading')}<//>` : html`
        <${Note} kind="lead">${x('facesIntro')}<//>
        <${Facts} wide rows=${[...f.added.map(row), ...f.base.map(row)]} />`}
    <//>`;
}

/* ── How an AI takes a library into use: the rule to copy and the facts (the concept: concept.library) ── */

function secAI(ctx, num, all) {
  const proofs = all.reduce((s, p) => s + (p.proofs || []).length, 0);
  const passed = all.reduce((s, p) => s + (p.proofs || []).filter((pr) => pr.verdict === 'pass').length, 0);
  const inUse = all.filter((p) => used(p) > 0).length;
  const appsUsing = ctx.appsUsing;
  return html`
    <${FoldSection} id="lb-ai" num=${num} title=${x('secAi')} sub=${x('aiSub')} open=${!!ctx.folds?.ai} onToggle=${() => ctx.setFold('ai', !ctx.folds?.ai)}>
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
