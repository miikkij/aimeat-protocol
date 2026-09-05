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
import { Section, scrollTo } from '/views/profile/organisms/poster-parts.js';
import { x, crumb, pageLinks, agentRule, categoryWord } from './frame.js';
import { instanceRow, offerRow, ownRow, loadingRow } from './rows.js';

const PAGE = 20;
const facet = (on, label, n, onClick, key) => html`<button type="button" key=${key} class=${`pk-facet ${on ? 'is-on' : ''}`} onClick=${onClick}>${label}<em>${n}</em></button>`;
const matches = (q, ...fields) => !q || fields.some((f) => String(f || '').toLowerCase().includes(q));

export function renderPage(ctx) {
  const d = ctx.data;   // null while loading
  const instances = d ? ctx.instances : [];
  const offers = d ? ctx.offers : [];
  const own = d ? ctx.own : [];
  const remote = offers.filter((o) => o.remote);
  const parts = instances.reduce((s, i) => s + (i.installedComponents || []).length, 0);
  const none = d && instances.length === 0;
  const chip = (text, cls = '') => html`<span class=${`og-chip ${cls}`}>${text}</span>`;

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
          <h1 class="og-title">${t('profile.tabs.packages')}<small>${x('titleSub')}</small></h1>
          <div class="og-chips">
            ${d ? chip(none ? x('chipNone') : x('chipInstalled', { n: instances.length }), none ? 'og-chip--coral' : 'og-chip--sun') : null}
            ${d ? chip(x('chipOffers', { n: offers.length })) : null}
            ${d ? chip(x('chipOwn', { n: own.length }), own.length ? '' : 'og-chip--dim') : null}
            ${d ? chip(x('chipRemote', { n: remote.length }), remote.length ? '' : 'og-chip--dim') : null}
          </div>
          <p class="og-desc">${none ? x('descEmpty', { n: offers.length }) : x('desc')}</p>
        </div>
        <div class="og-mast-actions">
          <button type="button" class="og-slab" disabled=${ctx.busy === 'prompt'} onClick=${() => ctx.copyPrompt()}>${x('copyRequest')}</button>
          <div class="og-doors"><button type="button" class="og-door" onClick=${() => ctx.pickZip()}>${x('importZip')}</button></div>
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
    <${Section} id="pk-installed" num="01" title=${x('secInstalled')} count=${ctx.data ? (instances.length ? x('secInstalledSub', { n: instances.length, parts: instances.reduce((s, i) => s + (i.installedComponents || []).length, 0) }) : x('secNone')) : null} first=${true}>
      ${!ctx.data ? loadingRow() : instances.length ? html`
        <div class="pk-pl">
          <div class="pk-p pk-p--head"><div>${x('colPackage')}</div><div>${x('colBrought')}</div><div>${x('colFrom')}</div><div></div></div>
          ${instances.map((i) => instanceRow(ctx, i))}
        </div>
        <p class="pk-hint">${x('hintInstalled')}</p>` : html`<p class="pk-empty"><b>${x('emptyInstalled')}</b> ${x('emptyInstalledSub')}</p>`}
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
    <${Section} id="pk-offers" num="02" title=${x('secOffers')} count=${ctx.data ? x('secOffersSub', { n: offers.length, system: offers.filter((o) => o.system).length }) : null}>
      ${!ctx.data ? loadingRow() : !offers.length ? html`<p class="pk-empty">${x('emptyOffers')}</p>` : html`
        <div class="pk-facets">
          ${facet(!F.who && !F.cat, x('facetAll'), offers.length, () => set({ who: '', cat: '' }), 'all')}
          ${facet(F.who === 'system', x('facetSystem'), offers.filter((o) => o.system).length, () => tog('who', 'system'), 'system')}
          ${offers.some((o) => !o.system && !o.remote) ? facet(F.who === 'others', x('facetOthers'), offers.filter((o) => !o.system && !o.remote).length, () => tog('who', 'others'), 'others') : null}
          ${offers.some((o) => o.remote) ? facet(F.who === 'remote', x('facetRemote'), offers.filter((o) => o.remote).length, () => tog('who', 'remote'), 'remote') : null}
          ${cats.map((c) => facet(F.cat === c, categoryWord(c), offers.filter((o) => o.category === c).length, () => tog('cat', c), 'c:' + c))}
        </div>
        <div class="pk-search"><input class="og-input" type="search" value=${ctx.query || ''} placeholder=${x('search')} aria-label=${x('search')} onInput=${(e) => ctx.setQuery(e.target.value)} /><small>${x('searchOrder')}</small></div>
        ${!rows.length ? html`<p class="pk-empty">${x('noMatch')}</p>` : html`
          <div class="pk-pl">
            <div class="pk-p pk-p--head"><div>${x('colPackage')}</div><div>${x('colDoes')}</div><div>${x('colInstall')}</div><div></div></div>
            ${shown.map((o) => offerRow(ctx, o))}
          </div>`}
        <div class="pk-more">
          ${shown.length < rows.length ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setShown(ctx.shown + PAGE)}>${x('showMore', { n: Math.min(PAGE, rows.length - shown.length) })}</button>` : null}
          <small>${x('shownOf', { shown: shown.length, total: rows.length })}</small>
          ${ctx.isOperator && offers.some((o) => o.remote) ? html`<button type="button" class="og-door og-door--quiet" disabled=${ctx.busy === 'sync'} onClick=${() => ctx.syncRemote()}>${ctx.busy === 'sync' ? x('syncing') : x('syncRemote')}</button>` : null}
        </div>
        <p class="pk-hint">${x('hintOffers')}</p>`}
    <//>`;
}

