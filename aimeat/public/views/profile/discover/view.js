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
 *   v1.13.0 -- 2026-09-26 -- Every part is a kit component (SettingsPage with its tags, doors, desk and rail as data; List with its Row, Num, Name, Desc and Doors; Group; More; Tabs; Filter; CardGrid of framed Cards with their lines for the places; Note; Action): the page passes data and writes no class (page group G8).
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
import { SettingsPage } from '/components/SettingsPage.js';
import { List, Row, Num, Name, Desc, Doors, Group, More, Filter } from '/components/List.js';
import { Figure } from '/components/Figure.js';
import { Card, CardGrid } from '/components/Card.js';
import { Tabs } from '/components/Tabs.js';
import { Note } from '/components/Note.js';
import { Action, Actions } from '/components/Action.js';
import { c, num, kindName, kindSub, HUMAN_TYPES, desk, entryRows, crumb, renderPage, rel } from './frame.js';
import { Hint } from '/components/Hint.js';

const RECENT_ROWS = 8;
const SCOPE_IDS = ['own', 'public', 'shared'];

export function renderDiscoverView(ctx) {
  const v = ctx.view;
  if (ctx.query) return renderResults(ctx);
  if (v.kind === 'kind') return renderKind(ctx, v.type);
  if (v.kind === 'place') return renderPlace(ctx, v.organismId, v.organism);
  return renderCover(ctx);
}

/** The scopes as rail items: the one in use marked, each with its count. */
const scopeItems = (ctx, countOf) => SCOPE_IDS.map(s => ({
  key: s, mark: '→', label: t('discover.scope.' + s), count: countOf(s), on: ctx.scope === s, onClick: () => ctx.setScope(s),
}));

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
    <${SettingsPage} name="dv"
      crumb=${crumb(ctx, [])}
      title=${t('discover.title')}
      marks=${[
        { label: c('chipItems', { n: num(total) }) },
        { label: c('chipKinds', { n: kinds.length }) },
        orgs.size ? { label: c('chipOrgs', { n: orgs.size }) } : null,
        book ? { label: c('chipBook', { n: num(book) }) } : null,
        ctx.facets.shared?.total ? { label: c('chipShared', { n: num(ctx.facets.shared.total) }), tone: 'coral' } : null,
      ]}
      desc=${c('desc')}
      actions=${html`<${Actions}>
        <${Action} small onClick=${() => ctx.openTab('memory')}>${t('profile.memory.title')}<//>
        <${Action} small onClick=${() => ctx.openTab('knowledge')}>${t('knowledge.tabLabel')}<//>
      <//>`}
      strip=${desk(ctx)}
      railTitle=${c('railTitle')}
      sections=${[
        { id: 'dv-kinds', num: '01', label: c('secKinds'), count: kinds.length },
        { id: 'dv-recent', num: '02', label: c('secRecent'), count: '' },
        { id: 'dv-places', num: '03', label: c('secPlaces'), count: orgs.size },
        { id: 'dv-book', num: '04', label: c('secBook'), count: num(book) },
      ]}
      pagesLabel=${c('scopes')}
      pages=${scopeItems(ctx, (s) => (ctx.facets[s] ? num(ctx.facets[s].total) : '→'))}>
      ${secKinds(ctx, kinds)}
      ${secRecent(ctx)}
      ${secPlaces(ctx, places)}
      ${secBookkeeping(ctx, book)}
    <//>`;
}

