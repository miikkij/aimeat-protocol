/**
 * @file public/views/profile/discover/view.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Discover page in the poster face (design canvas "AIMEAT Löydä-sivu", direction A):
 *   the field is the page. The COVER: one search field with the scope beside it, then what is here
 *   (each kind with its count and where it lives), what changed last among the kinds a person
 *   reads, the places (organisms and their workspaces), and the machine's bookkeeping as a fold.
 *   RESULTS for a query come grouped by kind, best first, the words marked, the bookkeeping counted
 *   but folded. A kind and a place each open as a page of rows. Pure render functions over the ctx
 *   bag discover-tab.js assembles.
 * @structure renderDiscoverView · renderCover · secKinds · secRecent · secPlaces · secBookkeeping · renderResults · renderKind · renderPlace
 * @usage import { renderDiscoverView } from './discover/view.js';
 * @version-history
 *   v1.12.0 -- 2026-09-26 -- The map of kinds, the rows of entries and the hits are the Listing (listing, listing-row and its head row, figure, name, words and doors cells; listing--cols keeps the narrow-screen columns), a unification: the look most tabs use.
 *   v1.11.0 -- 2026-09-26 -- The line under a kind's name is the Listing's typewriter line (.listing-meta), a unification: Jouni's decision "Meta line".
 *   v1.10.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.9.0 -- 2026-09-25 -- "Show more" under a list is the action link's more tone (.poster-action--more), a unification: the look most tabs use.
 *   v1.8.0 -- 2026-09-25 -- The loading line's blinking mark is the library's Loading mark (css/components/loading-mark.css), moved unchanged out of five sheets (UI consolidation phase 5, a move).
 *   v1.7.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.6.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.5.0 -- 2026-09-25 -- The headings over lists wear .poster-day-title, grey (--quiet) over a record (Jouni's decision "Group heading", a unification).
 *   v1.4.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.3.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v1.2.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.1 — 2026-08-30 — Says it is counting, searching or loading rows instead of an ellipsis.
 *   v1.0.0 — 2026-08-30 — Initial. Replaces the scope buttons, the thirteen type chips and the
 *     newest-first dump of every record.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { PageSection } from '/components/PageSection.js';
import { FoldSection } from '/components/FoldSection.js';
import { scrollTo } from '/views/profile/organisms/poster-parts.js';
import { c, num, kindName, kindSub, HUMAN_TYPES, desk, entryRows, entryCells, crumb, renderPage, rel } from './frame.js';
import { Hint } from '/components/Hint.js';

const RECENT_ROWS = 8;

export function renderDiscoverView(ctx) {
  const v = ctx.view;
  if (ctx.query) return renderResults(ctx);
  if (v.kind === 'kind') return renderKind(ctx, v.type);
  if (v.kind === 'place') return renderPlace(ctx, v.organismId, v.organism);
  return renderCover(ctx);
}

/* ── The cover ─────────────────────────────────────────────────────────────────────────────── */
function kindsOf(f) {
  if (!f) return [];
  const book = f.segments.find(s => s.type === 'memory' && s.segment === 'bookkeeping')?.count || 0;
  return f.types.map(x => (x.value === 'memory' ? { ...x, count: x.count - book, book } : x)).filter(x => x.count > 0);
}
function renderCover(ctx) {
  const f = ctx.facets[ctx.scope];
  const kinds = kindsOf(f);
  const book = f?.segments.find(s => s.type === 'memory' && s.segment === 'bookkeeping')?.count || 0;
  const total = f ? f.total - book : 0;
  const places = f?.places || [];
  const orgs = new Set(places.map(p => p.organismId));
  return html`
    <div class="og og-dv">
      ${crumb(ctx, [])}
      <div class="og-mast">
        <div class="og-mast-words">
          <h1 class="og-title poster-page-title">${t('discover.title')}</h1>
          <div class="poster-chips">
            <span class="poster-chip">${c('chipItems', { n: num(total) })}</span><span class="poster-chip">${c('chipKinds', { n: kinds.length })}</span>
            ${orgs.size ? html`<span class="poster-chip">${c('chipOrgs', { n: orgs.size })}</span>` : null}
            ${book ? html`<span class="poster-chip">${c('chipBook', { n: num(book) })}</span>` : null}
            ${ctx.facets.shared?.total ? html`<span class="poster-chip poster-chip--coral">${c('chipShared', { n: num(ctx.facets.shared.total) })}</span>` : null}
          </div>
          <p class="og-desc">${c('desc')}</p>
        </div>
        <div class="og-mast-actions"><div class="og-doors">
          <button type="button" class="poster-action poster-action--small" onClick=${() => ctx.openTab('memory')}>${t('profile.memory.title')}</button>
          <button type="button" class="poster-action poster-action--small" onClick=${() => ctx.openTab('knowledge')}>${t('knowledge.tabLabel')}</button>
        </div></div>
      </div>
      ${desk(ctx)}
      <div class="og-grid">
        <div class="og-main">
          ${secKinds(ctx, kinds)}
          ${secRecent(ctx)}
          ${secPlaces(ctx, places)}
          ${secBookkeeping(ctx, book)}
        </div>
        <nav class="og-rail" aria-label=${c('railTitle')}>
          <span class="og-rail-label">${c('railTitle')}</span>
          ${[['01', 'dv-kinds', c('secKinds'), kinds.length], ['02', 'dv-recent', c('secRecent'), ''], ['03', 'dv-places', c('secPlaces'), orgs.size], ['04', 'dv-book', c('secBook'), num(book)]]
            .map(([n, id, label, count]) => html`<button type="button" class="og-rail-link" key=${id} onClick=${() => scrollTo(id)}><i>${n}</i>${label}<em>${count}</em></button>`)}
          <hr />
          <span class="og-rail-label">${c('scopes')}</span>
          ${['own', 'public', 'shared'].map(s => html`<button type="button" class=${`og-rail-link ${ctx.scope === s ? 'on' : ''}`} key=${s} onClick=${() => ctx.setScope(s)}><i>→</i>${t('discover.scope.' + s)}<em>${ctx.facets[s] ? num(ctx.facets[s].total) : '→'}</em></button>`)}
        </nav>
      </div>
    </div>`;
}

