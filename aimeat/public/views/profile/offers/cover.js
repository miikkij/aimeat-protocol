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
 *   v1.1.0 — 2026-09-06 — The map moves to map-page.js, where it gains three flat views and a search field.
 *   v1.0.0 — 2026-08-30 — Initial. Replaces the segment tabs, the facet panel and the wall of cards.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, Fold, scrollTo } from '/views/profile/organisms/poster-parts.js';
import { groupItems } from './model.js';
import { c, word, agentMark, getWord, costTime, statusWord, deliveryRows, deliveryHead, rel, crumb, pageLinks, renderPage } from './frame.js';
import { renderOffer } from './offer-page.js';
import { renderInbox, renderDeliverable } from './inbox.js';
import { MapPage } from './map-page.js';

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
  const chip = (n, key, cls = '') => html`<span class=${`og-chip ${cls}`}>${c(key, { n })}</span>`;
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
          <h1 class="og-title">${t('profile.tabs.offers')}</h1>
          <div class="og-chips">
            ${chip(m.items.length, 'chipOffers')}${chip(m.agents, 'chipAgents')}${chip(m.onlineAgents, 'chipOnline')}${chip(m.autoN, 'chipAuto')}${chip(m.stepsN, 'chipSteps')}
            ${chip(m.selling.length, 'chipSelling', m.selling.length ? '' : 'og-chip--dim')}${chip(m.latest.length, 'chipDeliveries', 'og-chip--coral')}
          </div>
          <p class="og-desc">${c('desc')}</p>
        </div>
        <div class="og-mast-actions">
          <button type="button" class="og-slab" onClick=${() => scrollTo('op-ask')}>${c('ask')}</button>
          <div class="og-doors">
            <button type="button" class="og-door" onClick=${() => ctx.pickView({ kind: 'page', id: 'inbox' })}>${c('inbox')}</button>
            <button type="button" class="og-door" onClick=${() => ctx.pickView({ kind: 'page', id: 'map' })}>${c('map')}</button>
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
    <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.pickView({ kind: 'page', id: 'inbox', filter: 'all' })}>${c('allN', { n: m.latest.length })}</button>
    <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.pickView({ kind: 'page', id: 'inbox', filter: 'unrated' })}>${c('unratedN', { n: m.unrated.length })}</button>`;
  return html`<${Section} id="op-back" num="01" title=${c('secBack')} count=${c('secBackSub')} doors=${doors} first=${true}>
    ${m.latest.length ? html`${deliveryHead()}${deliveryRows(ctx, m.latest.slice(0, BACK_ROWS))}` : html`<p class="og-empty">${ctx.loadingDeliveries ? '…' : t('profile.offers.inboxEmpty')}</p>`}
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
    <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.openTab('scheduler')}>${c('scheduler')}</button>
    <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.openTab('workflows')}>${c('workflows')}</button>`;
  return html`<${Section} id="op-auto" num="02" title=${c('secAuto')} count=${c('secAutoSub', { c: m.chains.length, s: m.autoSingles.length })} doors=${doors}>
    ${m.chains.map(ch => html`<div class="op-line" key=${ch.id}>
      <div class="op-line-h"><b>${ch.title}</b><small>${c('stepsN', { n: ch.steps.length })}${ch.last ? ` · ${c('lastRun', { t: rel(ch.last.updated_at) })}` : ''}${ch.failed ? html` · <span class="op-st--err">${c('stepsFailed', { n: ch.failed })}</span>` : ''}</small>
        <div class="og-doors"><button type="button" class="og-door" onClick=${() => ctx.openTab('workflows')}>${c('openWorkflow')}</button></div></div>
      <div class="op-steps">${ch.steps.map((s, i) => html`${i ? html`<span class="op-arrow">→</span>` : null}${stepBox(ctx, s)}`)}</div>
    </div>`)}
    ${m.autoSingles.length ? html`<div class="op-line op-line--last">
      <div class="op-line-h"><b>${c('singles')}</b><small>${c('singlesSub')}</small></div>
      <div class="op-steps">${m.autoSingles.map(s => stepBox(ctx, s))}</div>
    </div>` : null}
    ${!m.chains.length && !m.autoSingles.length ? html`<p class="og-empty">${c('noneAuto')}</p>` : null}
  <//>`;
}

