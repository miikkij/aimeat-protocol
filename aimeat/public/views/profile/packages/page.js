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
 * @structure renderPage · secInstalled · secOffers · secOwn · secNew · secAgent
 * @usage import { renderPage } from './packages/page.js';
 * @version-history
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
import { CopyButton } from '/components/CopyButton.js';
import { PageSection } from '/components/PageSection.js';
import { scrollTo } from '/views/profile/organisms/poster-parts.js';
import { x, crumb, pageLinks, agentRule, categoryWord } from './frame.js';
import { instanceRow, offerRow, ownRow, loadingRow } from './rows.js';
import { Hint } from '/components/Hint.js';

const PAGE = 20;
const facet = (on, label, n, onClick, key) => html`<button type="button" key=${key} class=${`poster-tab poster-tab--filter ${on ? 'is-on' : ''}`} onClick=${onClick}>${label}<span class="poster-count poster-count--tally">${n}</span></button>`;
const matches = (q, ...fields) => !q || fields.some((f) => String(f || '').toLowerCase().includes(q));

export function renderPage(ctx) {
  const d = ctx.data;   // null while loading
  const instances = d ? ctx.instances : [];
  const offers = d ? ctx.offers : [];
  const own = d ? ctx.own : [];
  const remote = offers.filter((o) => o.remote);
  const parts = instances.reduce((s, i) => s + (i.installedComponents || []).length, 0);
  const none = d && instances.length === 0;
  const chip = (text, cls = '') => html`<span class=${`poster-chip ${cls}`}>${text}</span>`;

  const strip = html`
    <div class="og-strip">
      <div><b>${d ? instances.length : '…'}</b><span>${x('stripInstalled')}</span><small>${d ? (instances.length ? x('stripInstalledSub', { parts, running: instances.filter((i) => i.status === 'installed').length === instances.length ? x('allRunning') : x('someStopped') }) : x('stripInstalledNone')) : ''}</small></div>
      <div><b>${d ? offers.length : '…'}</b><span>${x('stripOffers')}</span><small>${d ? x('stripOffersSub', { system: offers.filter((o) => o.system).length, others: offers.filter((o) => !o.system && !o.remote).length }) : ''}</small></div>
      <div><b>${d ? own.length : '…'}</b><span>${x('stripOwn')}</span><small>${d ? (own.length ? x('stripOwnSub', { pub: own.filter((p) => p.visibility === 'public').length, listed: own.filter((p) => ctx.listingByGroup[p.packageGroupId]).length }) : x('stripOwnNone')) : ''}</small></div>
      <div><b>${d ? remote.length : '…'}</b><span>${x('stripRemote')}</span><small>${d ? (remote.length ? x('stripRemoteSub', { n: new Set(remote.map((r) => r.sourceNode)).size }) : x('stripRemoteNone')) : ''}</small></div>
    </div>`;

  return html`
    <div class="og og-packages">
      ${crumb()}
      <div class="og-mast">
        <div class="og-mast-words">
          <h1 class="og-title poster-page-title">${t('profile.tabs.packages')}<small>${x('titleSub')}</small></h1>
          <div class="poster-chips">
            ${d ? chip(none ? x('chipNone') : x('chipInstalled', { n: instances.length }), none ? 'poster-chip--coral' : 'poster-chip--sun') : null}
            ${d ? chip(x('chipOffers', { n: offers.length })) : null}
            ${d ? chip(x('chipOwn', { n: own.length })) : null}
            ${d ? chip(x('chipRemote', { n: remote.length })) : null}
          </div>
          <p class="og-desc">${none ? x('descEmpty', { n: offers.length }) : x('desc')}</p>
        </div>
        <div class="og-mast-actions">
          <button type="button" class="poster-slab poster-slab--control" disabled=${ctx.busy === 'prompt'} onClick=${() => ctx.copyPrompt()}>${x('copyRequest')}</button>
          <div class="og-doors"><button type="button" class="poster-action poster-action--small" onClick=${() => ctx.pickZip()}>${x('importZip')}</button></div>
        </div>
      </div>
      ${strip}
      <div class="og-grid">
        <div class="og-main">
          ${secInstalled(ctx, instances)}
          ${secOffers(ctx, offers)}
          ${secOwn(ctx, own)}
          ${secNew(ctx)}
          ${secAgent(ctx)}
        </div>
        <nav class="og-rail" aria-label=${x('railTitle')}>
          <span class="og-rail-label">${x('railTitle')}</span>
          ${[['01', 'pk-installed', x('secInstalled'), d ? instances.length : ''], ['02', 'pk-offers', x('secOffers'), d ? offers.length : ''], ['03', 'pk-own', x('secOwn'), d ? own.length : ''], ['04', 'pk-new', x('secNew'), ''], ['05', 'pk-ai', x('secAi'), '']].map(([n, id, label, count]) => html`<button type="button" class="og-rail-link" key=${id} onClick=${() => scrollTo(id)}><i>${n}</i>${label}<em>${count}</em></button>`)}
          <hr />
          <span class="og-rail-label">${x('pages')}</span>
          ${pageLinks()}
        </nav>
      </div>
      <input type="file" accept=".zip" class="pk-file" ref=${ctx.fileRef} onChange=${(e) => ctx.importZip(e)} />
      <${ctx.ConfirmUI} />
    </div>`;
}

