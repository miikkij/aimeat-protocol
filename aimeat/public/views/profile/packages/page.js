/**
 * @file public/views/profile/packages/page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Packages page in the poster face: ready-made wholes that install as the owner's
 *   own. The mast and the strip; installed packages first, then what is on offer (template listings
 *   and public packages joined, with facets and a search), then the owner's own publications once
 *   there are any; as rows that open in place, the three roads to a new package (your own apps, ask
 *   your AI with the package-builder request, or import a zip) and how an agent installs. What opens
 *   under a row is rows.js. Pure render over the ctx bag.
 * @structure renderPage · secInstalled · secOffers · secOwn · secNew · composeForm · secAgent
 * @usage import { renderPage } from './packages/page.js';
 * @version-history
 *   v1.24.0 -- 2026-11-27 -- Usability pass of the Settings pages: what is installed stays 01 and what is
 *     on offer stays open (it is how one begins); an installed copy whose package has a newer version
 *     leads its list, then one that is not running, and their count leads the strip in the notice
 *     tone; a draft of one's own leads its list and turns its figure to the notice tone. The strip
 *     drops the other-servers figure (the offers' facet counts them) and is not drawn with nothing
 *     installed and nothing of one's own (the head's paragraph says what is on offer); the head's
 *     marks that repeated it are gone. Your publications are drawn once there are any; a new package
 *     and how an agent installs are rows that open in place. Sections are numbered after the filter.
 *   v1.23.1 — 2026-10-16 — The operator's "Fetch from other servers" shows when package federation is on
 *     (`ctx.remoteEnabled`), not only when a remote listing is already there: the listings come from that
 *     fetch, so the old condition could never become true (QA audit F1-04).
 *   v1.23.0 — 2026-10-03 — The page's start (components/PageStart.js: the first prompt asks the person's AI what is on offer, its button opens the offers) and the title's question mark, concept.package (guidance part B).
 *   v1.22.0 — 2026-09-26 — On the component kit (page group G7): the page is SettingsPage (crumb, mast,
 *     marks, strip, rail as data), the lists are List (Filters, SearchLine, More, the pick rows of the
 *     compose road), the roads Roads/Road, the AI rule a Box, the facts Facts, the hidden zip field
 *     FileDrop; the page writes no class. Put back from main: the dim tag on "0 own" and "0 from
 *     other nodes" (og-chip--dim); the sync door is the soft action link, as main's quiet door.
 *   v1.21.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.20.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.19.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.18.0 -- 2026-09-25 -- A filter's count is the Count (.poster-count, tally), a unification: Jouni's decision "Count".
 *   v1.17.0 -- 2026-09-25 -- "Loading your apps" is the quiet sentence (.poster-quiet), as the empty line beside it, a unification: Jouni's decision "Empty line".
 *   v1.16.0 -- 2026-09-25 -- The line under the list (show more, how many shown, sync) is the More line (.more-line, css/components/more-line.css), a library part by a move; .pk-more keeps its wrap.
 *   v1.15.0 -- 2026-09-25 -- The AI section facts are the Facts (facts, facts-k, facts-v), a unification: the look most tabs use.
 *   v1.14.0 -- 2026-09-25 -- The installed packages, the packages on offer and the owner's own are the Listing (listing, listing-row, its head row), a unification: the look most tabs use.
 *   v1.13.0 -- 2026-09-25 -- A search field over a list is the Search line (.search-line with the Text field); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.13.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.12.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.11.0 -- 2026-09-25 -- A framed box around one thing is the Object box (.poster-box; on a grey ground its copy tone), in the tone its look already was (Jouni's decision "Object box", a unification).
 *   v1.10.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.9.0 -- 2026-09-25 -- A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v1.8.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.7.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.6.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.5.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   v1.4.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.3.0 -- 2026-09-13 -- Compose the existing instruction frame from poster.css.
 *   v1.2.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.1.0 — 2026-09-05 — A third road, leading: make a package out of apps you already have. Each
 *     app says what it loads, because that is what decides whether it travels with the package or is
 *     named as something the installing side must already have.
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { PageSection } from '/components/PageSection.js';
import { FoldSection } from '/components/FoldSection.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { PageStart } from '/components/PageStart.js';
import { scrollToSection } from '/components/Rail.js';
import { Hint } from '/components/Hint.js';
import { Facts } from '/components/Facts.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { TextField } from '/components/TextField.js';
import { FileDrop } from '/components/FileDrop.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Roads, Road } from '/components/Roads.js';
import { List, Row, Name, Desc, Filters, Filter, SearchLine, More } from '/components/List.js';
import { x, crumb, pageLinks, agentRule, categoryWord } from './frame.js';
import { instanceRow, offerRow, ownRow, loadingRow } from './rows.js';

const PAGE = 20;
const facet = (on, label, n, onClick, key) => html`<${Filter} key=${key} on=${on} count=${n} onClick=${onClick}>${label}<//>`;
const matches = (q, ...fields) => !q || fields.some((f) => String(f || '').toLowerCase().includes(q));

/** An installed copy whose package has a newer version than the one it runs (the row says so too). */
const newerOf = (ctx, i) => {
  const source = ctx.offerByGroup[i.packageGroupId] || ctx.ownByGroup[i.packageGroupId] || null;
  return !!(source?.version && source.version !== i.packageVersion);
};
/** Stable sort by a rank: within a rank the order the node gave stays. */
const byRank = (list, rank) => list.map((v, i) => [v, i]).sort((a, b) => (rank(a[0]) - rank(b[0])) || (a[1] - b[1])).map(([v]) => v);