/* ── 03 Ask ────────────────────────────────────────────────────────────────────────────────── */
function catalogueRows(ctx, list) {
  return list.map(it => html`
    <div class="op-nm" key=${'n' + it.key}><button type="button" class="og-tbl-name" onClick=${() => openOffer(ctx, it)}>${it.offer.title}</button><small>${agentMark(it)}</small></div>
    <div class="op-m" key=${'g' + it.key}>${getWord(it.offer)}</div>
    <div class="op-w" key=${'c' + it.key}>${costTime(it.offer)}</div>
    <div class="op-m" key=${'v' + it.key}>${word('verification', it.offer.verification)}</div>
    <div class="og-tbl-door" key=${'d' + it.key}><button type="button" class="og-door" onClick=${() => openOffer(ctx, it)}>${c('ask')}</button></div>`);
}
export function catalogue(ctx, items, axis) {
  const groups = groupItems(items, axis);
  return html`
    <div class="op-cat op-cat--head"><div>${c('colOffer')}</div><div>${c('colGet')}</div><div>${c('colCostTime')}</div><div>${c('colTrust')}</div><div></div></div>
    <div class="op-cat">
      ${groups.map(g => html`
        ${axis !== 'name' ? html`<div class="op-lbl" key=${'l' + g.key}>${axis === 'need' ? needLabel(g.key) : g.key}<em>${g.items.length}</em></div>` : null}
        ${catalogueRows(ctx, g.items)}`)}
    </div>`;
}
function aiResults(ctx) {
  const r = ctx.aiResult;
  if (r === 'loading') return html`<p class="og-empty">${t('profile.offers.aiThinking')}</p>`;
  const noMatch = !r.ranked.length || r.noMatch;
  return html`
    <div class="op-ai-head"><span class="og-label">${t('profile.offers.aiResultsTitle')}</span><button type="button" class="og-door og-door--quiet" onClick=${ctx.clearAi}>${t('profile.offers.aiClear')}</button></div>
    ${noMatch ? html`<div class="op-noneed">
      <p class="og-empty">${t('profile.offers.aiNoMatch')}</p>
      ${r.brief ? html`<div class="op-frame">${r.brief}</div>` : null}
      ${ctx.builder ? html`<button type="button" class="og-slab" disabled=${ctx.busy} onClick=${() => ctx.buildForNeed(r.brief)}>${t('profile.offers.buildForNeed')}</button>` : null}
    </div>` : null}
    ${r.ranked.map(({ item, why }) => { const it = ctx.model.byKey.get(item.key || (item.agent + '/' + item.offer.id)) || item; return html`
      <div class="op-hit" key=${it.key}>
        <div><button type="button" class="og-tbl-name" onClick=${() => openOffer(ctx, it)}>${it.offer.title}</button> ${agentMark(it)}<p>${it.offer.ask}</p>${why ? html`<div class="op-why">${why}</div>` : null}</div>
        <div><button type="button" class="og-door" onClick=${() => openOffer(ctx, it)}>${c('ask')}</button></div>
      </div>`; })}`;
}
function secAsk(ctx) {
  const m = ctx.model;
  const needle = ctx.q.trim().toLowerCase();
  const list = needle ? m.askable.filter(it => (it.offer.title + ' ' + it.offer.ask + ' ' + (it.offer.tags || []).join(' ') + ' ' + it.agent).toLowerCase().includes(needle)) : m.askable;
  const axisDoor = (id, label) => html`<button type="button" class=${`og-door og-door--quiet ${ctx.axis === id ? 'on' : ''}`} onClick=${() => ctx.setAxis(id)}>${label}</button>`;
  const doors = html`${axisDoor('need', c('byNeed'))}${axisDoor('agent', c('byAgent'))}${axisDoor('name', c('byName'))}`;
  return html`<${Section} id="op-ask" num="03" title=${c('secAsk')} count=${c('secAskSub', { n: m.askable.length })} doors=${doors}>
    <div class="op-search">
      <input type="search" value=${ctx.q} placeholder=${t('profile.offers.searchPlaceholder')} onInput=${(e) => ctx.setQ(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter' && ctx.aiOn) ctx.runNeedSearch(); }} />
      ${ctx.aiOn ? html`<button type="button" class="og-door" disabled=${!ctx.q.trim() || ctx.aiResult === 'loading'} onClick=${ctx.runNeedSearch}>${t('profile.offers.aiSearch')}</button><span class="op-hint">${c('aiHint')}</span>` : null}
    </div>
    ${ctx.aiResult ? aiResults(ctx) : (list.length ? catalogue(ctx, list, ctx.axis) : html`<div class="op-noneed">
      <p class="og-empty">${m.askable.length ? t('profile.offers.noMatch') : t('profile.offers.empty')}</p>
      ${ctx.builder && needle ? html`<button type="button" class="og-slab" disabled=${ctx.busy} onClick=${() => ctx.buildForNeed()}>${t('profile.offers.buildForNeed')}</button>` : null}
    </div>`)}
    ${!ctx.aiResult && list.length ? html`<p class="op-hint">${c('groupHint')}</p>` : null}
  <//>`;
}