function secInstalled(ctx, instances) {
  return html`
    <${PageSection} id="pk-installed" num="01" title=${x('secInstalled')} count=${ctx.data ? (instances.length ? x('secInstalledSub', { n: instances.length, parts: instances.reduce((s, i) => s + (i.installedComponents || []).length, 0) }) : x('secNone')) : null} first=${true}>
      ${!ctx.data ? loadingRow() : instances.length ? html`
        <div class="listing listing--name-desc-who-doors">
          <div class="listing-row listing-row--head"><div class="poster-label">${x('colPackage')}</div><div class="poster-label">${x('colBrought')}</div><div class="poster-label">${x('colFrom')}</div><div class="poster-label"></div></div>
          ${instances.map((i) => instanceRow(ctx, i))}
        </div>
        <${Hint}>${x('hintInstalled')}<//>` : html`<p class="poster-quiet pk-empty"><b>${x('emptyInstalled')}</b> ${x('emptyInstalledSub')}</p>`}
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
  return html`
    <${PageSection} id="pk-offers" num="02" title=${x('secOffers')} count=${ctx.data ? x('secOffersSub', { n: offers.length, system: offers.filter((o) => o.system).length }) : null}>
      ${!ctx.data ? loadingRow() : !offers.length ? html`<p class="poster-quiet pk-empty">${x('emptyOffers')}</p>` : html`
        <div class="pk-facets">
          ${facet(!F.who && !F.cat, x('facetAll'), offers.length, () => set({ who: '', cat: '' }), 'all')}
          ${facet(F.who === 'system', x('facetSystem'), offers.filter((o) => o.system).length, () => tog('who', 'system'), 'system')}
          ${offers.some((o) => !o.system && !o.remote) ? facet(F.who === 'others', x('facetOthers'), offers.filter((o) => !o.system && !o.remote).length, () => tog('who', 'others'), 'others') : null}
          ${offers.some((o) => o.remote) ? facet(F.who === 'remote', x('facetRemote'), offers.filter((o) => o.remote).length, () => tog('who', 'remote'), 'remote') : null}
          ${cats.map((c) => facet(F.cat === c, categoryWord(c), offers.filter((o) => o.category === c).length, () => tog('cat', c), 'c:' + c))}
        </div>
        <div class="search-line"><input class="og-input" type="search" value=${ctx.query || ''} placeholder=${x('search')} aria-label=${x('search')} onInput=${(e) => ctx.setQuery(e.target.value)} /><small>${x('searchOrder')}</small></div>
        ${!rows.length ? html`<p class="poster-quiet pk-empty">${x('noMatch')}</p>` : html`
          <div class="listing listing--name-desc-who-doors">
            <div class="listing-row listing-row--head"><div class="poster-label">${x('colPackage')}</div><div class="poster-label">${x('colDoes')}</div><div class="poster-label">${x('colInstall')}</div><div class="poster-label"></div></div>
            ${shown.map((o) => offerRow(ctx, o))}
          </div>`}
        <div class="more-line pk-more">
          ${shown.length < rows.length ? html`<button type="button" class="poster-action poster-action--more" onClick=${() => ctx.setShown(ctx.shown + PAGE)}>${x('showMore', { n: Math.min(PAGE, rows.length - shown.length) })}</button>` : null}
          <small>${x('shownOf', { shown: shown.length, total: rows.length })}</small>
          ${ctx.isOperator && offers.some((o) => o.remote) ? html`<button type="button" class="poster-action poster-action--small poster-action--lower" disabled=${ctx.busy === 'sync'} onClick=${() => ctx.syncRemote()}>${ctx.busy === 'sync' ? x('syncing') : x('syncRemote')}</button>` : null}
        </div>
        <${Hint}>${x('hintOffers')}<//>`}
    <//>`;
}

