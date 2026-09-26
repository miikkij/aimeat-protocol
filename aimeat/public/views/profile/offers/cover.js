/**
 * @file public/views/profile/offers/cover.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Offers page in the poster face (design canvas "AIMEAT Tarjoaman sivu", direction
 *   A): a person's own fleet as a shop window. The COVER answers in the order a person asks: what
 *   came back last, what runs on its own (the production lines as step chains), what can be asked
 *   (a search field first, then the catalogue with one door per row), whose agent is away, and what
 *   is for sale. An offer opens as its own page (offer-page.js), a delivery as its own page
 *   (inbox.js); the inbox, the map (map-page.js) and the selling register are pages from the rail.
 * @structure renderOffersView · renderCover · secBack · secAuto · secAsk · catalogue · aiResults · sellPage
 * @usage import { renderOffersView } from './offers/cover.js';
 * @version-history
 *   v1.15.0 -- 2026-09-26 -- The deliveries, the catalogue with its groups, the away offers, the selling register and what the AI found are the Listing (listing, listing-row and its head row, name, who, words and doors cells; listing--cols keeps the narrow-screen columns), a unification: the look most tabs use.
 *   v1.14.0 -- 2026-09-26 -- The line under an offer's name is the Listing's typewriter line (.listing-meta), a unification: Jouni's decision "Meta line".
 *   v1.13.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.12.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.11.0 -- 2026-09-25 -- A search field over a list is the Search line (.search-line with the Text field); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.10.0 -- 2026-09-25 -- A framed box around one thing is the Object box (.poster-box; on a grey ground its copy tone), in the tone its look already was (Jouni's decision "Object box", a unification).
 *   v1.9.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.8.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.7.0 -- 2026-09-25 -- The headings over lists wear .poster-day-title, grey (--quiet) over a record (Jouni's decision "Group heading", a unification).
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
 *   v1.2.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.1.0 — 2026-09-06 — The map moves to map-page.js, where it gains three flat views and a search field.
 *   v1.0.0 — 2026-08-30 — Initial. Replaces the segment tabs, the facet panel and the wall of cards.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { PageSection } from '/components/PageSection.js';
import { FoldSection } from '/components/FoldSection.js';
import { scrollTo } from '/views/profile/organisms/poster-parts.js';
import { groupItems } from './model.js';
import { c, word, agentMark, getWord, costTime, statusWord, deliveryRows, rel, crumb, pageLinks, renderPage } from './frame.js';
import { renderOffer } from './offer-page.js';
import { renderInbox, renderDeliverable } from './inbox.js';
import { MapPage } from './map-page.js';
import { Hint } from '/components/Hint.js';

const BACK_ROWS = 6;
const needLabel = (k) => t('profile.offers.need.' + k) || k;
const openOffer = (ctx, it) => ctx.pickView({ kind: 'offer', key: it.key });

export function renderOffersView(ctx) {
  const v = ctx.view;
  if (v.kind === 'offer') { const it = ctx.model.byKey.get(v.key); if (it) return renderOffer(ctx, it); }
  if (v.kind === 'deliverable') { const d = ctx.model.latest.find(x => x.task_id === v.taskId); if (d) return renderDeliverable(ctx, d); }
  if (v.kind === 'page') {
    if (v.id === 'inbox') return renderInbox(ctx);
    if (v.id === 'map') return html`<${MapPage} ctx=${ctx} />`;
    if (v.id === 'sell') return sellPage(ctx);
  }
  return renderCover(ctx);
}

/* ── The cover ─────────────────────────────────────────────────────────────────────────────── */
function renderCover(ctx) {
  const m = ctx.model;
  const chip = (n, key, cls = '') => html`<span class=${`poster-chip ${cls}`}>${c(key, { n })}</span>`;
  const last = m.latest[0];
  const strip = html`
    <div class="og-strip">
      <div><b>${m.todayN}</b><span>${c('stripToday')}</span><small>${last ? c('stripTodaySub', { a: last.agent, t: rel(last.updated_at), s: statusWord(last.status) }) : c('noneBack')}</small></div>
      <div><b>${m.waiting.length}</b><span>${c('stripWaiting')}</span><small>${c('stripWaitingSub', { q: m.waiting.filter(d => d.status === 'queued').length, s: m.waiting.filter(d => d.status === 'stalled').length, f: m.failed7 })}</small></div>
      <div><b>${m.autoN}</b><span>${c('stripAuto')}</span><small>${c('stripAutoSub', { c: m.chains.length, s: m.autoSingles.length })}</small></div>
      <div><b class=${m.rated ? '' : 'og-strip-coral'}>${m.rated}</b><span>${c('stripRated')}</span><small>${c('stripRatedSub', { n: m.unrated.length })}</small></div>
    </div>`;
  return html`
    <div class="og og-op">
      ${crumb(ctx, [])}
      <div class="og-mast">
        <div class="og-mast-words">
          <h1 class="og-title poster-page-title">${t('profile.tabs.offers')}</h1>
          <div class="poster-chips">
            ${chip(m.items.length, 'chipOffers')}${chip(m.agents, 'chipAgents')}${chip(m.onlineAgents, 'chipOnline')}${chip(m.autoN, 'chipAuto')}${chip(m.stepsN, 'chipSteps')}
            ${chip(m.selling.length, 'chipSelling')}${chip(m.latest.length, 'chipDeliveries', 'poster-chip--coral')}
          </div>
          <p class="og-desc">${c('desc')}</p>
        </div>
        <div class="og-mast-actions">
          <button type="button" class="poster-slab" onClick=${() => scrollTo('op-ask')}>${c('ask')}</button>
          <div class="og-doors">
            <button type="button" class="poster-action poster-action--small" onClick=${() => ctx.pickView({ kind: 'page', id: 'inbox' })}>${c('inbox')}</button>
            <button type="button" class="poster-action poster-action--small" onClick=${() => ctx.pickView({ kind: 'page', id: 'map' })}>${c('map')}</button>
          </div>
        </div>
      </div>
      ${strip}
      <div class="og-grid">
        <div class="og-main">
          ${secBack(ctx)}
          ${secAuto(ctx)}
          ${secAsk(ctx)}
          ${secOffline(ctx)}
          ${secSelling(ctx)}
        </div>
        <nav class="og-rail" aria-label=${c('railTitle')}>
          <span class="og-rail-label">${c('railTitle')}</span>
          ${[['01', 'op-back', c('secBack'), m.latest.length], ['02', 'op-auto', c('secAuto'), m.chains.length + m.autoSingles.length], ['03', 'op-ask', c('secAsk'), m.askable.length],
            ['04', 'op-offline', c('secOffline'), m.offlineAgents.size], ['05', 'op-selling', c('secSelling'), m.selling.length]]
            .map(([num, id, label, n]) => html`<button type="button" class="og-rail-link" key=${id} onClick=${() => scrollTo(id)}><i>${num}</i>${label}<em>${n}</em></button>`)}
          <hr />
          <span class="og-rail-label">${c('pages')}</span>
          ${pageLinks(ctx, null)}
        </nav>
      </div>
    </div>`;
}