function secOwn(ctx, own) {
  return html`
    <${Section} id="pk-own" num="03" title=${x('secOwn')} count=${ctx.data ? (own.length ? x('secOwnSub', { n: own.length, pub: own.filter((p) => p.visibility === 'public').length }) : x('secNone')) : null}>
      ${!ctx.data ? loadingRow() : own.length ? html`
        <div class="pk-pl">
          <div class="pk-p pk-p--head"><div>${x('colPackage')}</div><div>${x('colDoes')}</div><div>${x('vis.k')}</div><div></div></div>
          ${own.map((p) => ownRow(ctx, p))}
        </div>
        <p class="pk-hint">${x('hintOwn')}</p>` : html`<p class="pk-empty">${x('emptyOwn')}</p>`}
    <//>`;
}

function secNew(ctx) {
  return html`
    <${Section} id="pk-new" num="04" title=${x('secNew')} count=${null}>
      <p class="pk-para">${x('newIntro')}</p>
      <div class="pk-roads">
        <div class="pk-road pk-road--lead">
          <span class="pk-road-t">${x('roadApps')}</span>
          <p class="pk-para">${x('roadAppsBody')}</p>
          ${ctx.compose.open ? composeForm(ctx) : html`
            <div class="og-doors"><button type="button" class="og-door" onClick=${() => ctx.openCompose()}>${x('pickApps')}</button><span class="pk-hint">${x('roadAppsSub')}</span></div>`}
        </div>
        <div class="pk-road">
          <span class="pk-road-t">${x('roadAsk')}</span>
          <p class="pk-para">${x('roadAskBody')}</p>
          <div class="og-doors"><button type="button" class="og-door" disabled=${ctx.busy === 'prompt'} onClick=${() => ctx.copyPrompt()}>${x('copyRequest')}</button><span class="pk-hint">${x('roadAskSub')}</span></div>
        </div>
        <div class="pk-road">
          <span class="pk-road-t">${x('roadZip')}</span>
          <p class="pk-para">${x('roadZipBody')}</p>
          <div class="og-doors"><button type="button" class="og-door" disabled=${ctx.busy === 'import'} onClick=${() => ctx.pickZip()}>${ctx.busy === 'import' ? x('importing') : x('pickFile')}</button></div>
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
        <span class="og-label">${x('composeNameK')}</span>
        <input type="text" value=${ctx.compose.name} placeholder=${x('composeNamePlaceholder')}
          onInput=${(e) => ctx.setComposeName(e.target.value)} />
      </label>
      ${apps === null ? html`<p class="pk-hint">${x('loadingApps')}</p>`
      : apps.length === 0 ? html`<p class="pk-empty">${x('noAppsYet')}</p>` : html`
        <div class="pk-compose-list">
          ${apps.map((a) => html`
            <label class="pk-compose-app" key=${a.filename}>
              <input type="checkbox" checked=${picked.includes(a.filename)} onChange=${() => ctx.togglePick(a.filename)} />
              <span class="pk-compose-app-nm">${a.manifest?.name || a.name || a.filename}<small>${a.filename}</small></span>
              <small class="pk-compose-app-needs">${needsOf(a)}</small>
            </label>`)}
        </div>`}
      <p class="pk-hint">${x('composeCarries')}</p>
      <div class="og-doors">
        <button type="button" class="og-door" disabled=${!ready || ctx.busy === 'compose'} onClick=${() => ctx.doCompose()}>
          ${ctx.busy === 'compose' ? x('composing') : x('composeN', { n: picked.length })}
        </button>
        <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.closeCompose()}>${x('cancel')}</button>
      </div>
    </div>`;
}

function secAgent(ctx) {
  return html`
    <${Section} id="pk-ai" num="05" title=${x('secAi')} count=${null}>
      <p class="pk-para">${x('aiIntro')}</p>
      <div class="pk-rule">
        <span class="og-label">${x('ruleLabel')}</span>
        <p class="pk-para">${x('ruleBody')}</p>
        <div class="og-doors"><${CopyButton} text=${agentRule(ctx.nodeUrl)} className="og-door" label=${x('copyRule')} copiedLabel=${x('copied')} /></div>
      </div>
      <div class="pk-kv pk-kv--wide">
        <div class="pk-k">${x('aiInstallK')}</div><div class="pk-v">${x('aiInstallBody')}<small>${x('aiInstallSub')}</small></div>
        <div class="pk-k">${x('aiUpdateK')}</div><div class="pk-v">${x('aiUpdateBody')}</div>
        <div class="pk-k">${x('aiPublishK')}</div><div class="pk-v">${x('aiPublishBody')}</div>
      </div>
    <//>`;
}
