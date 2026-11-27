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
 *   Made of the component kit: the page passes data and never a class. The cover explains itself the
 *   designed way (.claude/rules/page-guidance.md): the page's start (PageStart "offers") and the
 *   title's question mark (concept.offer).
 * @structure renderOffersView · renderCover · secBack · secAuto · secAsk · catalogue · aiResults · sellPage
 * @usage import { renderOffersView } from './offers/cover.js';
 * @version-history
 *   v2.5.0 -- 2026-11-27 -- The strip says where things stand and draws nothing with no offer and no delivery
 *     (hideZeros): the offers with the agents online, what is under way, failed or stalled deliveries and finished
 *     ones that wait for a rating, the last two in the notice tone and each a way to its inbox filter; the seven head
 *     tags go, except what is for sale. The deliveries (op-back) are drawn once something came back, a failed and
 *     then an unrated one first; the offers (op-ask) follow as 02 and are always drawn, without the search and the
 *     grouping while there is nothing to ask, and with one line that says how offers come and a way to the Agents
 *     page; what runs on its own (op-auto) is a row that says its lines or its failed steps and opens in place, with
 *     the scheduler and workflows links inside; the offline and selling rows are drawn once they hold something.
 *     Sections are numbered after the filter; the rail is drawn with two or more. The head's Ask is quiet while there
 *     is nothing to ask or a search is typed. No control was removed.
 *   v2.4.0 -- 2026-11-08 -- The cover explains itself the designed way (.claude/rules/page-guidance.md):
 *     PageStart "offers" in the start slot (folded once a delivery has come back; its button goes to
 *     section 03) and the title's question mark concept.offer, so a first-time reader learns what an
 *     offer is and where to begin.
 *   v2.3.0 -- 2026-11-02 -- The data products moved to "Data you share" (views/profile/shared-data-tab.js):
 *     section 06, the products page, a product's page and the wizard are that tab's now; this page keeps
 *     the agents' offers (WP11, board Jakamasi-data).
 *   v2.2.0 -- 2026-11-01 -- Section 06 is the data products (data-list.js); a product opens as its own
 *     page (data-product.js), "New data product" as the six-step wizard (wizard.js), and the page of
 *     every product is a page from the rail (WP9a, design canvas "Data ulos", board Tarjoama).
 *   v2.1.1 -- 2026-10-11 -- The selling register's price-and-pacing cell wraps instead of ending in an ellipsis, and on a phone the rows stack with each cell's column name before it (List labels instead of keepCols), so the pacing amount shows at every width. Its column head is colPricePacing ("Price and pacing"); colPrice stays the selling editor's money field label.
 *   v2.1.0 -- 2026-10-11 -- The selling register's price column says the money price (or Free) and the pacing amount (tollMorsels, 3.x price.morsels as fallback); a morsel amount is no longer a price.
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
import { priceAndPacing } from '/js/format.js';
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
import { PageStart } from '/components/PageStart.js';
import { scrollToSection } from '/components/Rail.js';
import { groupItems } from './model.js';
import { c, word, agentMark, getWord, costTime, statusWord, deliveryRows, rel, crumb, pageLinks, renderPage } from './frame.js';
import { renderOffer } from './offer-page.js';
import { renderInbox, renderDeliverable } from './inbox.js';
import { MapPage } from './map-page.js';

