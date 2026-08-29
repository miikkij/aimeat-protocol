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
 *   v1.0.0 — 2026-08-30 — Initial. Replaces the scope buttons, the thirteen type chips and the
 *     newest-first dump of every record.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, Fold, scrollTo } from '/views/profile/organisms/poster-parts.js';
import { c, num, kindName, kindSub, HUMAN_TYPES, desk, entryRows, entryCells, rowsHead, crumb, renderPage, rel } from './frame.js';

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
          <h1 class="og-title">${t('discover.title')}</h1>
          <div class="og-chips">
            <span class="og-chip">${c('chipItems', { n: num(total) })}</span><span class="og-chip">${c('chipKinds', { n: kinds.length })}</span>
            ${orgs.size ? html`<span class="og-chip">${c('chipOrgs', { n: orgs.size })}</span>` : null}
            ${book ? html`<span class="og-chip og-chip--dim">${c('chipBook', { n: num(book) })}</span>` : null}
            ${ctx.facets.shared?.total ? html`<span class="og-chip og-chip--coral">${c('chipShared', { n: num(ctx.facets.shared.total) })}</span>` : null}
          </div>
          <p class="og-desc">${c('desc')}</p>
        </div>
        <div class="og-mast-actions"><div class="og-doors">
          <button type="button" class="og-door" onClick=${() => ctx.openTab('memory')}>${t('profile.memory.title')}</button>
          <button type="button" class="og-door" onClick=${() => ctx.openTab('knowledge')}>${t('knowledge.tabLabel')}</button>
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
          ${['own', 'public', 'shared'].map(s => html`<button type="button" class=${`og-rail-link ${ctx.scope === s ? 'on' : ''}`} key=${s} onClick=${() => ctx.setScope(s)}><i>→</i>${t('discover.scope.' + s)}<em>${ctx.facets[s] ? num(ctx.facets[s].total) : '…'}</em></button>`)}
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
  return html`<${Section} id="dv-kinds" num="01" title=${c('secKinds')} count=${c('secKindsSub', { n: kinds.length })} first=${true}>
    ${!f ? html`<p class="og-empty">…</p>` : !kinds.length ? html`<p class="og-empty">${t('discover.empty')}</p>` : html`
      <div class="dv-kinds dv-kinds--head"><div></div><div>${c('colKind')}</div><div>${c('colWhere')}</div><div></div></div>
      <div class="dv-kinds">
        ${kinds.map(k => html`
          <div class="dv-n" key=${'n' + k.value}>${num(k.count)}${capped && k.count >= 50 ? '+' : ''}</div>
          <div class="dv-nm" key=${'m' + k.value}><button type="button" class="og-tbl-name" onClick=${() => ctx.pickView({ kind: 'kind', type: k.value })}>${kindName(k.value)}</button><small>${kindSub(k.value)}</small></div>
          <div class="dv-where" key=${'w' + k.value}>${whereOf(f, k.value)}</div>
          <div class="og-tbl-door" key=${'d' + k.value}><button type="button" class="og-door" onClick=${() => ctx.pickView({ kind: 'kind', type: k.value })}>${c('browse')}</button></div>`)}
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
  const doorFor = (type, label) => html`<button type="button" key=${type || 'all'} class=${`og-door og-door--quiet ${filt === type ? 'on' : ''}`} onClick=${() => ctx.setRecentType(type)}>${label}</button>`;
  const doors = html`${doorFor('', c('allKinds'))}${['document', 'knowledge', 'skill', 'decision'].filter(x => present.includes(x)).map(x => doorFor(x, kindName(x)))}`;
  return html`<${Section} id="dv-recent" num="02" title=${c('secRecent')} count=${c('secRecentSub')} doors=${doors}>
    ${!all ? html`<p class="og-empty">…</p>` : !list.length ? html`<p class="og-empty">${c('noneRecent')}</p>` : html`${rowsHead()}${entryRows(ctx, shown)}`}
    ${list.length > RECENT_ROWS ? html`<p class="dv-more"><button type="button" onClick=${() => ctx.setRecentOpen(v => !v)}>${ctx.recentOpen ? c('showFewer') : c('showMore', { n: list.length - RECENT_ROWS })}</button></p>` : null}
    <p class="dv-hint">${c('recentHint')}</p>
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
  return html`<${Section} id="dv-places" num="03" title=${c('secPlaces')} count=${c('secPlacesSub', { o: orgs.length, w: places.length })} doors=${html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.openTab('organisms')}>${t('profile.tabs.organisms')}</button>`}>
    ${!orgs.length ? html`<p class="og-empty">${c('nonePlaces')}</p>` : html`<div class="dv-places">
      ${orgs.map(o => html`<button type="button" class="dv-place" key=${o.id} onClick=${() => ctx.pickView({ kind: 'place', organismId: o.id, organism: o.name })}>
        <b>${o.name}</b><small>${c('placeSub', { w: o.ws.length, n: num(o.count) })}</small>
        ${o.ws.slice(0, 3).map(w => html`<span class="dv-ws" key=${w.workspaceId}>${w.workspace}<i>${num(w.count)}</i></span>`)}
        ${o.ws.length > 3 ? html`<span class="dv-ws dv-ws--more">${c('moreN', { n: o.ws.length - 3 })}</span>` : null}
      </button>`)}
    </div>`}
    <p class="dv-hint">${c('placesHint')}</p>
  <//>`;
}