export function renderPage(ctx) {
  const d = ctx.data;   // null while loading
  const instances = d ? ctx.instances : [];
  const offers = d ? ctx.offers : [];
  const own = d ? ctx.own : [];
  const parts = instances.reduce((s, i) => s + (i.installedComponents || []).length, 0);
  const none = d && instances.length === 0;
  const newer = instances.filter((i) => newerOf(ctx, i)).length;
  const drafts = own.filter((p) => p.status === 'draft').length;

  // The figures, from the one read the page makes: what is installed and whether it runs, how many
  // copies have a newer version (only when some have, in the notice tone), what is on offer, and the
  // owner's own publications once there are any (notice while one is a draft nobody can install).
  // With nothing installed and nothing of one's own there is no strip: the head's paragraph already
  // says how many are on offer.
  const strip = !d ? html`<${FigureStrip} loading=${3} />` : none && !own.length ? null : html`<${FigureStrip} items=${[
    { key: 'installed', n: instances.length, label: x('stripInstalled'), sub: instances.length ? x('stripInstalledSub', { parts, running: instances.filter((i) => i.status === 'installed').length === instances.length ? x('allRunning') : x('someStopped') }) : x('stripInstalledNone') },
    newer ? { key: 'updates', n: newer, tone: 'notice', label: x('stripUpdates'), sub: x('stripUpdatesSub') } : null,
    { key: 'offers', n: offers.length, label: x('stripOffers'), sub: x('stripOffersSub', { system: offers.filter((o) => o.system).length, others: offers.filter((o) => !o.system && !o.remote).length }) },
    own.length ? { key: 'own', n: own.length, tone: drafts ? 'notice' : undefined, label: x('stripOwn'),
      sub: drafts ? x('stripOwnDrafts', { n: drafts }) : x('stripOwnSub', { pub: own.filter((p) => p.visibility === 'public').length, listed: own.filter((p) => ctx.listingByGroup[p.packageGroupId]).length }) } : null,
  ]} />`;

  const actions = html`
    <${Loud} control disabled=${ctx.busy === 'prompt'} onClick=${() => ctx.copyPrompt()}>${x('copyRequest')}<//>
    <${Actions}><${Action} small onClick=${() => ctx.pickZip()}>${x('importZip')}<//><//>`;
  // What is installed and what is on offer stay open (what is on offer is how one begins); the
  // owner's own publications are drawn once there are any; how a new package is made and how an
  // agent installs are rows. Numbered after the filter.
  const shown = [
    { id: 'pk-installed', label: x('secInstalled'), count: d ? instances.length : '' },
    { id: 'pk-offers', label: x('secOffers'), count: d ? offers.length : '' },
    own.length ? { id: 'pk-own', label: x('secOwn'), count: own.length } : null,
    { id: 'pk-new', label: x('secNew'), count: '' },
    { id: 'pk-ai', label: x('secAi'), count: '' },
  ].filter(Boolean).map((s, i) => ({ ...s, num: String(i + 1).padStart(2, '0') }));
  const numOf = Object.fromEntries(shown.map((s) => [s.id, s.num]));
  // The zip field is hidden; the mast's door and the third road open it (ctx.pickZip).
  const after = html`
    <${FileDrop} hidden accept=".zip" inputRef=${ctx.fileRef} onChange=${(e) => ctx.importZip(e)} />
    <${ctx.ConfirmUI} />`;

  return html`
    <${SettingsPage} name="packages" crumb=${crumb()} title=${t('profile.tabs.packages')} sub=${x('titleSub')} help="concept.package"
      desc=${none ? x('descEmpty', { n: offers.length }) : x('desc')} actions=${actions} strip=${strip}
      start=${html`<${PageStart} id="packages" done=${d ? instances.length > 0 : null} action=${{ onClick: () => scrollToSection('pk-offers') }} />`}
      railTitle=${x('railTitle')} sections=${shown} pagesLabel=${x('pages')} pages=${pageLinks()}
      after=${after}>
      ${secInstalled(ctx, byRank(instances, (i) => (newerOf(ctx, i) ? 0 : i.status !== 'installed' ? 1 : 2)))}
      ${secOffers(ctx, offers, numOf['pk-offers'])}
      ${numOf['pk-own'] ? secOwn(ctx, byRank(own, (p) => (p.status === 'draft' ? 0 : 1)), numOf['pk-own']) : null}
      ${secNew(ctx, numOf['pk-new'])}
      ${secAgent(ctx, numOf['pk-ai'])}
    <//>`;
}

