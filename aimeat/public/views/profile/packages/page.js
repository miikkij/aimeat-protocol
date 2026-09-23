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
 *   2026-09-22 -- Composed from the shared component set (Page, Rail, Section, NumeralBand, Toolbar,
 *     ListRow, Field, Surface, KeyValue), so the page follows the theme and the parts in one edit;
 *     packages-poster.css is gone.
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
import { Page, Rail, Section, Stack, Columns, NumeralBand, Toolbar, Field, ListRow, Surface, KeyValue,
  Text, Chip, Action, CopyAction } from '/components/poster-parts.js';
import { x, crumb, pageLinks, agentRule, categoryWord } from './frame.js';
import { instanceRow, offerRow, ownRow, loadingRow } from './rows.js';

const PAGE = 20;
const facet = (on, label, n, onClick, id) => ({ id, label: `${label} ${n}`, selected: on, onClick });
const matches = (q, ...fields) => !q || fields.some((f) => String(f || '').toLowerCase().includes(q));
/** The column words over a list of rows, on a row of their own. */
const headRow = (a, b, c) => html`<${ListRow} density="compact" name=${html`<${Text} kind="label">${a} · ${b}<//>`} value=${html`<${Text} kind="label">${c}<//>`} />`;

export function renderPage(ctx) {
  const d = ctx.data;   // null while loading
  const instances = d ? ctx.instances : [];
  const offers = d ? ctx.offers : [];
  const own = d ? ctx.own : [];
  const remote = offers.filter((o) => o.remote);
  const parts = instances.reduce((s, i) => s + (i.installedComponents || []).length, 0);
  const none = d && instances.length === 0;

  const strip = html`<${NumeralBand} tone="plain" size="small" items=${[
    { id: 'inst', label: x('stripInstalled'), value: d ? instances.length : '…', note: d ? (instances.length ? x('stripInstalledSub', { parts, running: instances.filter((i) => i.status === 'installed').length === instances.length ? x('allRunning') : x('someStopped') }) : x('stripInstalledNone')) : '' },
    { id: 'offers', label: x('stripOffers'), value: d ? offers.length : '…', note: d ? x('stripOffersSub', { system: offers.filter((o) => o.system).length, others: offers.filter((o) => !o.system && !o.remote).length }) : '' },
    { id: 'own', label: x('stripOwn'), value: d ? own.length : '…', note: d ? (own.length ? x('stripOwnSub', { pub: own.filter((p) => p.visibility === 'public').length, listed: own.filter((p) => ctx.listingByGroup[p.packageGroupId]).length }) : x('stripOwnNone')) : '' },
    { id: 'remote', label: x('stripRemote'), value: d ? remote.length : '…', note: d ? (remote.length ? x('stripRemoteSub', { n: new Set(remote.map((r) => r.sourceNode)).size }) : x('stripRemoteNone')) : '' },
  ]} />`;

  const identity = html`<${Stack} density="compact"><${Text} tone="muted">${x('titleSub')}<//>${d ? html`<${Stack} direction="wrap" density="compact">
    <${Chip} tone=${none ? 'coral' : 'sun'}>${none ? x('chipNone') : x('chipInstalled', { n: instances.length })}<//>
    <${Chip}>${x('chipOffers', { n: offers.length })}<//>
    <${Chip} tone=${own.length ? 'plain' : 'muted'}>${x('chipOwn', { n: own.length })}<//>
    <${Chip} tone=${remote.length ? 'plain' : 'muted'}>${x('chipRemote', { n: remote.length })}<//>
  <//>` : null}<//>`;

  const rail = html`<${Rail} kind="index" title=${x('railTitle')} entries=${[
    { href: '#pk-installed', label: x('secInstalled'), count: d ? instances.length : undefined },
    { href: '#pk-offers', label: x('secOffers'), count: d ? offers.length : undefined },
    { href: '#pk-own', label: x('secOwn'), count: d ? own.length : undefined },
    { href: '#pk-new', label: x('secNew') },
    { href: '#pk-ai', label: x('secAi') },
  ]}>${pageLinks()}<//>`;

  return html`<${Page} crumbs=${crumb()} title=${t('profile.tabs.packages')} identity=${identity}
    actions=${html`<${Action} kind="primary" disabled=${ctx.busy === 'prompt'} onClick=${() => ctx.copyPrompt()}>${x('copyRequest')}<//>
      <${Action} onClick=${() => ctx.pickZip()}>${x('importZip')}<//>`}
    rail=${rail}>
    <${Stack}>
      <${Text} tone="muted">${none ? x('descEmpty', { n: offers.length }) : x('desc')}<//>
      ${strip}
      ${secInstalled(ctx, instances)}
      ${secOffers(ctx, offers)}
      ${secOwn(ctx, own)}
      ${secNew(ctx)}
      ${secAgent(ctx)}
    <//>
    <input type="file" accept=".zip" hidden ref=${ctx.fileRef} onChange=${(e) => ctx.importZip(e)} />
    <${ctx.ConfirmUI} />
  <//>`;
}