/* ── 01 What came back ─────────────────────────────────────────────────────────────────────── */
function secBack(ctx) {
  const m = ctx.model;
  const doors = html`
    <button type="button" class="poster-action poster-action--more" onClick=${() => ctx.pickView({ kind: 'page', id: 'inbox', filter: 'all' })}>${c('allN', { n: m.latest.length })}</button>
    <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.pickView({ kind: 'page', id: 'inbox', filter: 'unrated' })}>${c('unratedN', { n: m.unrated.length })}</button>`;
  return html`<${PageSection} id="op-back" num="01" title=${c('secBack')} count=${c('secBackSub')} doors=${doors} first=${true}>
    ${m.latest.length ? deliveryRows(ctx, m.latest.slice(0, BACK_ROWS), { head: true }) : html`<p class="poster-quiet">${ctx.loadingDeliveries ? '…' : t('profile.offers.inboxEmpty')}</p>`}
  <//>`;
}

/* ── 02 Runs on its own ────────────────────────────────────────────────────────────────────── */
function stepBox(ctx, it) {
  const last = ctx.model.latestByAgent.get(it.agent);
  const cls = last ? (last.status === 'done' ? 'op-step--done' : (['failed', 'stalled'].includes(last.status) ? 'op-step--fail' : '')) : '';
  return html`<button type="button" class=${`op-step ${cls}`} onClick=${() => openOffer(ctx, it)}>${it.offer.title}<small>${it.agent}${last ? ` · ${statusWord(last.status)}` : ''}</small></button>`;
}
function secAuto(ctx) {
  const m = ctx.model;
  const doors = html`
    <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.openTab('scheduler')}>${c('scheduler')}</button>
    <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.openTab('workflows')}>${c('workflows')}</button>`;
  return html`<${PageSection} id="op-auto" num="02" title=${c('secAuto')} count=${c('secAutoSub', { c: m.chains.length, s: m.autoSingles.length })} doors=${doors}>
    ${m.chains.map(ch => html`<div class="op-line" key=${ch.id}>
      <div class="op-line-h"><b>${ch.title}</b><small>${c('stepsN', { n: ch.steps.length })}${ch.last ? ` · ${c('lastRun', { t: rel(ch.last.updated_at) })}` : ''}${ch.failed ? html` · <span class="op-st--err">${c('stepsFailed', { n: ch.failed })}</span>` : ''}</small>
        <div class="og-doors"><button type="button" class="poster-action poster-action--small" onClick=${() => ctx.openTab('workflows')}>${c('openWorkflow')}</button></div></div>
      <div class="op-steps">${ch.steps.map((s, i) => html`${i ? html`<span class="op-arrow">→</span>` : null}${stepBox(ctx, s)}`)}</div>
    </div>`)}
    ${m.autoSingles.length ? html`<div class="op-line op-line--last">
      <div class="op-line-h"><b>${c('singles')}</b><small>${c('singlesSub')}</small></div>
      <div class="op-steps">${m.autoSingles.map(s => stepBox(ctx, s))}</div>
    </div>` : null}
    ${!m.chains.length && !m.autoSingles.length ? html`<p class="poster-quiet">${c('noneAuto')}</p>` : null}
  <//>`;
}