function secInstalled(ctx, instances) {
  return html`
    <${PageSection} id="pk-installed" num="01" title=${x('secInstalled')} count=${ctx.data ? (instances.length ? x('secInstalledSub', { n: instances.length, parts: instances.reduce((s, i) => s + (i.installedComponents || []).length, 0) }) : x('secNone')) : null} first=${true}>
      ${!ctx.data ? loadingRow() : html`
        <${List} cols="name-desc-who-doors" head=${[x('colPackage'), x('colBrought'), x('colFrom'), '']}
          empty=${html`<${Note} kind="quiet"><b>${x('emptyInstalled')}</b> ${x('emptyInstalledSub')}<//>`}>
          ${instances.map((i) => instanceRow(ctx, i))}
        <//>
        ${instances.length ? html`<${Hint}>${x('hintInstalled')}<//>` : null}`}
    <//>`;
}

function secOffers(ctx, offers, num) {
  const F = ctx.filter;
  const q = (ctx.query || '').trim().toLowerCase();
  const cats = [...new Set(offers.map((o) => o.category).filter(Boolean))];
  let rows = offers;
  if (F.who === 'system') rows = rows.filter((o) => o.system);
  if (F.who === 'others') rows = rows.filter((o) => !o.system && !o.remote);
  if (F.who === 'remote') rows = rows.filter((o) => o.remote);
  if (F.cat) rows = rows.filter((o) => o.category === F.cat);
  if (q) rows = rows.filter((o) => matches(q, o.title, o.name, o.description, o.author, categoryWord(o.category), o.tags.join(' ')));
  const shown = rows.slice(0, ctx.shown);
  const set = (patch) => ctx.setFilter(patch);
  const tog = (field, value) => set({ [field]: F[field] === value ? '' : value });
  // Only an operator syncs the other nodes' listings, and only when this node has package federation on.
  const sync = ctx.isOperator && ctx.remoteEnabled
    ? html`<${Action} small soft disabled=${ctx.busy === 'sync'} onClick=${() => ctx.syncRemote()}>${ctx.busy === 'sync' ? x('syncing') : x('syncRemote')}<//>`
    : null;
  return html`
    <${PageSection} id="pk-offers" num=${num} title=${x('secOffers')} count=${ctx.data ? x('secOffersSub', { n: offers.length, system: offers.filter((o) => o.system).length }) : null}>
      ${!ctx.data ? loadingRow() : !offers.length ? html`<${Note} kind="quiet">${x('emptyOffers')}<//>` : html`
        <${Filters}>
          ${facet(!F.who && !F.cat, x('facetAll'), offers.length, () => set({ who: '', cat: '' }), 'all')}
          ${facet(F.who === 'system', x('facetSystem'), offers.filter((o) => o.system).length, () => tog('who', 'system'), 'system')}
          ${offers.some((o) => !o.system && !o.remote) ? facet(F.who === 'others', x('facetOthers'), offers.filter((o) => !o.system && !o.remote).length, () => tog('who', 'others'), 'others') : null}
          ${offers.some((o) => o.remote) ? facet(F.who === 'remote', x('facetRemote'), offers.filter((o) => o.remote).length, () => tog('who', 'remote'), 'remote') : null}
          ${cats.map((c) => facet(F.cat === c, categoryWord(c), offers.filter((o) => o.category === c).length, () => tog('cat', c), 'c:' + c))}
        <//>
        <${SearchLine} value=${ctx.query || ''} placeholder=${x('search')} label=${x('search')} onInput=${(e) => ctx.setQuery(e.target.value)} note=${x('searchOrder')} />
        <${List} cols="name-desc-who-doors" head=${[x('colPackage'), x('colDoes'), x('colInstall'), '']} empty=${x('noMatch')}>
          ${shown.map((o) => offerRow(ctx, o))}
        <//>
        <${More} wrap note=${x('shownOf', { shown: shown.length, total: rows.length })}
          label=${x('showMore', { n: Math.min(PAGE, rows.length - shown.length) })}
          onMore=${shown.length < rows.length ? () => ctx.setShown(ctx.shown + PAGE) : null}>${sync}<//>
        <${Hint}>${x('hintOffers')}<//>`}
    <//>`;
}

