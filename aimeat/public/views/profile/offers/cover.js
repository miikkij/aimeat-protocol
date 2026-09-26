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
 *   Made of the component kit: the page passes data and never a class.
 * @structure renderOffersView · renderCover · secBack · secAuto · secAsk · catalogue · aiResults · sellPage
 * @usage import { renderOffersView } from './offers/cover.js';
 * @version-history
 *   v2.0.0 -- 2026-09-26 -- Every part is a component call that gets data (page group G6): the frame
 *     is SettingsPage (crumb, head, marks, strip, rail as data), the strip FigureStrip; the production
 *     lines the List with the StepStrip under each line (a special view, components/StepStrip.js);
 *     the catalogue the List with its Group headings (their count the tally); the way it is grouped
 *     the fold Tabs; the search the SearchLine with the AI search and its hint after the field; what
 *     the AI found the Group heading with its "clear" and the List of hits (why it fits the Name's
 *     note); the away and selling sections folded Sections (their detail under the title on a narrow
 *     screen); the selling register the List. The selling tag is dim again while nothing is for sale,
 *     and the offers tag on the register (main's og-chip--dim, which the previous branch lost).
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
import { SettingsPage } from '/components/SettingsPage.js';
import { Section } from '/components/Section.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Tinted } from '/components/Figure.js';
import { List, Row, Name, Desc, Doors, Group, SearchLine } from '/components/List.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Tabs } from '/components/Tabs.js';
import { Box } from '/components/Box.js';
import { Note } from '/components/Note.js';
import { Stack } from '/components/Layout.js';
import { StepStrip } from '/components/StepStrip.js';
import { scrollToSection } from '/components/Rail.js';
import { groupItems } from './model.js';
import { c, word, agentMark, getWord, costTime, statusWord, deliveryRows, rel, crumb, pageLinks, renderPage } from './frame.js';
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
  const chip = (n, key, tone) => ({ label: c(key, { n }), tone });
  const last = m.latest[0];
  const strip = html`<${FigureStrip} items=${[
    { key: 'today', n: m.todayN, label: c('stripToday'), sub: last ? c('stripTodaySub', { a: last.agent, t: rel(last.updated_at), s: statusWord(last.status) }) : c('noneBack') },
    { key: 'waiting', n: m.waiting.length, label: c('stripWaiting'), sub: c('stripWaitingSub', { q: m.waiting.filter(d => d.status === 'queued').length, s: m.waiting.filter(d => d.status === 'stalled').length, f: m.failed7 }) },
    { key: 'auto', n: m.autoN, label: c('stripAuto'), sub: c('stripAutoSub', { c: m.chains.length, s: m.autoSingles.length }) },
    { key: 'rated', n: m.rated, tone: m.rated ? undefined : 'coral', label: c('stripRated'), sub: c('stripRatedSub', { n: m.unrated.length }) },
  ]} />`;
  const marks = [
    chip(m.items.length, 'chipOffers'), chip(m.agents, 'chipAgents'), chip(m.onlineAgents, 'chipOnline'), chip(m.autoN, 'chipAuto'), chip(m.stepsN, 'chipSteps'),
    chip(m.selling.length, 'chipSelling', m.selling.length ? undefined : 'dim'), chip(m.latest.length, 'chipDeliveries', 'coral'),
  ];
  const actions = html`
    <${Loud} onClick=${() => scrollToSection('op-ask')}>${c('ask')}<//>
    <${Actions}>
      <${Action} small onClick=${() => ctx.pickView({ kind: 'page', id: 'inbox' })}>${c('inbox')}<//>
      <${Action} small onClick=${() => ctx.pickView({ kind: 'page', id: 'map' })}>${c('map')}<//>
    <//>`;
  return html`
    <${SettingsPage} name="op" crumb=${crumb(ctx, [])} title=${t('profile.tabs.offers')} marks=${marks} desc=${c('desc')}
      actions=${actions} strip=${strip} railTitle=${c('railTitle')}
      sections=${[
        { id: 'op-back', num: '01', label: c('secBack'), count: m.latest.length },
        { id: 'op-auto', num: '02', label: c('secAuto'), count: m.chains.length + m.autoSingles.length },
        { id: 'op-ask', num: '03', label: c('secAsk'), count: m.askable.length },
        { id: 'op-offline', num: '04', label: c('secOffline'), count: m.offlineAgents.size },
        { id: 'op-selling', num: '05', label: c('secSelling'), count: m.selling.length },
      ]}
      pagesLabel=${c('pages')} pages=${pageLinks(ctx, null)}>
      ${secBack(ctx)}
      ${secAuto(ctx)}
      ${secAsk(ctx)}
      ${secOffline(ctx)}
      ${secSelling(ctx)}
    <//>`;
}