/* ── 03 Ask ────────────────────────────────────────────────────────────────────────────────── */
function catalogueRows(ctx, list) {
  return list.map(it => html`
    <div class="listing-row" key=${it.key}>
      <div class="listing-name"><button type="button" class="og-tbl-name" onClick=${() => openOffer(ctx, it)}>${it.offer.title}</button><small class="listing-meta">${agentMark(it)}</small></div>
      <div class="listing-desc">${getWord(it.offer)}</div>
      <div class="listing-desc">${costTime(it.offer)}</div>
      <div class="listing-desc">${word('verification', it.offer.verification)}</div>
      <div class="listing-doors"><button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => openOffer(ctx, it)}>${c('ask')}</button></div>
    </div>`);
}
export function catalogue(ctx, items, axis) {
  const groups = groupItems(items, axis);
  return html`
    <div class="listing listing--cols listing--name-get-cost-trust-doors op-cat">
      <div class="listing-row listing-row--head"><div class="poster-label">${c('colOffer')}</div><div class="poster-label">${c('colGet')}</div><div class="poster-label">${c('colCostTime')}</div><div class="poster-label">${c('colTrust')}</div><div class="poster-label"></div></div>
      ${groups.map(g => html`
        ${axis !== 'name' ? html`<div class="op-lbl poster-day-title" key=${'l' + g.key}>${axis === 'need' ? needLabel(g.key) : g.key}<em>${g.items.length}</em></div>` : null}
        ${catalogueRows(ctx, g.items)}`)}
    </div>`;
}
function aiResults(ctx) {
  const r = ctx.aiResult;
  if (r === 'loading') return html`<p class="poster-quiet loading-mark">${t('profile.offers.aiThinking')}</p>`;
  const noMatch = !r.ranked.length || r.noMatch;
  return html`
    <div class="op-ai-head"><span class="poster-label">${t('profile.offers.aiResultsTitle')}</span><button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${ctx.clearAi}>${t('profile.offers.aiClear')}</button></div>
    ${noMatch ? html`<div class="op-noneed">
      <p class="poster-quiet">${t('profile.offers.aiNoMatch')}</p>
      ${r.brief ? html`<div class="op-frame poster-box">${r.brief}</div>` : null}
      ${ctx.builder ? html`<button type="button" class="poster-slab poster-slab--control" disabled=${ctx.busy} onClick=${() => ctx.buildForNeed(r.brief)}>${t('profile.offers.buildForNeed')}</button>` : null}
    </div>` : null}
    ${r.ranked.length ? html`<div class="listing listing--cols listing--hit-doors">
      ${r.ranked.map(({ item, why }) => { const it = ctx.model.byKey.get(item.key || (item.agent + '/' + item.offer.id)) || item; return html`
        <div class="listing-row op-hit" key=${it.key}>
          <div class="listing-name"><button type="button" class="og-tbl-name" onClick=${() => openOffer(ctx, it)}>${it.offer.title}</button> ${agentMark(it)}<p>${it.offer.ask}</p>${why ? html`<div class="op-why">${why}</div>` : null}</div>
          <div class="listing-doors"><button type="button" class="poster-action poster-action--small" onClick=${() => openOffer(ctx, it)}>${c('ask')}</button></div>
        </div>`; })}
    </div>` : null}`;
}
function secAsk(ctx) {
  const m = ctx.model;
  const needle = ctx.q.trim().toLowerCase();
  const list = needle ? m.askable.filter(it => (it.offer.title + ' ' + it.offer.ask + ' ' + (it.offer.tags || []).join(' ') + ' ' + it.agent).toLowerCase().includes(needle)) : m.askable;
  const axisDoor = (id, label) => html`<button type="button" class=${`poster-tab poster-tab--fold ${ctx.axis === id ? 'is-on' : ''}`} onClick=${() => ctx.setAxis(id)}>${label}</button>`;
  const doors = html`${axisDoor('need', c('byNeed'))}${axisDoor('agent', c('byAgent'))}${axisDoor('name', c('byName'))}`;
  return html`<${PageSection} id="op-ask" num="03" title=${c('secAsk')} count=${c('secAskSub', { n: m.askable.length })} doors=${doors}>
    <div class="search-line op-search">
      <input class="og-input" type="search" value=${ctx.q} placeholder=${t('profile.offers.searchPlaceholder')} onInput=${(e) => ctx.setQ(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter' && ctx.aiOn) ctx.runNeedSearch(); }} />
      ${ctx.aiOn ? html`<button type="button" class="poster-action poster-action--small" disabled=${!ctx.q.trim() || ctx.aiResult === 'loading'} onClick=${ctx.runNeedSearch}>${t('profile.offers.aiSearch')}</button><span class="poster-hint">${c('aiHint')}</span>` : null}
    </div>
    ${ctx.aiResult ? aiResults(ctx) : (list.length ? catalogue(ctx, list, ctx.axis) : html`<div class="op-noneed">
      <p class="poster-quiet">${m.askable.length ? t('profile.offers.noMatch') : t('profile.offers.empty')}</p>
      ${ctx.builder && needle ? html`<button type="button" class="poster-slab poster-slab--control" disabled=${ctx.busy} onClick=${() => ctx.buildForNeed()}>${t('profile.offers.buildForNeed')}</button>` : null}
    </div>`)}
    ${!ctx.aiResult && list.length ? html`<${Hint}>${c('groupHint')}<//>` : null}
  <//>`;
}

