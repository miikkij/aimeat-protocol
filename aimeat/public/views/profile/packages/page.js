/**
 * @file public/views/profile/packages/page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Packages page in the poster face: ready-made wholes that install as the owner's
 *   own. The mast and the strip; installed packages first, then what is on offer (template listings
 *   and public packages joined, with facets and a search), then the owner's own publications; the two
 *   roads to a new package (ask your AI with the package-builder request, or import a zip); and the
 *   section that says how an agent installs. What opens under a row is rows.js. Pure render over the
 *   ctx bag.
 * @structure renderPage · secInstalled · secOffers · secOwn · secNew · composeForm · secAgent
 * @usage import { renderPage } from './packages/page.js';
 * @version-history
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
import { SettingsPage } from '/components/SettingsPage.js';
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

export function renderPage(ctx) {
  const d = ctx.data;   // null while loading
  const instances = d ? ctx.instances : [];
  const offers = d ? ctx.offers : [];
  const own = d ? ctx.own : [];
  const remote = offers.filter((o) => o.remote);
  const parts = instances.reduce((s, i) => s + (i.installedComponents || []).length, 0);
  const none = d && instances.length === 0;

  const strip = html`<${FigureStrip} items=${[
    { n: d ? instances.length : '…', label: x('stripInstalled'), sub: d ? (instances.length ? x('stripInstalledSub', { parts, running: instances.filter((i) => i.status === 'installed').length === instances.length ? x('allRunning') : x('someStopped') }) : x('stripInstalledNone')) : '' },
    { n: d ? offers.length : '…', label: x('stripOffers'), sub: d ? x('stripOffersSub', { system: offers.filter((o) => o.system).length, others: offers.filter((o) => !o.system && !o.remote).length }) : '' },
    { n: d ? own.length : '…', label: x('stripOwn'), sub: d ? (own.length ? x('stripOwnSub', { pub: own.filter((p) => p.visibility === 'public').length, listed: own.filter((p) => ctx.listingByGroup[p.packageGroupId]).length }) : x('stripOwnNone')) : '' },
    { n: d ? remote.length : '…', label: x('stripRemote'), sub: d ? (remote.length ? x('stripRemoteSub', { n: new Set(remote.map((r) => r.sourceNode)).size }) : x('stripRemoteNone')) : '' },
  ]} />`;

  // A tag that counts nothing yet is dim, as main drew it (og-chip--dim).
  const marks = d ? [
    { label: none ? x('chipNone') : x('chipInstalled', { n: instances.length }), tone: none ? 'coral' : 'sun' },
    { label: x('chipOffers', { n: offers.length }) },
    { label: x('chipOwn', { n: own.length }), tone: own.length ? undefined : 'dim' },
    { label: x('chipRemote', { n: remote.length }), tone: remote.length ? undefined : 'dim' },
  ] : [];
  const actions = html`
    <${Loud} control disabled=${ctx.busy === 'prompt'} onClick=${() => ctx.copyPrompt()}>${x('copyRequest')}<//>
    <${Actions}><${Action} small onClick=${() => ctx.pickZip()}>${x('importZip')}<//><//>`;
  const sections = [
    { id: 'pk-installed', num: '01', label: x('secInstalled'), count: d ? instances.length : '' },
    { id: 'pk-offers', num: '02', label: x('secOffers'), count: d ? offers.length : '' },
    { id: 'pk-own', num: '03', label: x('secOwn'), count: d ? own.length : '' },
    { id: 'pk-new', num: '04', label: x('secNew'), count: '' },
    { id: 'pk-ai', num: '05', label: x('secAi'), count: '' },
  ];
  // The zip field is hidden; the mast's door and the third road open it (ctx.pickZip).
  const after = html`
    <${FileDrop} hidden accept=".zip" inputRef=${ctx.fileRef} onChange=${(e) => ctx.importZip(e)} />
    <${ctx.ConfirmUI} />`;

  return html`
    <${SettingsPage} name="packages" crumb=${crumb()} title=${t('profile.tabs.packages')} sub=${x('titleSub')} marks=${marks}
      desc=${none ? x('descEmpty', { n: offers.length }) : x('desc')} actions=${actions} strip=${strip}
      railTitle=${x('railTitle')} sections=${sections} pagesLabel=${x('pages')} pages=${pageLinks()}
      after=${after}>
      ${secInstalled(ctx, instances)}
      ${secOffers(ctx, offers)}
      ${secOwn(ctx, own)}
      ${secNew(ctx)}
      ${secAgent(ctx)}
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

function secOffers(ctx, offers) {
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
  // Only an operator syncs the other nodes' listings, and only when there are any.
  const sync = ctx.isOperator && offers.some((o) => o.remote)
    ? html`<${Action} small soft disabled=${ctx.busy === 'sync'} onClick=${() => ctx.syncRemote()}>${ctx.busy === 'sync' ? x('syncing') : x('syncRemote')}<//>`
    : null;
  return html`
    <${PageSection} id="pk-offers" num="02" title=${x('secOffers')} count=${ctx.data ? x('secOffersSub', { n: offers.length, system: offers.filter((o) => o.system).length }) : null}>
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

function secOwn(ctx, own) {
  return html`
    <${PageSection} id="pk-own" num="03" title=${x('secOwn')} count=${ctx.data ? (own.length ? x('secOwnSub', { n: own.length, pub: own.filter((p) => p.visibility === 'public').length }) : x('secNone')) : null}>
      ${!ctx.data ? loadingRow() : html`
        <${List} cols="name-desc-who-doors" head=${[x('colPackage'), x('colDoes'), x('vis.k'), '']} empty=${x('emptyOwn')}>
          ${own.map((p) => ownRow(ctx, p))}
        <//>
        ${own.length ? html`<${Hint}>${x('hintOwn')}<//>` : null}`}
    <//>`;
}

function secNew(ctx) {
  const open = ctx.compose.open;
  return html`
    <${PageSection} id="pk-new" num="04" title=${x('secNew')} count=${null}>
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

function secAgent(ctx) {
  return html`
    <${PageSection} id="pk-ai" num="05" title=${x('secAi')} count=${null}>
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