function secInstalled(ctx, instances) {
  return html`
    <${Section} id="pk-installed" title=${x('secInstalled')} count=${ctx.data ? (instances.length ? x('secInstalledSub', { n: instances.length, parts: instances.reduce((s, i) => s + (i.installedComponents || []).length, 0) }) : x('secNone')) : null}>
      ${!ctx.data ? loadingRow() : instances.length ? html`<${Stack}>
        <div>
          ${headRow(x('colPackage'), x('colBrought'), x('colFrom'))}
          ${instances.map((i) => instanceRow(ctx, i))}
        </div>
        <${Text} kind="caption" tone="muted">${x('hintInstalled')}<//>
      <//>` : html`<${Text}><strong>${x('emptyInstalled')}</strong> ${x('emptyInstalledSub')}<//>`}
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
  const filters = [
    facet(!F.who && !F.cat, x('facetAll'), offers.length, () => set({ who: '', cat: '' }), 'all'),
    facet(F.who === 'system', x('facetSystem'), offers.filter((o) => o.system).length, () => tog('who', 'system'), 'system'),
    offers.some((o) => !o.system && !o.remote) ? facet(F.who === 'others', x('facetOthers'), offers.filter((o) => !o.system && !o.remote).length, () => tog('who', 'others'), 'others') : null,
    offers.some((o) => o.remote) ? facet(F.who === 'remote', x('facetRemote'), offers.filter((o) => o.remote).length, () => tog('who', 'remote'), 'remote') : null,
    ...cats.map((c) => facet(F.cat === c, categoryWord(c), offers.filter((o) => o.category === c).length, () => tog('cat', c), 'c:' + c)),
  ].filter(Boolean);
  return html`
    <${Section} id="pk-offers" title=${x('secOffers')} count=${ctx.data ? x('secOffersSub', { n: offers.length, system: offers.filter((o) => o.system).length }) : null}>
      ${!ctx.data ? loadingRow() : !offers.length ? html`<${Text} tone="muted">${x('emptyOffers')}<//>` : html`<${Stack}>
        <${Toolbar} filters=${filters} />
        <${Stack} density="compact">
          <${Field} type="search" value=${ctx.query || ''} placeholder=${x('search')} ariaLabel=${x('search')} onInput=${(e) => ctx.setQuery(e.target.value)} />
          <${Text} kind="caption" tone="muted">${x('searchOrder')}<//>
        <//>
        ${!rows.length ? html`<${Text} tone="muted">${x('noMatch')}<//>` : html`
          <div>
            ${headRow(x('colPackage'), x('colDoes'), x('colInstall'))}
            ${shown.map((o) => offerRow(ctx, o))}
          </div>`}
        <${Stack} direction="wrap" align="center">
          ${shown.length < rows.length ? html`<${Action} onClick=${() => ctx.setShown(ctx.shown + PAGE)}>${x('showMore', { n: Math.min(PAGE, rows.length - shown.length) })}<//>` : null}
          <${Text} kind="caption" tone="muted">${x('shownOf', { shown: shown.length, total: rows.length })}<//>
          ${ctx.isOperator && offers.some((o) => o.remote) ? html`<${Action} disabled=${ctx.busy === 'sync'} onClick=${() => ctx.syncRemote()}>${ctx.busy === 'sync' ? x('syncing') : x('syncRemote')}<//>` : null}
        <//>
        <${Text} kind="caption" tone="muted">${x('hintOffers')}<//>
      <//>`}
    <//>`;
}

