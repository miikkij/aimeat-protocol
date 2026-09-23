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
 *   2026-09-22 -- Composed from the shared component set: Page, Rail, Section, Fold, NumeralBand
 *     for the strip, Table for the catalogue and the selling register, ListRow for the chains and
 *     the AI's hits. No own CSS; every word, count, door and handler is the one it was.
 *   v1.2.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.1.0 — 2026-09-06 — The map moves to map-page.js, where it gains three flat views and a search field.
 *   v1.0.0 — 2026-08-30 — Initial. Replaces the segment tabs, the facet panel and the wall of cards.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Page, Rail, Section, Fold, Stack, ListRow, Table, NumeralBand, Field, Action, Text, Surface } from '/components/poster-parts.js';
import { scrollTo } from '/views/profile/organisms/poster-parts.js';
import { groupItems } from './model.js';
import { c, word, agentMark, getWord, costTime, statusWord, deliveryRows, rel, crumb, chipRow, pageLinks, renderPage } from './frame.js';
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
  const last = m.latest[0];
  const strip = html`<${NumeralBand} tone="plain" items=${[
    { label: c('stripToday'), value: m.todayN, note: last ? c('stripTodaySub', { a: last.agent, t: rel(last.updated_at), s: statusWord(last.status) }) : c('noneBack') },
    { label: c('stripWaiting'), value: m.waiting.length, note: c('stripWaitingSub', { q: m.waiting.filter(d => d.status === 'queued').length, s: m.waiting.filter(d => d.status === 'stalled').length, f: m.failed7 }) },
    { label: c('stripAuto'), value: m.autoN, note: c('stripAutoSub', { c: m.chains.length, s: m.autoSingles.length }) },
    { label: c('stripRated'), value: m.rated, note: c('stripRatedSub', { n: m.unrated.length }), tone: m.rated ? undefined : 'coral' },
  ]} />`;
  const chips = chipRow([
    [c('chipOffers', { n: m.items.length })], [c('chipAgents', { n: m.agents })], [c('chipOnline', { n: m.onlineAgents })],
    [c('chipAuto', { n: m.autoN })], [c('chipSteps', { n: m.stepsN })],
    [c('chipSelling', { n: m.selling.length }), m.selling.length ? 'plain' : 'muted'], [c('chipDeliveries', { n: m.latest.length }), 'sun'],
  ]);
  const actions = html`<${Action} kind="primary" onClick=${() => scrollTo('op-ask')}>${c('ask')}<//>
    <${Action} onClick=${() => ctx.pickView({ kind: 'page', id: 'inbox' })}>${c('inbox')}<//>
    <${Action} onClick=${() => ctx.pickView({ kind: 'page', id: 'map' })}>${c('map')}<//>`;
  const rail = html`<${Rail} kind="index" title=${c('railTitle')} entries=${[
    { href: '#op-back', label: c('secBack'), count: m.latest.length },
    { href: '#op-auto', label: c('secAuto'), count: m.chains.length + m.autoSingles.length },
    { href: '#op-ask', label: c('secAsk'), count: m.askable.length },
    { href: '#op-offline', label: c('secOffline'), count: m.offlineAgents.size },
    { href: '#op-selling', label: c('secSelling'), count: m.selling.length },
  ]}>${pageLinks(ctx, null)}<//>`;
  return html`<${Page} width="wide" title=${t('profile.tabs.offers')} crumbs=${crumb(ctx, [])} identity=${chips} actions=${actions} rail=${rail}>
    <${Stack}>
      <${Text} kind="lead">${c('desc')}<//>
      ${strip}
      ${secBack(ctx)}${secAuto(ctx)}${secAsk(ctx)}${secOffline(ctx)}${secSelling(ctx)}
    <//>
  <//>`;
}

/* ── 01 What came back ─────────────────────────────────────────────────────────────────────── */
function secBack(ctx) {
  const m = ctx.model;
  const actions = html`
    <${Action} onClick=${() => ctx.pickView({ kind: 'page', id: 'inbox', filter: 'all' })}>${c('allN', { n: m.latest.length })}<//>
    <${Action} onClick=${() => ctx.pickView({ kind: 'page', id: 'inbox', filter: 'unrated' })}>${c('unratedN', { n: m.unrated.length })}<//>`;
  return html`<${Section} id="op-back" title=${c('secBack')} count=${c('secBackSub')} actions=${actions}>
    ${m.latest.length ? deliveryRows(ctx, m.latest.slice(0, BACK_ROWS)) : html`<${Text} tone="muted">${ctx.loadingDeliveries ? '…' : t('profile.offers.inboxEmpty')}<//>`}
  <//>`;
}