function secOwn(ctx, own, num) {
  return html`
    <${PageSection} id="pk-own" num=${num} title=${x('secOwn')} count=${ctx.data ? (own.length ? x('secOwnSub', { n: own.length, pub: own.filter((p) => p.visibility === 'public').length }) : x('secNone')) : null}>
      ${!ctx.data ? loadingRow() : html`
        <${List} cols="name-desc-who-doors" head=${[x('colPackage'), x('colDoes'), x('vis.k'), '']} empty=${x('emptyOwn')}>
          ${own.map((p) => ownRow(ctx, p))}
        <//>
        ${own.length ? html`<${Hint}>${x('hintOwn')}<//>` : null}`}
    <//>`;
}

/** How a new package is made: one row (three ways inside it), open while the compose form is. */
function secNew(ctx, num) {
  const open = ctx.compose.open;
  const shown = open || !!ctx.folds.new;
  const toggle = () => { if (shown && open) ctx.closeCompose(); ctx.setFold('new', !shown); };
  return html`
    <${FoldSection} id="pk-new" num=${num} title=${x('secNew')} sub=${x('newSub')} open=${shown} onToggle=${toggle}>
      <${Note} kind="lead">${x('newIntro')}<//>
      <${Roads}>
        <${Road} lead name=${x('roadApps')} text=${x('roadAppsBody')}
          doors=${open ? null : html`<${Action} small onClick=${() => ctx.openCompose()}>${x('pickApps')}<//><${Note} inline>${x('roadAppsSub')}<//>`}>
          ${open ? composeForm(ctx) : null}
        <//>
        <${Road} name=${x('roadAsk')} text=${x('roadAskBody')}
          doors=${html`<${Action} small disabled=${ctx.busy === 'prompt'} onClick=${() => ctx.copyPrompt()}>${x('copyRequest')}<//><${Note} inline>${x('roadAskSub')}<//>`} />
        <${Road} name=${x('roadZip')} text=${x('roadZipBody')}
          doors=${html`<${Action} small disabled=${ctx.busy === 'import'} onClick=${() => ctx.pickZip()}>${ctx.busy === 'import' ? x('importing') : x('pickFile')}<//>`} />
      <//>
    <//>`;
}