/* ── 01 What is here ───────────────────────────────────────────────────────────────────────── */
function whereOf(f, type) {
  const segs = f.segments.filter(s => s.type === type && s.segment !== 'bookkeeping').slice(0, 3);
  return segs.map((s, i) => html`${i ? ' · ' : ''}${s.segment} <b>${num(s.count)}</b>`);
}
function secKinds(ctx, kinds) {
  const f = ctx.facets[ctx.scope];
  const capped = ctx.scope === 'public';
  return html`<${PageSection} id="dv-kinds" num="01" title=${c('secKinds')} count=${c('secKindsSub', { n: kinds.length })} first=${true}>
    ${!f ? html`<p class="poster-quiet loading-mark">${c('loading')}</p>` : !kinds.length ? html`<p class="poster-quiet">${t('discover.empty')}</p>` : html`
      <div class="listing listing--cols listing--n-name-where-doors">
        <div class="listing-row listing-row--head"><div class="poster-label"></div><div class="poster-label">${c('colKind')}</div><div class="poster-label">${c('colWhere')}</div><div class="poster-label"></div></div>
        ${kinds.map(k => html`
          <div class="listing-row" key=${k.value}>
            <div class="listing-n dv-n poster-stat-number poster-stat-number--small">${num(k.count)}${capped && k.count >= 50 ? '+' : ''}</div>
            <div class="listing-name"><button type="button" class="og-tbl-name" onClick=${() => ctx.pickView({ kind: 'kind', type: k.value })}>${kindName(k.value)}</button><small class="listing-meta">${kindSub(k.value)}</small></div>
            <div class="listing-desc">${whereOf(f, k.value)}</div>
            <div class="listing-doors"><button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.pickView({ kind: 'kind', type: k.value })}>${c('browse')}</button></div>
          </div>`)}
      </div>`}
  <//>`;
}

/* ── 02 What changed last ──────────────────────────────────────────────────────────────────── */
function secRecent(ctx) {
  const all = ctx.recent[ctx.scope] || null;
  const filt = ctx.recentType;
  const list = all ? (filt ? all.filter(e => e.type === filt) : all) : [];
  const shown = ctx.recentOpen ? list : list.slice(0, RECENT_ROWS);
  const present = all ? [...new Set(all.map(e => e.type))] : [];
  const doorFor = (type, label) => html`<button type="button" key=${type || 'all'} class=${`poster-tab poster-tab--fold ${filt === type ? 'is-on' : ''}`} onClick=${() => ctx.setRecentType(type)}>${label}</button>`;
  const doors = html`${doorFor('', c('allKinds'))}${['document', 'knowledge', 'skill', 'decision'].filter(x => present.includes(x)).map(x => doorFor(x, kindName(x)))}`;
  return html`<${PageSection} id="dv-recent" num="02" title=${c('secRecent')} count=${c('secRecentSub')} doors=${doors}>
    ${!all ? html`<p class="poster-quiet loading-mark">${c('loadingRecent')}</p>` : !list.length ? html`<p class="poster-quiet">${c('noneRecent')}</p>` : entryRows(ctx, shown, { head: true })}
    ${list.length > RECENT_ROWS ? html`<p class="dv-more"><button type="button" class="poster-action poster-action--more" onClick=${() => ctx.setRecentOpen(v => !v)}>${ctx.recentOpen ? c('showFewer') : c('showMore', { n: list.length - RECENT_ROWS })}</button></p>` : null}
    <${Hint}>${c('recentHint')}<//>
  <//>`;
}