const BACK_ROWS = 6;
// t() answers the key itself when there is no word, so the need's own name shows then.
const needLabel = (k) => { const w = t('profile.offers.need.' + k); return w === 'profile.offers.need.' + k ? k : w; };
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
  const inProgress = m.waiting.filter(d => d.status !== 'stalled').length;
  const toInbox = (filter) => () => ctx.pickView({ kind: 'page', id: 'inbox', filter });
  // Where things stand, from the feed and the deliveries the page already read: the offers there are
  // (and how many agents are online), what is under way, and the two that need the person: failed or
  // stalled deliveries and finished ones that wait for a rating, each a way to its inbox filter. With
  // no offer and no delivery every figure is zero and the strip is not drawn (hideZeros).
  const strip = html`<${FigureStrip} hideZeros items=${[
    { key: 'offers', n: m.items.length, label: c('stripOffers'), sub: m.agents ? c('stripOffersSub', { a: m.agents, o: m.onlineAgents }) : undefined },
    { key: 'progress', n: inProgress, label: c('stripInProgress') },
    { key: 'failed', n: m.failed.length, tone: m.failed.length ? 'notice' : undefined, label: c('stripFailed'),
      onClick: m.failed.length ? toInbox('failed') : undefined },
    { key: 'unrated', n: m.unrated.length, tone: m.unrated.length ? 'notice' : undefined, label: c('stripUnrated'),
      onClick: m.unrated.length ? toInbox('unrated') : undefined },
  ]} />`;
  // The counts the strip says are not repeated as tags; only what is for sale stays, once something is.
  const marks = [m.selling.length ? chip(m.selling.length, 'chipSelling') : null];
  const actions = html`
    ${/* With no offer to ask for, the head's Ask has nothing to lead to and is drawn quiet; while a
          search is typed, the section's own "Build for this need" may be the loud one. */''}
    <${Loud} quiet=${!m.askable.length || !!ctx.q.trim()} onClick=${() => scrollToSection('op-ask')}>${c('ask')}<//>
    <${Actions}>
      <${Action} small onClick=${() => ctx.pickView({ kind: 'page', id: 'inbox' })}>${c('inbox')}<//>
      <${Action} small onClick=${() => ctx.pickView({ kind: 'page', id: 'map' })}>${c('map')}<//>
    <//>`;
  // The start: folded once something has come back from an agent; its button goes to the catalogue.
  const start = html`<${PageStart} id="offers" done=${ctx.loadingDeliveries ? null : m.latest.length > 0}
    action=${{ onClick: () => scrollToSection('op-ask') }} />`;
  // What is drawn: the deliveries once something came back, the offers always (with none, its one
  // line is the page's empty line and says how offers come), and three rows that open in place once
  // they hold something: what runs on its own, the offline agents, and selling. Numbered after the
  // filter, so a hidden section leaves no gap.
  const shown = [
    m.latest.length ? { id: 'op-back', label: c('secBack'), count: m.latest.length } : null,
    { id: 'op-ask', label: c('secAsk'), count: m.askable.length },
    m.chains.length + m.autoSingles.length ? { id: 'op-auto', label: c('secAuto'), count: m.chains.length + m.autoSingles.length } : null,
    m.offlineAgents.size ? { id: 'op-offline', label: c('secOffline'), count: m.offlineAgents.size } : null,
    m.items.length ? { id: 'op-selling', label: c('secSelling'), count: m.selling.length } : null,
  ].filter(Boolean).map((s, i) => ({ ...s, num: String(i + 1).padStart(2, '0') }));
  const numOf = Object.fromEntries(shown.map((s) => [s.id, s.num]));
  return html`
    <${SettingsPage} name="op" crumb=${crumb(ctx, [])} title=${t('profile.tabs.offers')} help="concept.offer" marks=${marks} desc=${c('desc')}
      actions=${actions} start=${start} strip=${strip} railTitle=${c('railTitle')}
      sections=${shown.length > 1 ? shown : undefined}
      pagesLabel=${c('pages')} pages=${pageLinks(ctx, null)}>
      ${numOf['op-back'] ? secBack(ctx, numOf['op-back']) : null}
      ${secAsk(ctx, numOf['op-ask'])}
      ${numOf['op-auto'] ? secAuto(ctx, numOf['op-auto']) : null}
      ${numOf['op-offline'] ? secOffline(ctx, numOf['op-offline']) : null}
      ${numOf['op-selling'] ? secSelling(ctx, numOf['op-selling']) : null}
    <//>`;
}

/** The deliveries that need the person first (failed or stalled, then finished and unrated), then the newest. */
function attentionFirst(m) {
  const rank = (d) => (d.status === 'failed' || d.status === 'stalled' ? 0 : d.status === 'done' && !d.rating ? 1 : 2);
  return m.latest.map((d, i) => [d, i]).sort((a, b) => (rank(a[0]) - rank(b[0])) || (a[1] - b[1])).map(([d]) => d);
}