/* ── 01 What is here ───────────────────────────────────────────────────────────────────────── */
function whereOf(f, type) {
  const segs = f.segments.filter(s => s.type === type && s.segment !== 'bookkeeping').slice(0, 3);
  return segs.map((s, i) => html`${i ? ' · ' : ''}${s.segment} <b>${num(s.count)}</b>`);
}
function secKinds(ctx, kinds) {
  const f = ctx.facets[ctx.scope];
  const capped = ctx.scope === 'public';
  const browse = (k) => () => ctx.pickView({ kind: 'kind', type: k.value });
  return html`<${PageSection} id="dv-kinds" num="01" title=${c('secKinds')} count=${c('secKindsSub', { n: kinds.length })} first=${true}>
    ${!f ? html`<${Note} kind="loading">${c('loading')}<//>` : html`
      <${List} cols="n-name-where-doors" keepCols empty=${t('discover.empty')}
        head=${kinds.length ? ['', c('colKind'), c('colWhere'), ''] : null}>
        ${kinds.map(k => html`
          <${Row} key=${k.value}>
            <${Num}><${Figure} small n=${`${num(k.count)}${capped && k.count >= 50 ? '+' : ''}`} /><//>
            <${Name} onOpen=${browse(k)} meta=${kindSub(k.value)}>${kindName(k.value)}<//>
            <${Desc}>${whereOf(f, k.value)}<//>
            <${Doors}><${Action} small row onClick=${browse(k)}>${c('browse')}<//><//>
          <//>`)}
      <//>`}
  <//>`;
}

/* ── 02 What changed last ──────────────────────────────────────────────────────────────────── */
function secRecent(ctx) {
  const all = ctx.recent[ctx.scope] || null;
  const filt = ctx.recentType;
  const list = all ? (filt ? all.filter(e => e.type === filt) : all) : [];
  const shown = ctx.recentOpen ? list : list.slice(0, RECENT_ROWS);
  const present = all ? [...new Set(all.map(e => e.type))] : [];
  const kinds = [{ value: '', key: 'all', label: c('allKinds') }, ...['document', 'knowledge', 'skill', 'decision'].filter(x => present.includes(x)).map(x => ({ value: x, key: x, label: kindName(x) }))];
  const doors = html`<${Tabs} tone="fold" value=${filt || ''} onSelect=${(v) => ctx.setRecentType(v)} items=${kinds} />`;
  return html`<${PageSection} id="dv-recent" num="02" title=${c('secRecent')} count=${c('secRecentSub')} doors=${doors}>
    ${!all ? html`<${Note} kind="loading">${c('loadingRecent')}<//>` : !list.length ? html`<${Note} kind="quiet">${c('noneRecent')}<//>` : entryRows(ctx, shown, { head: true })}
    ${list.length > RECENT_ROWS ? html`<${More} onMore=${() => ctx.setRecentOpen(v => !v)} label=${ctx.recentOpen ? c('showFewer') : c('showMore', { n: list.length - RECENT_ROWS })} />` : null}
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
  const lines = (o) => [
    ...o.ws.slice(0, 3).map(w => ({ key: w.workspaceId, label: w.workspace, count: num(w.count) })),
    ...(o.ws.length > 3 ? [{ key: 'more', label: c('moreN', { n: o.ws.length - 3 }), dim: true }] : []),
  ];
  return html`<${PageSection} id="dv-places" num="03" title=${c('secPlaces')} count=${c('secPlacesSub', { o: orgs.length, w: places.length })}
    doors=${html`<${Action} small soft onClick=${() => ctx.openTab('organisms')}>${t('profile.tabs.organisms')}<//>`}>
    ${!orgs.length ? html`<${Note} kind="quiet">${c('nonePlaces')}<//>` : html`<${CardGrid}>
      ${orgs.map(o => html`<${Card} tone="framed" key=${o.id} name=${o.name} meta=${c('placeSub', { w: o.ws.length, n: num(o.count) })}
        lines=${lines(o)} onOpen=${() => ctx.pickView({ kind: 'place', organismId: o.id, organism: o.name })} />`)}
    <//>`}
    <${Hint}>${c('placesHint')}<//>
  <//>`;
}