/* ── 03 Places ─────────────────────────────────────────────────────────────────────────────── */
function secPlaces(ctx, places) {
  const byOrg = new Map();
  for (const p of places) {
    let o = byOrg.get(p.organismId);
    if (!o) { o = { id: p.organismId, name: p.organism, count: 0, ws: [] }; byOrg.set(p.organismId, o); }
    o.count += p.count; o.ws.push(p);
  }
  const orgs = [...byOrg.values()].sort((a, b) => b.count - a.count);
  return html`<${PageSection} id="dv-places" num="03" title=${c('secPlaces')} count=${c('secPlacesSub', { o: orgs.length, w: places.length })} doors=${html`<button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.openTab('organisms')}>${t('profile.tabs.organisms')}</button>`}>
    ${!orgs.length ? html`<p class="poster-quiet">${c('nonePlaces')}</p>` : html`<div class="dv-places">
      ${orgs.map(o => html`<button type="button" class="dv-place" key=${o.id} onClick=${() => ctx.pickView({ kind: 'place', organismId: o.id, organism: o.name })}>
        <b>${o.name}</b><small>${c('placeSub', { w: o.ws.length, n: num(o.count) })}</small>
        ${o.ws.slice(0, 3).map(w => html`<span class="dv-ws" key=${w.workspaceId}>${w.workspace}<i>${num(w.count)}</i></span>`)}
        ${o.ws.length > 3 ? html`<span class="dv-ws dv-ws--more">${c('moreN', { n: o.ws.length - 3 })}</span>` : null}
      </button>`)}
    </div>`}
    <${Hint}>${c('placesHint')}<//>
  <//>`;
}

/* ── 04 Bookkeeping ────────────────────────────────────────────────────────────────────────── */
function secBookkeeping(ctx, book) {
  return html`<${FoldSection} id="dv-book" num="04" title=${c('secBook')} sub=${c('secBookSub', { n: num(book) })} open=${ctx.bookOpen} onToggle=${() => ctx.setBookOpen(v => !v)}>
    <${Hint}>${c('bookHint')}<//>
    <div class="og-doors"><button type="button" class="poster-action poster-action--small" onClick=${() => ctx.openTab('memory')}>${t('profile.memory.title')}</button><button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.pickView({ kind: 'kind', type: 'memory', bookkeeping: true })}>${c('browseBook')}</button></div>
  <//>`;
}