function secOwn(ctx, own) {
  return html`
    <${PageSection} id="pk-own" num="03" title=${x('secOwn')} count=${ctx.data ? (own.length ? x('secOwnSub', { n: own.length, pub: own.filter((p) => p.visibility === 'public').length }) : x('secNone')) : null}>
      ${!ctx.data ? loadingRow() : own.length ? html`
        <div class="listing listing--name-desc-who-doors">
          <div class="listing-row listing-row--head"><div class="poster-label">${x('colPackage')}</div><div class="poster-label">${x('colDoes')}</div><div class="poster-label">${x('vis.k')}</div><div class="poster-label"></div></div>
          ${own.map((p) => ownRow(ctx, p))}
        </div>
        <${Hint}>${x('hintOwn')}<//>` : html`<p class="poster-quiet pk-empty">${x('emptyOwn')}</p>`}
    <//>`;
}

function secNew(ctx) {
  return html`
    <${PageSection} id="pk-new" num="04" title=${x('secNew')} count=${null}>
      <p class="og-lead">${x('newIntro')}</p>
      <div class="pk-roads">
        <div class="pk-road poster-box poster-box--raised">
          <span class="pk-road-t">${x('roadApps')}</span>
          <p class="og-lead">${x('roadAppsBody')}</p>
          ${ctx.compose.open ? composeForm(ctx) : html`
            <div class="og-doors"><button type="button" class="poster-action poster-action--small" onClick=${() => ctx.openCompose()}>${x('pickApps')}</button><span class="poster-hint">${x('roadAppsSub')}</span></div>`}
        </div>
        <div class="pk-road poster-box">
          <span class="pk-road-t">${x('roadAsk')}</span>
          <p class="og-lead">${x('roadAskBody')}</p>
          <div class="og-doors"><button type="button" class="poster-action poster-action--small" disabled=${ctx.busy === 'prompt'} onClick=${() => ctx.copyPrompt()}>${x('copyRequest')}</button><span class="poster-hint">${x('roadAskSub')}</span></div>
        </div>
        <div class="pk-road poster-box">
          <span class="pk-road-t">${x('roadZip')}</span>
          <p class="og-lead">${x('roadZipBody')}</p>
          <div class="og-doors"><button type="button" class="poster-action poster-action--small" disabled=${ctx.busy === 'import'} onClick=${() => ctx.pickZip()}>${ctx.busy === 'import' ? x('importing') : x('pickFile')}</button></div>
        </div>
      </div>
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
    <div class="pk-compose">
      <label class="pk-compose-name">
        <span class="poster-label">${x('composeNameK')}</span>
        <input class="og-input" type="text" value=${ctx.compose.name} placeholder=${x('composeNamePlaceholder')}
          onInput=${(e) => ctx.setComposeName(e.target.value)} />
      </label>
      ${apps === null ? html`<p class="poster-quiet pk-empty loading-mark">${x('loadingApps')}</p>`
      : apps.length === 0 ? html`<p class="poster-quiet pk-empty">${x('noAppsYet')}</p>` : html`
        <div class="pk-compose-list">
          ${apps.map((a) => html`
            <label class="pk-compose-app" key=${a.filename}>
              <input type="checkbox" checked=${picked.includes(a.filename)} onChange=${() => ctx.togglePick(a.filename)} />
              <span class="pk-compose-app-nm">${a.manifest?.name || a.name || a.filename}<small>${a.filename}</small></span>
              <small class="pk-compose-app-needs">${needsOf(a)}</small>
            </label>`)}
        </div>`}
      <${Hint}>${x('composeCarries')}<//>
      <div class="og-doors">
        <button type="button" class="poster-action poster-action--small" disabled=${!ready || ctx.busy === 'compose'} onClick=${() => ctx.doCompose()}>
          ${ctx.busy === 'compose' ? x('composing') : x('composeN', { n: picked.length })}
        </button>
        <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.closeCompose()}>${x('cancel')}</button>
      </div>
    </div>`;
}

function secAgent(ctx) {
  return html`
    <${PageSection} id="pk-ai" num="05" title=${x('secAi')} count=${null}>
      <p class="og-lead">${x('aiIntro')}</p>
      <div class="pk-rule poster-box">
        <span class="poster-label">${x('ruleLabel')}</span>
        <p class="og-lead">${x('ruleBody')}</p>
        <div class="og-doors"><${CopyButton} text=${agentRule(ctx.nodeUrl)} className="poster-action poster-action--small" label=${x('copyRule')} copiedLabel=${x('copied')} /></div>
      </div>
      <div class="facts facts--wide">
        <div class="facts-k poster-label">${x('aiInstallK')}</div><div class="facts-v">${x('aiInstallBody')}<small>${x('aiInstallSub')}</small></div>
        <div class="facts-k poster-label">${x('aiUpdateK')}</div><div class="facts-v">${x('aiUpdateBody')}</div>
        <div class="facts-k poster-label">${x('aiPublishK')}</div><div class="facts-v">${x('aiPublishBody')}</div>
      </div>
    <//>`;
}