/* ── 01 What came back ─────────────────────────────────────────────────────────────────────── */
/** Drawn once something came back (renderCover); a delivery that needs the person comes first. */
function secBack(ctx, n) {
  const m = ctx.model;
  const doors = html`
    <${Action} tone="more" onClick=${() => ctx.pickView({ kind: 'page', id: 'inbox', filter: 'all' })}>${c('allN', { n: m.latest.length })}<//>
    <${Action} small soft onClick=${() => ctx.pickView({ kind: 'page', id: 'inbox', filter: 'unrated' })}>${c('unratedN', { n: m.unrated.length })}<//>`;
  const needsYou = m.failed.length + m.unrated.length > 0;
  return html`<${Section} id="op-back" num=${n} title=${c('secBack')} count=${needsYou ? c('secBackSubAttention') : c('secBackSub')} doors=${doors} first=${true}>
    ${m.latest.length ? deliveryRows(ctx, attentionFirst(m).slice(0, BACK_ROWS), { head: true }) : html`<${Note} kind="quiet">${ctx.loadingDeliveries ? '…' : t('profile.offers.inboxEmpty')}<//>`}
  <//>`;
}

/* ── 02 Runs on its own ────────────────────────────────────────────────────────────────────── */
/** One offer as a step of a line: its last run's state colours the frame. */
function stepOf(ctx, it) {
  const last = ctx.model.latestByAgent.get(it.agent);
  const state = last ? (last.status === 'done' ? 'done' : (['failed', 'stalled'].includes(last.status) ? 'failed' : undefined)) : undefined;
  return { key: it.key, name: it.offer.title, sub: `${it.agent}${last ? ` · ${statusWord(last.status)}` : ''}`, state, onOpen: () => openOffer(ctx, it) };
}
/**
 * Drawn once an offer runs on its own (renderCover): one row that says how many lines and single
 * offers there are, or that steps failed, and opens in place. The scheduler and the workflows, which
 * were the section's doors, stand at the top of the opened part.
 */