/* ── 01 What came back ─────────────────────────────────────────────────────────────────────── */
function secBack(ctx) {
  const m = ctx.model;
  const doors = html`
    <${Action} tone="more" onClick=${() => ctx.pickView({ kind: 'page', id: 'inbox', filter: 'all' })}>${c('allN', { n: m.latest.length })}<//>
    <${Action} small soft onClick=${() => ctx.pickView({ kind: 'page', id: 'inbox', filter: 'unrated' })}>${c('unratedN', { n: m.unrated.length })}<//>`;
  return html`<${Section} id="op-back" num="01" title=${c('secBack')} count=${c('secBackSub')} doors=${doors} first=${true}>
    ${m.latest.length ? deliveryRows(ctx, m.latest.slice(0, BACK_ROWS), { head: true }) : html`<${Note} kind="quiet">${ctx.loadingDeliveries ? '…' : t('profile.offers.inboxEmpty')}<//>`}
  <//>`;
}

/* ── 02 Runs on its own ────────────────────────────────────────────────────────────────────── */
/** One offer as a step of a line: its last run's state colours the frame. */
function stepOf(ctx, it) {
  const last = ctx.model.latestByAgent.get(it.agent);
  const state = last ? (last.status === 'done' ? 'done' : (['failed', 'stalled'].includes(last.status) ? 'failed' : undefined)) : undefined;
  return { key: it.key, name: it.offer.title, sub: `${it.agent}${last ? ` · ${statusWord(last.status)}` : ''}`, state, onOpen: () => openOffer(ctx, it) };
}
function secAuto(ctx) {
  const m = ctx.model;
  const doors = html`
    <${Action} small soft onClick=${() => ctx.openTab('scheduler')}>${c('scheduler')}<//>
    <${Action} small soft onClick=${() => ctx.openTab('workflows')}>${c('workflows')}<//>`;
  return html`<${Section} id="op-auto" num="02" title=${c('secAuto')} count=${c('secAutoSub', { c: m.chains.length, s: m.autoSingles.length })} doors=${doors}>
    <${List} cols="name-doors" keepCols empty=${c('noneAuto')}>
      ${m.chains.map(ch => html`<${Row} key=${ch.id} below=${html`<${StepStrip} chain steps=${ch.steps.map(s => stepOf(ctx, s))} />`}>
        <${Name} meta=${html`${c('stepsN', { n: ch.steps.length })}${ch.last ? ` · ${c('lastRun', { t: rel(ch.last.updated_at) })}` : ''}${ch.failed ? html` · <${Tinted} tone="notice">${c('stepsFailed', { n: ch.failed })}<//>` : ''}`}>${ch.title}<//>
        <${Doors}><${Action} small onClick=${() => ctx.openTab('workflows')}>${c('openWorkflow')}<//><//>
      <//>`)}
      ${m.autoSingles.length ? html`<${Row} key="singles" below=${html`<${StepStrip} steps=${m.autoSingles.map(s => stepOf(ctx, s))} />`}>
        <${Name} meta=${c('singlesSub')}>${c('singles')}<//>
        <${Doors} />
      <//>` : null}
    <//>
  <//>`;
}

/* ── 03 Ask ────────────────────────────────────────────────────────────────────────────────── */
function catalogueRow(ctx, it) {
  return html`
    <${Row} key=${it.key}>
      <${Name} clip onOpen=${() => openOffer(ctx, it)} meta=${agentMark(it)}>${it.offer.title}<//>
      <${Desc} clip>${getWord(it.offer)}<//>
      <${Desc} clip>${costTime(it.offer)}<//>
      <${Desc} clip>${word('verification', it.offer.verification)}<//>
      <${Doors}><${Action} small row onClick=${() => openOffer(ctx, it)}>${c('ask')}<//><//>
    <//>`;
}
export function catalogue(ctx, items, axis) {
  const groups = groupItems(items, axis);
  return html`
    <${List} cols="name-get-cost-trust-doors" keepCols head=${[c('colOffer'), c('colGet'), c('colCostTime'), c('colTrust'), '']}>
      ${groups.map(g => (axis !== 'name'
        ? html`<${Group} key=${'l' + g.key} title=${axis === 'need' ? needLabel(g.key) : g.key} count=${g.items.length}>${g.items.map(it => catalogueRow(ctx, it))}<//>`
        : g.items.map(it => catalogueRow(ctx, it))))}
    <//>`;
}
function aiResults(ctx) {
  const r = ctx.aiResult;
  if (r === 'loading') return html`<${Note} kind="loading">${t('profile.offers.aiThinking')}<//>`;
  const noMatch = !r.ranked.length || r.noMatch;
  return html`
    <${Group} title=${t('profile.offers.aiResultsTitle')} doors=${html`<${Action} small soft onClick=${ctx.clearAi}>${t('profile.offers.aiClear')}<//>`} />
    ${noMatch ? html`<${Stack} gap="medium">
      <${Note} kind="quiet">${t('profile.offers.aiNoMatch')}<//>
      ${r.brief ? html`<${Box}>${r.brief}<//>` : null}
      ${ctx.builder ? html`<${Actions}><${Loud} control disabled=${ctx.busy} onClick=${() => ctx.buildForNeed(r.brief)}>${t('profile.offers.buildForNeed')}<//><//>` : null}
    <//>` : null}
    ${r.ranked.length ? html`<${List} cols="hit-doors" keepCols>
      ${r.ranked.map(({ item, why }) => { const it = ctx.model.byKey.get(item.key || (item.agent + '/' + item.offer.id)) || item; return html`
        <${Row} key=${it.key}>
          <${Name} onOpen=${() => openOffer(ctx, it)} after=${html` ${agentMark(it)}`} desc=${it.offer.ask} note=${why || null}>${it.offer.title}<//>
          <${Doors}><${Action} small onClick=${() => openOffer(ctx, it)}>${c('ask')}<//><//>
        <//>`; })}
    <//>` : null}`;
}
function secAsk(ctx) {
  const m = ctx.model;
  const needle = ctx.q.trim().toLowerCase();
  const list = needle ? m.askable.filter(it => (it.offer.title + ' ' + it.offer.ask + ' ' + (it.offer.tags || []).join(' ') + ' ' + it.agent).toLowerCase().includes(needle)) : m.askable;
  const doors = html`<${Tabs} tone="fold" kind="view" value=${ctx.axis} onSelect=${ctx.setAxis}
    items=${[{ value: 'need', label: c('byNeed') }, { value: 'agent', label: c('byAgent') }, { value: 'name', label: c('byName') }]} />`;
  return html`<${Section} id="op-ask" num="03" title=${c('secAsk')} count=${c('secAskSub', { n: m.askable.length })} doors=${doors}>
    <${SearchLine} value=${ctx.q} placeholder=${t('profile.offers.searchPlaceholder')} onInput=${(e) => ctx.setQ(e.target.value)}
      onEnter=${ctx.aiOn ? () => ctx.runNeedSearch() : undefined}>
      ${ctx.aiOn ? html`<${Action} small disabled=${!ctx.q.trim() || ctx.aiResult === 'loading'} onClick=${ctx.runNeedSearch}>${t('profile.offers.aiSearch')}<//><${Note} inline>${c('aiHint')}<//>` : null}
    <//>
    ${ctx.aiResult ? aiResults(ctx) : (list.length ? catalogue(ctx, list, ctx.axis) : html`<${Stack} gap="medium">
      <${Note} kind="quiet">${m.askable.length ? t('profile.offers.noMatch') : t('profile.offers.empty')}<//>
      ${ctx.builder && needle ? html`<${Actions}><${Loud} control disabled=${ctx.busy} onClick=${() => ctx.buildForNeed()}>${t('profile.offers.buildForNeed')}<//><//>` : null}
    <//>`)}
    ${!ctx.aiResult && list.length ? html`<${Note}>${c('groupHint')}<//>` : null}
  <//>`;
}

/* ── 04 Away, 05 Selling ───────────────────────────────────────────────────────────────────── */
function secOffline(ctx) {
  const m = ctx.model;
  return html`<${Section} fold wrap id="op-offline" num="04" title=${c('secOffline')} sub=${c('secOfflineSub', { n: m.offlineAgents.size })} open=${ctx.offlineOpen} onToggle=${() => ctx.setOfflineOpen(v => !v)}>
    <${Note}>${c('offlineNote')}<//>
    <${List} cols="name-get-cost-trust-doors" keepCols empty=${c('noneOffline')}>${m.offline.map(it => catalogueRow(ctx, it))}<//>
  <//>`;
}
function secSelling(ctx) {
  const m = ctx.model;
  return html`<${Section} fold wrap id="op-selling" num="05" title=${c('secSelling')} sub=${m.selling.length ? c('sellingSub', { n: m.selling.length }) : c('sellingNone')} open=${ctx.sellOpen} onToggle=${() => ctx.setSellOpen(v => !v)}>
    <${Note}>${c('sellingHint')}<//>
    <${Actions}><${Action} small onClick=${() => ctx.pickView({ kind: 'page', id: 'sell' })}>${c('sell')}<//><//>
  <//>`;
}

/* ── Pages: the selling register (the map is map-page.js) ──────────────────────────────────── */
function sellPage(ctx) {
  const m = ctx.model;
  const list = [...m.items].sort((a, b) => (m.selling.includes(b) ? 1 : 0) - (m.selling.includes(a) ? 1 : 0) || a.offer.title.localeCompare(b.offer.title));
  const price = (o) => [o.price?.morsels > 0 ? `${o.price.morsels} ${t('profile.offers.morsels')}` : '', o.priceMoney ? `${(o.priceMoney.amount / 1e6).toFixed(2)} ${o.priceMoney.currency}` : ''].filter(Boolean).join(' · ') || c('noPrice');
  return renderPage(ctx, {
    id: 'sell', crumbs: [c('sell')], title: c('sell'),
    marks: [{ label: c('chipSelling', { n: m.selling.length }) }, { label: c('chipOffers', { n: m.items.length }), tone: 'dim' }],
    desc: c('sellDesc'),
    children: html`
      <${List} cols="name-state-price-doors" keepCols head=${[c('colOffer'), c('colVisibility'), c('colPrice'), '']}
        rows=${list} render=${it => html`
          <${Row} key=${it.key}>
            <${Name} clip onOpen=${() => openOffer(ctx, it)} meta=${agentMark(it)}>${it.offer.title}<//>
            <${Desc} clip>${t('profile.offers.visibility.' + (it.offer.visibility || 'private'))}<//>
            <${Desc} clip>${price(it.offer)}<//>
            <${Doors}><${Action} small row onClick=${() => ctx.pickView({ kind: 'offer', key: it.key, sell: true })}>${c('setPrice')}<//><//>
          <//>`} />`,
  });
}