/* ── 04 Bookkeeping ────────────────────────────────────────────────────────────────────────── */
function secBookkeeping(ctx, book) {
  return html`<${FoldSection} id="dv-book" num="04" title=${c('secBook')} sub=${c('secBookSub', { n: num(book) })} open=${ctx.bookOpen} onToggle=${() => ctx.setBookOpen(v => !v)}>
    <${Hint}>${c('bookHint')}<//>
    <${Actions}>
      <${Action} small onClick=${() => ctx.openTab('memory')}>${t('profile.memory.title')}<//>
      <${Action} small soft onClick=${() => ctx.pickView({ kind: 'kind', type: 'memory', bookkeeping: true })}>${c('browseBook')}<//>
    <//>
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
  const marks = [
    { label: r ? c('hitsN', { n: num(human.length) }) : '…', tone: 'sun' },
    ...order.map(k => ({ label: `${kindName(k)} ${groups.get(k).length}` })),
    book ? { label: c('bookHidden', { n: book }) } : null,
  ];
  const otherScopes = SCOPE_IDS.filter(s => s !== ctx.scope);
  const kindGroup = (k) => {
    const list = groups.get(k);
    const open = ctx.moreOpen.has(k);
    const shown = open ? list : list.slice(0, 5);
    return html`<${Group} key=${'g' + k} title=${kindName(k)} count=${list.length}>
      ${entryRows(ctx, shown, { words, time: false })}
      ${list.length > 5 ? html`<${More} onMore=${() => ctx.toggleMore(k)} label=${open ? c('showFewer') : c('showRestOf', { n: list.length - 5, k: kindName(k).toLowerCase() })} />` : null}
    <//>`;
  };
  return renderPage(ctx, {
    crumbs: [ctx.query], title: t('discover.title'), marks,
    doors: html`<${Action} small soft onClick=${ctx.clear}>${c('clear')}<//>`,
    railGroup: { label: c('scopes'), items: scopeItems(ctx, (s) => (ctx.scope === s ? num(human.length) : (ctx.otherCounts[s] ?? '…'))) },
    children: html`
      ${!r ? html`<${Note} kind="loading">${c('searching')}<//>` : !human.length ? html`<${Note} kind="quiet">${t('discover.empty')}<//>` : order.map(kindGroup)}
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
    ${!b || (b.loading && !b.entries.length) ? html`<${Note} kind="loading">${c('loadingRows')}<//>` : !b.entries.length ? html`<${Note} kind="quiet">${t('discover.empty')}<//>` : entryRows(ctx, b.entries, { head: true })}
    ${b && b.entries.length < b.total ? html`<${More} disabled=${b.loading} onMore=${ctx.browseMore} label=${c('showMore', { n: num(b.total - b.entries.length) })} />` : null}`;
}
function renderKind(ctx, type) {
  const f = ctx.facets[ctx.scope];
  const n = f?.types.find(x => x.value === type)?.count || 0;
  const segs = f ? f.segments.filter(s => s.type === type && s.segment !== 'bookkeeping') : [];
  return renderPage(ctx, {
    crumbs: [kindName(type)], title: kindName(type),
    // The segments of a kind filter its rows: a press on the chosen one shows every row again.
    marks: [
      { label: c('chipItems', { n: num(n) }) },
      ...segs.slice(0, 6).map(s => html`<${Filter} key=${s.segment} on=${ctx.segment === s.segment} count=${num(s.count)} onClick=${() => ctx.setSegment(ctx.segment === s.segment ? '' : s.segment)}>${s.segment}<//>`),
    ],
    railGroup: { label: c('secKinds'), items: kindsOf(f).map(k => ({ key: k.value, mark: '→', label: kindName(k.value), count: num(k.count), on: k.value === type, onClick: () => ctx.pickView({ kind: 'kind', type: k.value }) })) },
    children: html`<${Note} kind="lead">${kindSub(type)}<//>${browseBody(ctx)}`,
  });
}
function renderPlace(ctx, organismId, organism) {
  const f = ctx.facets[ctx.scope];
  const ws = (f?.places || []).filter(p => p.organismId === organismId);
  return renderPage(ctx, {
    crumbs: [organism], title: organism,
    marks: [{ label: c('placeSub', { w: ws.length, n: num(ws.reduce((s, w) => s + w.count, 0)) }) }],
    doors: html`<${Action} small onClick=${() => ctx.openTab('organisms')}>${c('openOrganism')}<//>`,
    railGroup: { label: c('workspaces'), items: ws.map(w => ({ key: w.workspaceId, still: true, mark: '·', label: w.workspace, count: num(w.count) })) },
    children: html`<${Note} kind="lead">${c('placeDesc', { t: rel(ctx.browse?.entries?.[0]?.updatedAt) || '' })}<//>${browseBody(ctx)}`,
  });
}