function secOwn(ctx, own) {
  return html`
    <${Section} id="pk-own" title=${x('secOwn')} count=${ctx.data ? (own.length ? x('secOwnSub', { n: own.length, pub: own.filter((p) => p.visibility === 'public').length }) : x('secNone')) : null}>
      ${!ctx.data ? loadingRow() : own.length ? html`<${Stack}>
        <div>
          ${headRow(x('colPackage'), x('colDoes'), x('vis.k'))}
          ${own.map((p) => ownRow(ctx, p))}
        </div>
        <${Text} kind="caption" tone="muted">${x('hintOwn')}<//>
      <//>` : html`<${Text} tone="muted">${x('emptyOwn')}<//>`}
    <//>`;
}

function secNew(ctx) {
  const road = (title, body, children) => html`<${Stack}>
    <${Text} kind="heading" size="small">${title}<//>
    <${Text}>${body}<//>
    ${children}
  <//>`;
  return html`
    <${Section} id="pk-new" title=${x('secNew')} description=${x('newIntro')}>
      <${Stack}>
        <${Surface} kind="box">${road(x('roadApps'), x('roadAppsBody'), ctx.compose.open ? composeForm(ctx) : html`
          <${Stack} direction="wrap" align="center"><${Action} onClick=${() => ctx.openCompose()}>${x('pickApps')}<//><${Text} kind="caption" tone="muted">${x('roadAppsSub')}<//><//>`)}<//>
        <${Columns} collapse="640" density="roomy">
          ${road(x('roadAsk'), x('roadAskBody'), html`<${Stack} direction="wrap" align="center"><${Action} disabled=${ctx.busy === 'prompt'} onClick=${() => ctx.copyPrompt()}>${x('copyRequest')}<//><${Text} kind="caption" tone="muted">${x('roadAskSub')}<//><//>`)}
          ${road(x('roadZip'), x('roadZipBody'), html`<div><${Action} disabled=${ctx.busy === 'import'} onClick=${() => ctx.pickZip()}>${ctx.busy === 'import' ? x('importing') : x('pickFile')}<//></div>`)}
        <//>
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
    <${Stack}>
      <${Field} label=${x('composeNameK')} value=${ctx.compose.name} placeholder=${x('composeNamePlaceholder')}
        onInput=${(e) => ctx.setComposeName(e.target.value)} />
      ${apps === null ? html`<${Text} kind="caption" tone="muted">${x('loadingApps')}<//>`
      : apps.length === 0 ? html`<${Text} tone="muted">${x('noAppsYet')}<//>` : html`
        <${Columns} collapse="640" density="compact">
          ${apps.map((a) => html`
            <${Action} key=${a.filename} kind="choice" semantics="switch" title=${a.manifest?.name || a.name || a.filename}
              selected=${picked.includes(a.filename)} onClick=${() => ctx.togglePick(a.filename)}>
              ${a.filename} · ${needsOf(a)}
            <//>`)}
        <//>`}
      <${Text} kind="caption" tone="muted">${x('composeCarries')}<//>
      <${Stack} direction="wrap" align="center">
        <${Action} disabled=${!ready || ctx.busy === 'compose'} onClick=${() => ctx.doCompose()}>
          ${ctx.busy === 'compose' ? x('composing') : x('composeN', { n: picked.length })}
        <//>
        <${Action} onClick=${() => ctx.closeCompose()}>${x('cancel')}<//>
      <//>
    <//>`;
}

function secAgent(ctx) {
  return html`
    <${Section} id="pk-ai" title=${x('secAi')} description=${x('aiIntro')}>
      <${Stack}>
        <${Surface} kind="box">
          <${Stack}>
            <${Text} kind="label">${x('ruleLabel')}<//>
            <${Text}>${x('ruleBody')}<//>
            <div><${CopyAction} text=${agentRule(ctx.nodeUrl)} label=${x('copyRule')} copiedLabel=${x('copied')} /></div>
          <//>
        <//>
        <div>
          <${KeyValue} label=${x('aiInstallK')}><${Stack} density="compact"><span>${x('aiInstallBody')}</span><${Text} kind="caption" tone="muted">${x('aiInstallSub')}<//><//><//>
          <${KeyValue} label=${x('aiUpdateK')} value=${x('aiUpdateBody')} />
          <${KeyValue} label=${x('aiPublishK')} value=${x('aiPublishBody')} />
        </div>
      <//>
    <//>`;
}