/* ── 02 Runs on its own ────────────────────────────────────────────────────────────────────── */
function stepBox(ctx, it) {
  const last = ctx.model.latestByAgent.get(it.agent);
  const tone = last ? (last.status === 'done' ? 'success' : (['failed', 'stalled'].includes(last.status) ? 'danger' : 'muted')) : 'muted';
  return html`<${Stack} key=${it.key} density="compact">
    <${Action} kind="text" onClick=${() => openOffer(ctx, it)}>${it.offer.title}<//>
    <${Text} kind="caption" tone=${tone}>${it.agent}${last ? ` · ${statusWord(last.status)}` : ''}<//>
  <//>`;
}
const stepChain = (ctx, steps) => html`<${Stack} direction="wrap" align="center">
  ${steps.map((s, i) => html`${i ? html`<${Text} key=${'a' + s.key} kind="mono" tone="muted">→<//>` : null}${stepBox(ctx, s)}`)}
<//>`;
function secAuto(ctx) {
  const m = ctx.model;
  const actions = html`
    <${Action} onClick=${() => ctx.openTab('scheduler')}>${c('scheduler')}<//>
    <${Action} onClick=${() => ctx.openTab('workflows')}>${c('workflows')}<//>`;
  return html`<${Section} id="op-auto" title=${c('secAuto')} count=${c('secAutoSub', { c: m.chains.length, s: m.autoSingles.length })} actions=${actions}>
    ${m.chains.map(ch => html`<${ListRow} key=${ch.id} name=${ch.title} detailKind="text"
      detail=${html`${c('stepsN', { n: ch.steps.length })}${ch.last ? ` · ${c('lastRun', { t: rel(ch.last.updated_at) })}` : ''}${ch.failed ? html` · <${Text} kind="caption" tone="danger">${c('stepsFailed', { n: ch.failed })}<//>` : ''}`}
      actions=${html`<${Action} onClick=${() => ctx.openTab('workflows')}>${c('openWorkflow')}<//>`}>
      ${stepChain(ctx, ch.steps)}
    <//>`)}
    ${m.autoSingles.length ? html`<${ListRow} name=${c('singles')} detail=${c('singlesSub')} detailKind="text">
      <${Stack} direction="wrap">${m.autoSingles.map(s => stepBox(ctx, s))}<//>
    <//>` : null}
    ${!m.chains.length && !m.autoSingles.length ? html`<${Text} tone="muted">${c('noneAuto')}<//>` : null}
  <//>`;
}

/* ── 03 Ask ────────────────────────────────────────────────────────────────────────────────── */
const nameCell = (ctx, it) => html`<${Stack} density="compact">
  <${Action} kind="text" onClick=${() => openOffer(ctx, it)}>${it.offer.title}<//>
  <${Text} kind="caption" tone="muted">${agentMark(it)}<//>
<//>`;
const catalogueTable = (ctx, list, label) => html`<${Table} density="compact" label=${label}
  headers=${[c('colOffer'), c('colGet'), c('colCostTime'), c('colTrust'), '']}
  rows=${list.map(it => [nameCell(ctx, it), { text: getWord(it.offer), mono: true }, costTime(it.offer), { text: word('verification', it.offer.verification), mono: true },
    html`<${Action} onClick=${() => openOffer(ctx, it)}>${c('ask')}<//>`])} />`;
export function catalogue(ctx, items, axis) {
  const groups = groupItems(items, axis);
  if (axis === 'name') return catalogueTable(ctx, groups[0]?.items || [], c('secAsk'));
  return html`<${Stack}>${groups.map(g => {
    const label = axis === 'need' ? needLabel(g.key) : g.key;
    return html`<${Stack} key=${g.key} density="compact"><${Text} kind="label">${label} ${g.items.length}<//>${catalogueTable(ctx, g.items, label)}<//>`;
  })}<//>`;
}
function aiResults(ctx) {
  const r = ctx.aiResult;
  if (r === 'loading') return html`<${Text} tone="muted">${t('profile.offers.aiThinking')}<//>`;
  const noMatch = !r.ranked.length || r.noMatch;
  return html`<${Stack}>
    <${Stack} direction="horizontal" align="between"><${Text} kind="label">${t('profile.offers.aiResultsTitle')}<//><${Action} onClick=${ctx.clearAi}>${t('profile.offers.aiClear')}<//><//>
    ${noMatch ? html`<${Stack}>
      <${Text} tone="muted">${t('profile.offers.aiNoMatch')}<//>
      ${r.brief ? html`<${Surface} kind="box">${r.brief}<//>` : null}
      ${ctx.builder ? html`<${Stack} direction="horizontal" align="start"><${Action} kind="primary" disabled=${ctx.busy} onClick=${() => ctx.buildForNeed(r.brief)}>${t('profile.offers.buildForNeed')}<//><//>` : null}
    <//>` : null}
    ${r.ranked.map(({ item, why }) => { const it = ctx.model.byKey.get(item.key || (item.agent + '/' + item.offer.id)) || item; return html`
      <${ListRow} key=${it.key} name=${it.offer.title} onOpen=${() => openOffer(ctx, it)} detail=${it.offer.ask} detailKind="text"
        value=${agentMark(it)} actions=${html`<${Action} onClick=${() => openOffer(ctx, it)}>${c('ask')}<//>`}>
        ${why ? html`<${Text} kind="caption" tone="coral">${why}<//>` : null}
      <//>`; })}
  <//>`;
}
function secAsk(ctx) {
  const m = ctx.model;
  const needle = ctx.q.trim().toLowerCase();
  const list = needle ? m.askable.filter(it => (it.offer.title + ' ' + it.offer.ask + ' ' + (it.offer.tags || []).join(' ') + ' ' + it.agent).toLowerCase().includes(needle)) : m.askable;
  const axisTab = (id, label) => html`<${Action} kind="tab" selected=${ctx.axis === id} onClick=${() => ctx.setAxis(id)}>${label}<//>`;
  return html`<${Section} id="op-ask" title=${c('secAsk')} count=${c('secAskSub', { n: m.askable.length })}
    actions=${html`${axisTab('need', c('byNeed'))}${axisTab('agent', c('byAgent'))}${axisTab('name', c('byName'))}`}>
    <${Stack}>
      <${Field} type="search" value=${ctx.q} placeholder=${t('profile.offers.searchPlaceholder')} onInput=${(e) => ctx.setQ(e.target.value)}
        onKeyDown=${(e) => { if (e.key === 'Enter' && ctx.aiOn) ctx.runNeedSearch(); }} />
      ${ctx.aiOn ? html`<${Stack} direction="wrap" align="center">
        <${Action} disabled=${!ctx.q.trim() || ctx.aiResult === 'loading'} onClick=${ctx.runNeedSearch}>${t('profile.offers.aiSearch')}<//>
        <${Text} kind="caption" tone="muted">${c('aiHint')}<//>
      <//>` : null}
      ${ctx.aiResult ? aiResults(ctx) : (list.length ? catalogue(ctx, list, ctx.axis) : html`<${Stack}>
        <${Text} tone="muted">${m.askable.length ? t('profile.offers.noMatch') : t('profile.offers.empty')}<//>
        ${ctx.builder && needle ? html`<${Stack} direction="horizontal" align="start"><${Action} kind="primary" disabled=${ctx.busy} onClick=${() => ctx.buildForNeed()}>${t('profile.offers.buildForNeed')}<//><//>` : null}
      <//>`)}
      ${!ctx.aiResult && list.length ? html`<${Text} kind="caption" tone="muted">${c('groupHint')}<//>` : null}
    <//>
  <//>`;
}

/* ── 04 Away, 05 Selling ───────────────────────────────────────────────────────────────────── */
function secOffline(ctx) {
  const m = ctx.model;
  return html`<${Fold} id="op-offline" number="04" title=${c('secOffline')} sub=${c('secOfflineSub', { n: m.offlineAgents.size })} open=${ctx.offlineOpen} onToggle=${() => ctx.setOfflineOpen(v => !v)}>
    <${Text} kind="caption" tone="muted">${c('offlineNote')}<//>
    ${m.offline.length ? catalogueTable(ctx, m.offline, c('secOffline')) : html`<${Text} tone="muted">${c('noneOffline')}<//>`}
  <//>`;
}
function secSelling(ctx) {
  const m = ctx.model;
  return html`<${Fold} id="op-selling" number="05" title=${c('secSelling')} sub=${m.selling.length ? c('sellingSub', { n: m.selling.length }) : c('sellingNone')} open=${ctx.sellOpen} onToggle=${() => ctx.setSellOpen(v => !v)}>
    <${Text} kind="caption" tone="muted">${c('sellingHint')}<//>
    <${Stack} direction="horizontal" align="start"><${Action} onClick=${() => ctx.pickView({ kind: 'page', id: 'sell' })}>${c('sell')}<//><//>
  <//>`;
}

/* ── Pages: the selling register (the map is map-page.js) ──────────────────────────────────── */
function sellPage(ctx) {
  const m = ctx.model;
  const list = [...m.items].sort((a, b) => (m.selling.includes(b) ? 1 : 0) - (m.selling.includes(a) ? 1 : 0) || a.offer.title.localeCompare(b.offer.title));
  const price = (o) => [o.price?.morsels > 0 ? `${o.price.morsels} ${t('profile.offers.morsels')}` : '', o.priceMoney ? `${(o.priceMoney.amount / 1e6).toFixed(2)} ${o.priceMoney.currency}` : ''].filter(Boolean).join(' · ') || c('noPrice');
  return renderPage(ctx, {
    id: 'sell', crumbs: [c('sell')], title: c('sell'),
    chips: chipRow([[c('chipSelling', { n: m.selling.length })], [c('chipOffers', { n: m.items.length }), 'muted']]),
    children: html`
      <${Text} kind="lead">${c('sellDesc')}<//>
      <${Table} density="compact" label=${c('sell')} headers=${[c('colOffer'), c('colVisibility'), c('colPrice'), '']}
        rows=${list.map(it => [nameCell(ctx, it), t('profile.offers.visibility.' + (it.offer.visibility || 'private')), { text: price(it.offer), mono: true },
          html`<${Action} onClick=${() => ctx.pickView({ kind: 'offer', key: it.key, sell: true })}>${c('setPrice')}<//>`])} />`,
  });
}