function secAuto(ctx, n) {
  const m = ctx.model;
  const failedSteps = m.chains.reduce((s, ch) => s + (ch.failed || 0), 0);
  const sub = failedSteps ? c('stepsFailed', { n: failedSteps }) : c('secAutoSub', { c: m.chains.length, s: m.autoSingles.length });
  return html`<${Section} fold wrap id="op-auto" num=${n} title=${c('secAuto')} sub=${sub} open=${ctx.autoOpen} onToggle=${() => ctx.setAutoOpen(v => !v)}>
    <${Actions}>
      <${Action} small soft onClick=${() => ctx.openTab('scheduler')}>${c('scheduler')}<//>
      <${Action} small soft onClick=${() => ctx.openTab('workflows')}>${c('workflows')}<//>
    <//>
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
function secAsk(ctx, n) {
  const m = ctx.model;
  const needle = ctx.q.trim().toLowerCase();
  const list = needle ? m.askable.filter(it => (it.offer.title + ' ' + it.offer.ask + ' ' + (it.offer.tags || []).join(' ') + ' ' + it.agent).toLowerCase().includes(needle)) : m.askable;
  const any = m.askable.length > 0;
  // With nothing to ask yet, the grouping and the search have nothing to work on and are not drawn;
  // they come with the first offer. The one line says where offers come from and the way there.
  const doors = any ? html`<${Tabs} tone="fold" kind="view" value=${ctx.axis} onSelect=${ctx.setAxis}
    items=${[{ value: 'need', label: c('byNeed') }, { value: 'agent', label: c('byAgent') }, { value: 'name', label: c('byName') }]} />` : null;
  return html`<${Section} id="op-ask" num=${n} title=${c('secAsk')} count=${c('secAskSub', { n: m.askable.length })} doors=${doors} first=${n === '01'}>
    ${any ? html`<${SearchLine} value=${ctx.q} placeholder=${t('profile.offers.searchPlaceholder')} onInput=${(e) => ctx.setQ(e.target.value)}
      onEnter=${ctx.aiOn ? () => ctx.runNeedSearch() : undefined}>
      ${ctx.aiOn ? html`<${Action} small disabled=${!ctx.q.trim() || ctx.aiResult === 'loading'} onClick=${ctx.runNeedSearch}>${t('profile.offers.aiSearch')}<//><${Note} inline>${c('aiHint')}<//>` : null}
    <//>` : null}
    ${ctx.aiResult ? aiResults(ctx) : (list.length ? catalogue(ctx, list, ctx.axis) : html`<${Stack} gap="medium">
      <${Note} kind="quiet">${any ? t('profile.offers.noMatch')
        : html`${t('profile.offers.empty')} <${Action} small soft onClick=${() => ctx.openTab('agents')}>${t('profile.tabs.agents')}<//>`}<//>
      ${ctx.builder && needle ? html`<${Actions}><${Loud} control disabled=${ctx.busy} onClick=${() => ctx.buildForNeed()}>${t('profile.offers.buildForNeed')}<//><//>` : null}
    <//>`)}
    ${!ctx.aiResult && list.length ? html`<${Note}>${c('groupHint')}<//>` : null}
  <//>`;
}

/* ── 04 Away, 05 Selling ───────────────────────────────────────────────────────────────────── */
function secOffline(ctx, n) {
  const m = ctx.model;
  return html`<${Section} fold wrap id="op-offline" num=${n} title=${c('secOffline')} sub=${c('secOfflineSub', { n: m.offlineAgents.size })} open=${ctx.offlineOpen} onToggle=${() => ctx.setOfflineOpen(v => !v)}>
    <${Note}>${c('offlineNote')}<//>
    <${List} cols="name-get-cost-trust-doors" keepCols empty=${c('noneOffline')}>${m.offline.map(it => catalogueRow(ctx, it))}<//>
  <//>`;
}
function secSelling(ctx, n) {
  const m = ctx.model;
  return html`<${Section} fold wrap id="op-selling" num=${n} title=${c('secSelling')} sub=${m.selling.length ? c('sellingSub', { n: m.selling.length }) : c('sellingNone')} open=${ctx.sellOpen} onToggle=${() => ctx.setSellOpen(v => !v)}>
    <${Note}>${c('sellingHint')}<//>
    <${Actions}><${Action} small onClick=${() => ctx.pickView({ kind: 'page', id: 'sell' })}>${c('sell')}<//><//>
  <//>`;
}

/* ── Pages: the selling register (the map is map-page.js) ──────────────────────────────────── */
function sellPage(ctx) {
  const m = ctx.model;
  const list = [...m.items].sort((a, b) => (m.selling.includes(b) ? 1 : 0) - (m.selling.includes(a) ? 1 : 0) || a.offer.title.localeCompare(b.offer.title));
  // The money price (or Free) and the pacing amount: "Free · pacing 5 morsels". A morsel is never a price.
  const price = (o) => priceAndPacing(o, t);
  return renderPage(ctx, {
    id: 'sell', crumbs: [c('sell')], title: c('sell'),
    marks: [{ label: c('chipSelling', { n: m.selling.length }) }, { label: c('chipOffers', { n: m.items.length }), tone: 'dim' }],
    desc: c('sellDesc'),
    children: html`
      <${List} cols="name-state-price-doors" labels head=${[c('colOffer'), c('colVisibility'), c('colPricePacing'), '']}
        rows=${list} render=${it => html`
          <${Row} key=${it.key}>
            <${Name} clip onOpen=${() => openOffer(ctx, it)} meta=${agentMark(it)}>${it.offer.title}<//>
            <${Desc} clip>${t('profile.offers.visibility.' + (it.offer.visibility || 'private'))}<//>
            <${Desc}>${price(it.offer)}<//>
            <${Doors}><${Action} small row onClick=${() => ctx.pickView({ kind: 'offer', key: it.key, sell: true })}>${c('setPrice')}<//><//>
          <//>`} />`,
  });
}