/* ── Results for a query ───────────────────────────────────────────────────────────────────── */
function renderResults(ctx) {
  const r = ctx.results;
  const words = ctx.query.split(/\s+/).filter(Boolean);
  const entries = r?.entries || [];
  const human = entries.filter(e => !(e.type === 'memory' && e.segment === 'bookkeeping'));
  const book = entries.length - human.length;
  const groups = new Map();
  for (const e of human) { if (!groups.has(e.type)) groups.set(e.type, []); groups.get(e.type).push(e); }
  const order = [...groups.keys()].sort((a, b) => HUMAN_TYPES.indexOf(a) - HUMAN_TYPES.indexOf(b));
  const chips = html`
    <span class="poster-chip poster-chip--sun">${r ? c('hitsN', { n: num(human.length) }) : '…'}</span>
    ${order.map(k => html`<span class="poster-chip" key=${k}>${kindName(k)} ${groups.get(k).length}</span>`)}
    ${book ? html`<span class="poster-chip">${c('bookHidden', { n: book })}</span>` : null}`;
  const otherScopes = ['own', 'public', 'shared'].filter(s => s !== ctx.scope);
  return renderPage(ctx, {
    crumbs: [ctx.query], title: t('discover.title'), chips,
    doors: html`<button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${ctx.clear}>${c('clear')}</button>`,
    rail: html`<hr /><span class="og-rail-label">${c('scopes')}</span>
      ${['own', 'public', 'shared'].map(s => html`<button type="button" class=${`og-rail-link ${ctx.scope === s ? 'on' : ''}`} key=${s} onClick=${() => ctx.setScope(s)}><i>→</i>${t('discover.scope.' + s)}<em>${ctx.scope === s ? num(human.length) : (ctx.otherCounts[s] ?? '…')}</em></button>`)}`,
    children: html`
      ${!r ? html`<p class="poster-quiet loading-mark">${c('searching')}</p>` : !human.length ? html`<p class="poster-quiet">${t('discover.empty')}</p>` : html`
        <div class="listing listing--cols listing--name-where-doors dv-rows dv-rows--hits">
          ${order.map(k => { const list = groups.get(k); const open = ctx.moreOpen.has(k); const shown = open ? list : list.slice(0, 5); return html`
            <div class="dv-lbl poster-day-title" key=${'l' + k}>${kindName(k)}<em>${list.length}</em></div>
            ${entryCells(ctx, shown, { words, time: false })}
            ${list.length > 5 ? html`<div class="dv-morerow" key=${'m' + k}><button type="button" class="poster-action poster-action--more" onClick=${() => ctx.toggleMore(k)}>${open ? c('showFewer') : c('showRestOf', { n: list.length - 5, k: kindName(k).toLowerCase() })}</button></div>` : null}`; })}
        </div>`}
      ${book ? html`<${FoldSection} id="dv-bookhits" num="·" title=${c('secBook')} sub=${c('bookHitsSub', { n: book })} open=${ctx.bookOpen} onToggle=${() => ctx.setBookOpen(v => !v)}>
        ${entryRows(ctx, entries.filter(e => e.type === 'memory' && e.segment === 'bookkeeping'), { words, time: false })}
      <//>` : null}
      ${otherScopes.some(s => ctx.otherCounts[s]) ? html`<${Hint}>${c('alsoIn', { list: otherScopes.filter(s => ctx.otherCounts[s]).map(s => `${t('discover.scope.' + s)} ${ctx.otherCounts[s]}`).join(' · ') })}<//>` : null}`,
  });
}

/* ── A kind, a place ───────────────────────────────────────────────────────────────────────── */
function browseBody(ctx) {
  const b = ctx.browse;
  return html`
    ${!b || (b.loading && !b.entries.length) ? html`<p class="poster-quiet loading-mark">${c('loadingRows')}</p>` : !b.entries.length ? html`<p class="poster-quiet">${t('discover.empty')}</p>` : entryRows(ctx, b.entries, { head: true })}
    ${b && b.entries.length < b.total ? html`<p class="dv-more"><button type="button" class="poster-action poster-action--more" disabled=${b.loading} onClick=${ctx.browseMore}>${c('showMore', { n: num(b.total - b.entries.length) })}</button></p>` : null}`;
}
function renderKind(ctx, type) {
  const f = ctx.facets[ctx.scope];
  const n = f?.types.find(x => x.value === type)?.count || 0;
  const segs = f ? f.segments.filter(s => s.type === type && s.segment !== 'bookkeeping') : [];
  return renderPage(ctx, {
    crumbs: [kindName(type)], title: kindName(type),
    chips: html`<span class="poster-chip">${c('chipItems', { n: num(n) })}</span>${segs.slice(0, 6).map(s => html`<span class=${`poster-tab poster-tab--filter ${ctx.segment === s.segment ? 'is-on' : ''}`} key=${s.segment} onClick=${() => ctx.setSegment(ctx.segment === s.segment ? '' : s.segment)}>${s.segment} ${num(s.count)}</span>`)}`,
    rail: html`<hr /><span class="og-rail-label">${c('secKinds')}</span>
      ${kindsOf(f).map(k => html`<button type="button" class=${`og-rail-link ${k.value === type ? 'on' : ''}`} key=${k.value} onClick=${() => ctx.pickView({ kind: 'kind', type: k.value })}><i>→</i>${kindName(k.value)}<em>${num(k.count)}</em></button>`)}`,
    children: html`<p class="og-desc og-desc--page">${kindSub(type)}</p>${browseBody(ctx)}`,
  });
}
function renderPlace(ctx, organismId, organism) {
  const f = ctx.facets[ctx.scope];
  const ws = (f?.places || []).filter(p => p.organismId === organismId);
  return renderPage(ctx, {
    crumbs: [organism], title: organism,
    chips: html`<span class="poster-chip">${c('placeSub', { w: ws.length, n: num(ws.reduce((s, w) => s + w.count, 0)) })}</span>`,
    doors: html`<button type="button" class="poster-action poster-action--small" onClick=${() => ctx.openTab('organisms')}>${c('openOrganism')}</button>`,
    rail: html`<hr /><span class="og-rail-label">${c('workspaces')}</span>
      ${ws.map(w => html`<span class="og-rail-link on" key=${w.workspaceId}><i>·</i>${w.workspace}<em>${num(w.count)}</em></span>`)}`,
    children: html`<p class="og-desc og-desc--page">${c('placeDesc', { t: rel(ctx.browse?.entries?.[0]?.updatedAt) || '' })}</p>${browseBody(ctx)}`,
  });
}