/**
 * Pick your own apps and name the package.
 *
 * Each row says what that app loads, because that is what decides whether it travels: a cortex the
 * owner installed is packaged, and a cortex this node ships, a library pack or an extension is named
 * as something the installing node must already have. Saying so here means the answer is not a
 * surprise on the other side.
 */
function composeForm(ctx) {
  const apps = ctx.myApps;
  const picked = ctx.compose.picked;
  const ready = (ctx.compose.name || '').trim().length > 0 && picked.length > 0;

  const needsOf = (a) => {
    const r = a.requires || {};
    const cortex = (r.cortex ?? []).map((c) => c.name);
    const ext = (r.extensions ?? []).map((e) => e.name);
    const packs = (r.packs ?? []).map((p) => p.name);
    return [
      cortex.length ? x('needsCortex', { names: cortex.join(', ') }) : '',
      ext.length ? x('needsExt', { names: ext.join(', ') }) : '',
      packs.length ? x('needsPacks', { names: packs.join(', ') }) : '',
    ].filter(Boolean).join(' · ') || x('needsNothing');
  };

  return html`
    <${TextField} label=${x('composeNameK')} value=${ctx.compose.name} placeholder=${x('composeNamePlaceholder')}
      onInput=${(v) => ctx.setComposeName(v)} />
    <${List} cols="check-name-desc" keepCols scroll loading=${apps === null ? x('loadingApps') : false} empty=${x('noAppsYet')}>
      ${(apps || []).map((a) => html`
        <${Row} key=${a.filename} picked=${picked.includes(a.filename)} onPick=${() => ctx.togglePick(a.filename)}>
          <${Name} meta=${a.filename}>${a.manifest?.name || a.name || a.filename}<//>
          <${Desc}>${needsOf(a)}<//>
        <//>`)}
    <//>
    <${Hint}>${x('composeCarries')}<//>
    <${Actions}>
      <${Action} small disabled=${!ready || ctx.busy === 'compose'} onClick=${() => ctx.doCompose()}>
        ${ctx.busy === 'compose' ? x('composing') : x('composeN', { n: picked.length })}
      <//>
      <${Action} small soft onClick=${() => ctx.closeCompose()}>${x('cancel')}<//>
    <//>`;
}

/** How an agent installs: the rule to copy and the facts, one row until it is opened. */
function secAgent(ctx, num) {
  return html`
    <${FoldSection} id="pk-ai" num=${num} title=${x('secAi')} sub=${x('aiSub')} open=${!!ctx.folds.ai} onToggle=${() => ctx.setFold('ai', !ctx.folds.ai)}>
      <${Note} kind="lead">${x('aiIntro')}<//>
      <${Box} doors=${html`<${Action} small copy=${agentRule(ctx.nodeUrl)} copiedLabel=${x('copied')}>${x('copyRule')}<//>`}>
        <${Label} block>${x('ruleLabel')}<//>
        <${Note} kind="lead">${x('ruleBody')}<//>
      <//>
      <${Facts} wide rows=${[
        { k: x('aiInstallK'), v: x('aiInstallBody'), sub: x('aiInstallSub') },
        { k: x('aiUpdateK'), v: x('aiUpdateBody') },
        { k: x('aiPublishK'), v: x('aiPublishBody') },
      ]} />
    <//>`;
}