/* ── 04 Bookkeeping ────────────────────────────────────────────────────────────────────────── */
function secBookkeeping(ctx, book) {
  return html`<${Fold} id="dv-book" num="04" title=${c('secBook')} sub=${c('secBookSub', { n: num(book) })} open=${ctx.bookOpen} onToggle=${() => ctx.setBookOpen(v => !v)}>
    <p class="dv-hint">${c('bookHint')}</p>
    <div class="og-doors"><button type="button" class="og-door" onClick=${() => ctx.openTab('memory')}>${t('profile.memory.title')}</button><button type="button" class="og-door og-door--quiet" onClick=${() => ctx.pickView({ kind: 'kind', type: 'memory', bookkeeping: true })}>${c('browseBook')}</button></div>
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
    <span class="og-chip og-chip--sun">${r ? c('hitsN', { n: num(human.length) }) : '…'}</span>
    ${order.map(k => html`<span class="og-chip" key=${k}>${kindName(k)} ${groups.get(k).length}</span>`)}
    ${book ? html`<span class="og-chip og-chip--dim">${c('bookHidden', { n: book })}</span>` : null}`;
  const otherScopes = ['own', 'public', 'shared'].filter(s => s !== ctx.scope);
  return renderPage(ctx, {
    crumbs: [ctx.query], title: t('discover.title'), chips,
    doors: html`<button type="button" class="og-door og-door--quiet" onClick=${ctx.clear}>${c('clear')}</button>`,
    rail: html`<hr /><span class="og-rail-label">${c('scopes')}</span>
      ${['own', 'public', 'shared'].map(s => html`<button type="button" class=${`og-rail-link ${ctx.scope === s ? 'on' : ''}`} key=${s} onClick=${() => ctx.setScope(s)}><i>→</i>${t('discover.scope.' + s)}<em>${ctx.scope === s ? num(human.length) : (ctx.otherCounts[s] ?? '…')}</em></button>`)}`,
    children: html`
      ${!r ? html`<p class="og-empty">…</p>` : !human.length ? html`<p class="og-empty">${t('discover.empty')}</p>` : html`
        <div class="dv-rows dv-rows--hits">
          ${order.map(k => { const list = groups.get(k); const open = ctx.moreOpen.has(k); const shown = open ? list : list.slice(0, 5); return html`
            <div class="dv-lbl" key=${'l' + k}>${kindName(k)}<em>${list.length}</em></div>
            ${entryCells(ctx, shown, { words, time: false })}
            ${list.length > 5 ? html`<div class="dv-morerow" key=${'m' + k}><button type="button" onClick=${() => ctx.toggleMore(k)}>${open ? c('showFewer') : c('showRestOf', { n: list.length - 5, k: kindName(k).toLowerCase() })}</button></div>` : null}`; })}
        </div>`}
      ${book ? html`<${Fold} id="dv-bookhits" num="·" title=${c('secBook')} sub=${c('bookHitsSub', { n: book })} open=${ctx.bookOpen} onToggle=${() => ctx.setBookOpen(v => !v)}>
        ${entryRows(ctx, entries.filter(e => e.type === 'memory' && e.segment === 'bookkeeping'), { words, time: false })}
      <//>` : null}
      ${otherScopes.some(s => ctx.otherCounts[s]) ? html`<p class="dv-hint">${c('alsoIn', { list: otherScopes.filter(s => ctx.otherCounts[s]).map(s => `${t('discover.scope.' + s)} ${ctx.otherCounts[s]}`).join(' · ') })}</p>` : null}`,
  });
}

/* ── A kind, a place ───────────────────────────────────────────────────────────────────────── */
function browseBody(ctx) {
  const b = ctx.browse;
  return html`
    ${!b ? html`<p class="og-empty">…</p>` : !b.entries.length ? html`<p class="og-empty">${t('discover.empty')}</p>` : html`${rowsHead()}${entryRows(ctx, b.entries)}`}
    ${b && b.entries.length < b.total ? html`<p class="dv-more"><button type="button" disabled=${b.loading} onClick=${ctx.browseMore}>${c('showMore', { n: num(b.total - b.entries.length) })}</button></p>` : null}`;
}
function renderKind(ctx, type) {
  const f = ctx.facets[ctx.scope];
  const n = f?.types.find(x => x.value === type)?.count || 0;
  const segs = f ? f.segments.filter(s => s.type === type && s.segment !== 'bookkeeping') : [];
  return renderPage(ctx, {
    crumbs: [kindName(type)], title: kindName(type),
    chips: html`<span class="og-chip">${c('chipItems', { n: num(n) })}</span>${segs.slice(0, 6).map(s => html`<span class=${`og-chip ${ctx.segment === s.segment ? 'og-chip--sun' : 'og-chip--dim'} dv-chip--btn`} key=${s.segment} onClick=${() => ctx.setSegment(ctx.segment === s.segment ? '' : s.segment)}>${s.segment} ${num(s.count)}</span>`)}`,
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
    chips: html`<span class="og-chip">${c('placeSub', { w: ws.length, n: num(ws.reduce((s, w) => s + w.count, 0)) })}</span>`,
    doors: html`<button type="button" class="og-door" onClick=${() => ctx.openTab('organisms')}>${c('openOrganism')}</button>`,
    rail: html`<hr /><span class="og-rail-label">${c('workspaces')}</span>
      ${ws.map(w => html`<span class="og-rail-link on" key=${w.workspaceId}><i>·</i>${w.workspace}<em>${num(w.count)}</em></span>`)}`,
    children: html`<p class="og-desc og-desc--page">${c('placeDesc', { t: rel(ctx.browse?.entries?.[0]?.updatedAt) || '' })}</p>${browseBody(ctx)}`,
  });
}