/* ── 04 Away, 05 Selling ───────────────────────────────────────────────────────────────────── */
function secOffline(ctx) {
  const m = ctx.model;
  return html`<${Fold} id="op-offline" num="04" title=${c('secOffline')} sub=${c('secOfflineSub', { n: m.offlineAgents.size })} open=${ctx.offlineOpen} onToggle=${() => ctx.setOfflineOpen(v => !v)}>
    <p class="op-hint">${c('offlineNote')}</p>
    ${m.offline.length ? html`<div class="op-cat">${catalogueRows(ctx, m.offline)}</div>` : html`<p class="og-empty">${c('noneOffline')}</p>`}
  <//>`;
}
function secSelling(ctx) {
  const m = ctx.model;
  return html`<${Fold} id="op-selling" num="05" title=${c('secSelling')} sub=${m.selling.length ? c('sellingSub', { n: m.selling.length }) : c('sellingNone')} open=${ctx.sellOpen} onToggle=${() => ctx.setSellOpen(v => !v)}>
    <p class="op-hint">${c('sellingHint')}</p>
    <div class="og-doors"><button type="button" class="og-door" onClick=${() => ctx.pickView({ kind: 'page', id: 'sell' })}>${c('sell')}</button></div>
  <//>`;
}

/* ── Pages: the selling register (the map is map-page.js) ──────────────────────────────────── */
function sellPage(ctx) {
  const m = ctx.model;
  const list = [...m.items].sort((a, b) => (m.selling.includes(b) ? 1 : 0) - (m.selling.includes(a) ? 1 : 0) || a.offer.title.localeCompare(b.offer.title));
  const price = (o) => [o.price?.morsels > 0 ? `${o.price.morsels} ${t('profile.offers.morsels')}` : '', o.priceMoney ? `${(o.priceMoney.amount / 1e6).toFixed(2)} ${o.priceMoney.currency}` : ''].filter(Boolean).join(' · ') || c('noPrice');
  return renderPage(ctx, {
    id: 'sell', crumbs: [c('sell')], title: c('sell'),
    chips: html`<span class="og-chip">${c('chipSelling', { n: m.selling.length })}</span><span class="og-chip og-chip--dim">${c('chipOffers', { n: m.items.length })}</span>`,
    children: html`
      <p class="og-desc og-desc--page">${c('sellDesc')}</p>
      <div class="op-cat op-cat--sell op-cat--head"><div>${c('colOffer')}</div><div>${c('colVisibility')}</div><div>${c('colPrice')}</div><div></div></div>
      <div class="op-cat op-cat--sell">
        ${list.map(it => html`
          <div class="op-nm" key=${'n' + it.key}><button type="button" class="og-tbl-name" onClick=${() => openOffer(ctx, it)}>${it.offer.title}</button><small>${agentMark(it)}</small></div>
          <div class="op-w" key=${'v' + it.key}>${t('profile.offers.visibility.' + (it.offer.visibility || 'private'))}</div>
          <div class="op-m" key=${'p' + it.key}>${price(it.offer)}</div>
          <div class="og-tbl-door" key=${'d' + it.key}><button type="button" class="og-door" onClick=${() => ctx.pickView({ kind: 'offer', key: it.key, sell: true })}>${c('setPrice')}</button></div>`)}
      </div>`,
  });
}