/* ── 04 Away, 05 Selling ───────────────────────────────────────────────────────────────────── */
function secOffline(ctx) {
  const m = ctx.model;
  return html`<${FoldSection} id="op-offline" num="04" title=${c('secOffline')} sub=${c('secOfflineSub', { n: m.offlineAgents.size })} open=${ctx.offlineOpen} onToggle=${() => ctx.setOfflineOpen(v => !v)}>
    <${Hint}>${c('offlineNote')}<//>
    ${m.offline.length ? html`<div class="listing listing--cols listing--name-get-cost-trust-doors op-cat">${catalogueRows(ctx, m.offline)}</div>` : html`<p class="poster-quiet">${c('noneOffline')}</p>`}
  <//>`;
}
function secSelling(ctx) {
  const m = ctx.model;
  return html`<${FoldSection} id="op-selling" num="05" title=${c('secSelling')} sub=${m.selling.length ? c('sellingSub', { n: m.selling.length }) : c('sellingNone')} open=${ctx.sellOpen} onToggle=${() => ctx.setSellOpen(v => !v)}>
    <${Hint}>${c('sellingHint')}<//>
    <div class="og-doors"><button type="button" class="poster-action poster-action--small" onClick=${() => ctx.pickView({ kind: 'page', id: 'sell' })}>${c('sell')}</button></div>
  <//>`;
}

/* ── Pages: the selling register (the map is map-page.js) ──────────────────────────────────── */
function sellPage(ctx) {
  const m = ctx.model;
  const list = [...m.items].sort((a, b) => (m.selling.includes(b) ? 1 : 0) - (m.selling.includes(a) ? 1 : 0) || a.offer.title.localeCompare(b.offer.title));
  const price = (o) => [o.price?.morsels > 0 ? `${o.price.morsels} ${t('profile.offers.morsels')}` : '', o.priceMoney ? `${(o.priceMoney.amount / 1e6).toFixed(2)} ${o.priceMoney.currency}` : ''].filter(Boolean).join(' · ') || c('noPrice');
  return renderPage(ctx, {
    id: 'sell', crumbs: [c('sell')], title: c('sell'),
    chips: html`<span class="poster-chip">${c('chipSelling', { n: m.selling.length })}</span><span class="poster-chip">${c('chipOffers', { n: m.items.length })}</span>`,
    children: html`
      <p class="og-desc og-desc--page">${c('sellDesc')}</p>
      <div class="listing listing--cols listing--name-state-price-doors op-cat">
        <div class="listing-row listing-row--head"><div class="poster-label">${c('colOffer')}</div><div class="poster-label">${c('colVisibility')}</div><div class="poster-label">${c('colPrice')}</div><div class="poster-label"></div></div>
        ${list.map(it => html`
          <div class="listing-row" key=${it.key}>
            <div class="listing-name"><button type="button" class="og-tbl-name" onClick=${() => openOffer(ctx, it)}>${it.offer.title}</button><small class="listing-meta">${agentMark(it)}</small></div>
            <div class="listing-desc">${t('profile.offers.visibility.' + (it.offer.visibility || 'private'))}</div>
            <div class="listing-desc">${price(it.offer)}</div>
            <div class="listing-doors"><button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.pickView({ kind: 'offer', key: it.key, sell: true })}>${c('setPrice')}</button></div>
          </div>`)}
      </div>`,
  });
}
