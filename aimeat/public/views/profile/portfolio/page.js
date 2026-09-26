/**
 * @file public/views/profile/portfolio/page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Portfolio page in the poster face: the person's own page at their address. The
 *   mast and the strip say whether it is public and since when; then where it is (the two
 *   addresses), who can see it (the two switches and the member showcase, in words), the page
 *   itself (title, preview, who wrote it, size, where it is stored), the three ways to change it
 *   (ask your AI, the builder, bring a finished HTML) and the rule an agent gets. With no page yet
 *   the first section is the three roads to one, and a page taken off the web keeps its preview and
 *   the way back. Pure render over the ctx bag.
 * @structure renderPage · mast · strip · secAddresses · secVisibility · secPage · secChange ·
 *   secFirst · secAgent
 * @usage import { renderPage } from './portfolio/page.js';
 * @version-history
 *   v1.17.0 -- 2026-09-26 -- The requests to paste are the Code block (css/components/code-block.css), a unification: Jouni's decision "Code block".
 *   v1.16.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.15.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.14.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.13.0 -- 2026-09-25 -- The addresses, who can see the page, the page's facts and what an AI may do are the Facts (css/components/facts.css), a unification: the look most tabs use; a row's doors sit at the end of its value.
 *   v1.12.0 -- 2026-09-25 -- A framed box around one thing is the Object box (.poster-box; on a grey ground its copy tone), in the tone its look already was (Jouni's decision "Object box", a unification).
 *   v1.11.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.10.0 -- 2026-09-25 -- Code inside a sentence or a value line is the code-inline cut of the Code block (UI consolidation phase 5, a unification).
 *   v1.9.0 -- 2026-09-25 -- A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v1.8.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.7.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.6.0 -- 2026-09-25 -- A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.5.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.4.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   v1.3.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.2.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.1.0 -- 2026-09-13 -- V2: select the shared ink frame for the agent rule.
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { PageSection } from '/components/PageSection.js';
import { scrollTo } from '/views/profile/organisms/poster-parts.js';
import { x, apexUrl, dateWord, timeWord, writtenBy, crumb, pageLinks } from './frame.js';
import { Hint } from '/components/Hint.js';

const chip = (text, cls = '') => html`<span class=${`poster-chip ${cls}`}>${text}</span>`;
const copyDoor = (text, label, onCopied) => html`<${CopyButton} text=${text} label=${label} copiedLabel=${t('common.copied')} className="poster-action poster-action--small" onCopied=${onCopied} />`;

export function renderPage(ctx) {
  const d = ctx.data;            // null while loading
  const cfg = d?.config || null;
  const hasPage = !!d?.html;     // a stored file, published or not
  const isOn = hasPage && !!cfg?.enabled;
  const state = !d ? 'loading' : !hasPage ? 'none' : isOn ? 'on' : 'off';
  const rail = state === 'none'
    ? [['01', 'pf-first', x('secFirst'), ''], ['05', 'pf-ai', x('secAi'), '']]
    : state === 'off'
      ? [['02', 'pf-visibility', x('secVisibility'), ''], ['03', 'pf-page', x('secPage'), d?.html ? x('kb', { n: d.html.size_kb }) : ''], ['04', 'pf-change', x('secChange'), ''], ['05', 'pf-ai', x('secAi'), '']]
      : [['01', 'pf-addresses', x('secAddresses'), ctx.standaloneUrl ? '2' : '1'], ['02', 'pf-visibility', x('secVisibility'), ''], ['03', 'pf-page', x('secPage'), d?.html ? x('kb', { n: d.html.size_kb }) : ''], ['04', 'pf-change', x('secChange'), ''], ['05', 'pf-ai', x('secAi'), '']];

  return html`
    <div class="og og-portfolio">
      ${crumb()}
      ${mast(ctx, state)}
      ${strip(ctx, state)}
      <div class="og-grid">
        <div class="og-main">
          ${state === 'loading' ? html`<p class="poster-quiet pf-empty loading-mark">${x('loading')}</p>` : null}
          ${state === 'none' ? secFirst(ctx) : null}
          ${state === 'on' ? secAddresses(ctx) : null}
          ${state === 'on' || state === 'off' ? secVisibility(ctx, state) : null}
          ${state === 'on' || state === 'off' ? secPage(ctx, state) : null}
          ${state === 'on' || state === 'off' ? secChange(ctx) : null}
          ${state !== 'loading' ? secAgent(ctx, state) : null}
        </div>
        <nav class="og-rail" aria-label=${x('railTitle')}>
          <span class="og-rail-label">${x('railTitle')}</span>
          ${rail.map(([n, id, label, count]) => html`<button type="button" class="og-rail-link" key=${id} onClick=${() => scrollTo(id)}><i>${n}</i>${label}<em>${count}</em></button>`)}
          <hr />
          <span class="og-rail-label">${x('pages')}</span>
          ${pageLinks(ctx.navigate)}
        </nav>
      </div>
      <input type="file" accept=".html,.htm,text/html" class="pf-file" ref=${ctx.fileRef} onChange=${(e) => ctx.readFile(e)} />
      <${ctx.ConfirmUI} />
    </div>`;
}

function mast(ctx, state) {
  const d = ctx.data;
  const cfg = d?.config;
  const others = Math.max(0, (ctx.members ?? 0) - (state === 'on' ? 1 : 0));
  const chips = state === 'on'
    ? [chip(x('chipPublic'), 'poster-chip--sun'), cfg?.seoIndex ? chip(x('chipSearch')) : chip(x('chipNoSearch')), chip(x('chipShowcase')), chip(`${x('kb', { n: d.html.size_kb })} · ${dateWord(d.html.stored_at)}`)]
    : state === 'off'
      ? [chip(x('chipOff'), 'poster-chip--coral'), chip(x('chipStored', { n: d.html.size_kb })), cfg?.seoIndex ? chip(x('chipSearchAllowed')) : null]
      : state === 'none'
        ? [chip(x('chipNone'), 'poster-chip--coral'), ctx.members != null ? chip(x('chipOthers', { n: others })) : null]
        : [];
  const desc = state === 'on' ? x('desc') : state === 'off' ? x('descOff', { date: dateWord(cfg?.updatedAt || cfg?.unpublishedAt) || dateWord(d?.html?.stored_at) }) : state === 'none' ? x('descNone') : '';
  return html`
    <div class="og-mast">
      <div class="og-mast-words">
        <h1 class="og-title poster-page-title">${t('portfolio.tabLabel')}<small>${x('titleSub')}</small></h1>
        <div class="poster-chips">${chips}</div>
        <p class="og-desc">${desc}</p>
      </div>
      <div class="og-mast-actions">
        ${state === 'off'
          ? html`<button type="button" class="poster-slab poster-slab--control" disabled=${ctx.busy === 'enable'} onClick=${() => ctx.setEnabled(true)}>${x('republish')}</button>`
          : state === 'none'
            ? html`<button type="button" class="poster-slab poster-slab--control" disabled=${ctx.busy === 'mat'} onClick=${() => ctx.copyMatPrompt()}>${x('makeMat')}</button>`
            : html`<button type="button" class="poster-slab" onClick=${() => ctx.copyAiRequest()}>${x('askAi')}</button>`}
        <div class="og-doors">
          ${state === 'on' ? html`<a class="poster-action poster-action--small" href=${apexUrl(ctx.ownerName)} target="_blank" rel="noopener">${x('openPage')}</a>` : null}
          <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.navigate('/v1/portfolio')}>${x('builder')}</button>
        </div>
      </div>
    </div>`;
}

function strip(ctx, state) {
  const d = ctx.data;
  const cfg = d?.config;
  const m = ctx.members;
  const others = m == null ? null : Math.max(0, m - (state === 'on' ? 1 : 0));
  if (state === 'loading') return html`<div class="og-strip"><div><b>…</b></div><div><b>…</b></div><div><b>…</b></div><div><b>…</b></div></div>`;
  if (state === 'none') {
    return html`
      <div class="og-strip">
        <div><b>0</b><span>${x('stripPages')}</span><small>${x('stripPagesNone')}</small></div>
        <div><b>${m ?? '…'}</b><span>${x('stripShowcase')}</span><small>${x('stripShowcaseNone')}</small></div>
        <div><b>${ctx.standaloneUrl ? 2 : 1}</b><span>${x('stripAddressesReady')}</span><small>${ctx.standaloneUrl ? x('stripAddressesSub') : x('stripAddressOne')}</small></div>
        <div><b>3</b><span>${x('stripRoads')}</span><small>${x('stripRoadsSub')}</small></div>
      </div>`;
  }
  if (state === 'off') {
    return html`
      <div class="og-strip">
        <div><b class="og-strip-coral">${x('stripOff')}</b><span>${x('stripOffLabel')}</span><small>${x('stripOffSub')}</small></div>
        <div><b>${dateWord(d.html.stored_at)}</b><span>${x('stripPublished')}</span><small>${x('kb', { n: d.html.size_kb })}${cfg?.designStyle ? ` · ${x('style.' + cfg.designStyle) || cfg.designStyle}` : ''}</small></div>
        <div><b>${others ?? '…'}</b><span>${x('stripShowcase')}</span><small>${x('stripShowcaseOff')}</small></div>
        <div><b>${ctx.standaloneUrl ? 2 : 1}</b><span>${x('stripAddresses')}</span><small>${x('stripAddressesOff')}</small></div>
      </div>`;
  }
  return html`
    <div class="og-strip">
      <div><b>${dateWord(d.html.stored_at)}</b><span>${x('stripPublished')}</span><small>${[timeWord(d.html.stored_at), x('kb', { n: d.html.size_kb }), cfg?.designStyle ? x('style.' + cfg.designStyle) : ''].filter(Boolean).join(' · ')}</small></div>
      <div><b class="og-strip-coral">${x('stripPublic')}</b><span>${x('stripPublicLabel')}</span><small>${cfg?.seoIndex ? x('stripSearchOn') : x('stripSearchOff')}</small></div>
      <div><b>${m ?? '…'}</b><span>${x('stripShowcase')}</span><small>${others != null ? x('stripShowcaseSub', { n: others }) : ''}</small></div>
      <div><b>${ctx.standaloneUrl ? 2 : 1}</b><span>${x('stripAddresses')}</span><small>${ctx.standaloneUrl ? x('stripAddressesSub') : x('stripAddressOne')}</small></div>
    </div>`;
}

function secAddresses(ctx) {
  const url = apexUrl(ctx.ownerName);
  const badgeOn = ctx.data.config?.showBadge !== false;
  return html`
    <${PageSection} id="pf-addresses" num="01" title=${x('secAddresses')} count=${ctx.standaloneUrl ? '2' : '1'} first=${true}>
      <div class="facts">
        <div class="facts-k poster-label">${x('addressNode')}</div>
        <div class="facts-v">${url}<small>${x('addressNodeSub')}</small><div class="og-doors">${copyDoor(url, t('common.copy'), () => ctx.toast(x('copiedAddress')))}<a class="poster-action poster-action--small poster-action--lower" href=${url} target="_blank" rel="noopener">${x('open')}</a></div></div>
        ${ctx.standaloneUrl ? html`
          <div class="facts-k poster-label">${x('addressOwn')}</div>
          <div class="facts-v">${ctx.standaloneUrl}<small>${x('addressOwnSub')} ${badgeOn ? x('badgeOn') : x('badgeOff')}</small><div class="og-doors">${copyDoor(ctx.standaloneUrl, t('common.copy'), () => ctx.toast(x('copiedAddress')))}<a class="poster-action poster-action--small poster-action--lower" href=${ctx.standaloneUrl} target="_blank" rel="noopener">${x('open')}</a><button type="button" class="poster-action poster-action--small poster-action--lower" disabled=${ctx.busy === 'badge'} onClick=${() => ctx.setBadge(!badgeOn)}>${badgeOn ? x('hideBadge') : x('showBadge')}</button></div></div>` : null}
      </div>
      <${Hint}>${ctx.standaloneUrl ? x('hintAddresses') : x('hintAddressOne')}<//>
    <//>`;
}

function secVisibility(ctx, state) {
  const cfg = ctx.data.config || {};
  const off = state === 'off';
  const others = Math.max(0, (ctx.members ?? 1) - (off ? 0 : 1));
  return html`
    <${PageSection} id="pf-visibility" num="02" title=${x('secVisibility')} count=${x('secVisibilitySub')} first=${off}>
      <div class="facts">
        <div class="facts-k poster-label">${x('visWeb')}</div>
        <div class="facts-v">${off ? html`<b class="is-off">${x('visWebOff')}</b> ${x('visWebOffSub')}` : html`<b class="is-on">${x('visWebOn')}</b> ${x('visWebOnSub')}`}<small>${x('visWebHint')}</small><div class="og-doors">${off
          ? html`<button type="button" class="poster-slab poster-slab--control" disabled=${ctx.busy === 'enable'} onClick=${() => ctx.setEnabled(true)}>${x('republish')}</button>`
          : html`<button type="button" class="poster-action poster-action--small poster-action--danger poster-action--lower" disabled=${ctx.busy === 'enable'} onClick=${() => ctx.setEnabled(false)}>${x('unpublish')}</button>`}</div></div>
        <div class="facts-k poster-label">${x('visSearch')}</div>
        <div class="facts-v">${off
          ? html`<b>${x('visSearchOffWeb')}</b> ${cfg.seoIndex ? x('visSearchOffWebAllowed') : x('visSearchOffWebDenied')}`
          : cfg.seoIndex ? html`<b class="is-on">${x('visSearchOn')}</b> ${x('visSearchOnSub')}` : html`<b>${x('visSearchOff')}</b> ${x('visSearchOffSub')}`}<small>${x('visSearchHint')}</small>${off ? null : html`<div class="og-doors"><button type="button" class="poster-action poster-action--small poster-action--lower" disabled=${ctx.busy === 'seo'} onClick=${() => ctx.setSeo(!cfg.seoIndex)}>${cfg.seoIndex ? x('searchOff') : x('searchOn')}</button></div>`}</div>
        <div class="facts-k poster-label">${x('visShowcase')}</div>
        <div class="facts-v">${off ? html`<b>${x('visShowcaseOff')}</b> ${x('visShowcaseOffSub')}` : html`<b class="is-on">${x('visShowcaseOn')}</b> ${x('visShowcaseOnSub', { n: others })}`}<small>${x('visShowcaseHint')}</small><div class="og-doors"><a class="poster-action poster-action--small poster-action--lower" href="/v1/members" target="_blank" rel="noopener">${x('openShowcase')}</a></div></div>
      </div>
    <//>`;
}

function secPage(ctx, state) {
  const d = ctx.data;
  const cfg = d.config || {};
  const title = ctx.title || x('untitled');
  const by = writtenBy(cfg, ctx.ai);
  const choices = [cfg.designStyle ? x('style.' + cfg.designStyle) : '', cfg.portfolioType ? x('type.' + cfg.portfolioType) : '', (cfg.authGates || []).length ? x('gatesN', { n: cfg.authGates.length }) : x('gatesNone')].filter(Boolean);
  return html`
    <${PageSection} id="pf-page" num="03" title=${x('secPage')} count=${x('kb', { n: d.html.size_kb })}>
      <div class="pf-pg">
        <div class="pf-thumb" aria-hidden="true"><i></i><i></i></div>
        <div class="pf-pg-words"><b>${title}</b><small>${[x('publishedOn', { date: dateWord(d.html.stored_at), time: timeWord(d.html.stored_at) }), x('kb', { n: d.html.size_kb }), choices.slice(0, 2).join(', ')].filter(Boolean).join(' · ')}</small></div>
        <div class="pf-pg-go">
          <button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.togglePreview()}>${ctx.previewOpen ? x('hidePreview') : x('preview')}</button>
          ${state === 'on' ? html`<a class="poster-action poster-action--small poster-action--row poster-action--lower" href=${apexUrl(ctx.ownerName)} target="_blank" rel="noopener">${x('open')}</a>` : null}
        </div>
      </div>
      ${ctx.previewOpen ? html`
        <div class="pf-prev poster-box poster-box--raised">
          ${ctx.pageHtml ? html`<iframe class="pf-prev-frame" title=${title} sandbox="allow-scripts" srcdoc=${ctx.previewDoc()}></iframe>` : html`<p class="poster-quiet pf-empty loading-mark">${x('loading')}</p>`}
        </div>
        <${Hint}>${x('previewHint')}<//>
        <div class="og-doors pf-prev-doors">
          ${state === 'on' ? html`<a class="poster-action poster-action--small" href=${apexUrl(ctx.ownerName)} target="_blank" rel="noopener">${x('open')}</a>` : null}
          ${state === 'on' && ctx.standaloneUrl ? html`<a class="poster-action poster-action--small poster-action--lower" href=${ctx.standaloneUrl} target="_blank" rel="noopener">${x('ownAddress')}</a>` : null}
        </div>` : null}
      <div class="facts">
        <div class="facts-k poster-label">${x('writer')}</div><div class="facts-v">${by.main}<small>${by.sub}</small></div>
        <div class="facts-k poster-label">${x('choices')}</div><div class="facts-v">${choices.length ? choices.join(', ') : x('choicesNone')}<small>${x('choicesSub')}</small></div>
        <div class="facts-k poster-label">${x('size')}</div><div class="facts-v">${x('sizeOf', { n: d.html.size_kb, max: ctx.maxKb })}<small>${x('sizeSub')}</small></div>
        <div class="facts-k poster-label">${x('storage')}</div><div class="facts-v">${x('storageIn')} <code class="code-inline">portfolio/index.html</code><small>${x('storageSub')}</small></div>
      </div>
    <//>`;
}

function secChange(ctx) {
  return html`
    <${PageSection} id="pf-change" num="04" title=${x('secChange')} count=${x('secChangeSub')}>
      <p class="og-lead">${x('changeIntro')}</p>
      ${roads(ctx, true)}
    <//>`;
}

function roads(ctx, hasPage) {
  const filled = !!(ctx.paste || '').trim();
  const kb = Math.ceil(new TextEncoder().encode(ctx.paste || '').length / 1024);
  const tooBig = kb > ctx.maxKb;
  return html`
    <div class="pf-roads">
      <div class="pf-road poster-box poster-box--raised">
        <span class="pf-road-t">${x('roadAi')}</span>
        <p>${hasPage ? x('roadAiBody') : x('roadAiBodyNew')}</p>
        <pre class="code-block pf-req">${ctx.aiRequestText()}</pre>
        <div class="og-doors"><button type="button" class="poster-action poster-action--small" onClick=${() => ctx.copyAiRequest()}>${x('copyRequest')}</button></div>
      </div>
      <div class="pf-road poster-box">
        <span class="pf-road-t">${x('roadBuilder')}</span>
        <p>${hasPage ? x('roadBuilderBody') : x('roadBuilderBodyNew')}</p>
        <div class="og-doors"><button type="button" class="poster-action poster-action--small" onClick=${() => ctx.navigate('/v1/portfolio')}>${x('openBuilder')}</button></div>
      </div>
      <div class="pf-road poster-box">
        <span class="pf-road-t">${x('roadImport')}</span>
        <p>${x('roadImportBody', { max: ctx.maxKb })}</p>
        <textarea class="og-textarea pf-paste" rows="6" placeholder=${x('pastePlaceholder')} aria-label=${x('roadImport')} value=${ctx.paste} onInput=${(e) => ctx.setPaste(e.target.value)}></textarea>
        ${filled ? html`<small class=${`pf-paste-meta ${tooBig ? 'is-warn' : ''}`}>${tooBig ? x('pasteTooBig', { n: kb, max: ctx.maxKb }) : x('pasteSize', { n: kb, max: ctx.maxKb })}</small>` : null}
        <div class="og-doors">
          ${filled
            ? html`<button type="button" class="poster-slab poster-slab--control" disabled=${ctx.busy === 'publish' || tooBig} onClick=${() => ctx.publishPaste()}>${x('publish')}</button><button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.setPaste('')}>${x('clear')}</button>`
            : html`<button type="button" class="poster-action poster-action--small" onClick=${() => ctx.pickFile()}>${x('chooseFile')}</button>`}
        </div>
      </div>
    </div>`;
}

function secFirst(ctx) {
  return html`
    <${PageSection} id="pf-first" num="01" title=${x('secFirst')} count=${x('secFirstSub')} first=${true}>
      <p class="poster-quiet pf-empty"><b>${x('emptyNone')}</b> ${x('emptyNoneSub')}</p>
      <div class="pf-roads">
        <div class="pf-road poster-box poster-box--raised">
          <span class="pf-road-t">${x('roadMat')}</span>
          <p>${x('roadMatBody')}</p>
          ${ctx.matPrompt ? html`<pre class="code-block pf-req">${ctx.matPrompt.slice(0, 420)}${ctx.matPrompt.length > 420 ? '…' : ''}</pre>` : null}
          <div class="og-doors"><button type="button" class="poster-action poster-action--small" disabled=${ctx.busy === 'mat'} onClick=${() => ctx.copyMatPrompt()}>${x('copyRequest')}</button><button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.navigate('/v1/home')}>${x('goHome')}</button></div>
        </div>
        <div class="pf-road poster-box">
          <span class="pf-road-t">${x('roadAi')}</span>
          <p>${x('roadAiBodyNew')}</p>
          <div class="og-doors"><button type="button" class="poster-action poster-action--small" onClick=${() => ctx.copyAiRequest()}>${x('copyRequest')}</button></div>
        </div>
        <div class="pf-road poster-box">
          <span class="pf-road-t">${x('roadBuilder')}</span>
          <p>${x('roadBuilderBodyNew')}</p>
          <div class="og-doors"><button type="button" class="poster-action poster-action--small" onClick=${() => ctx.navigate('/v1/portfolio')}>${x('openBuilder')}</button></div>
        </div>
      </div>
    <//>`;
}

function secAgent(ctx, state) {
  return html`
    <${PageSection} id="pf-ai" num="05" title=${x('secAi')} count=${null}>
      <p class="og-lead">${x('aiIntro')}</p>
      <div class="pf-rule poster-box">
        <span class="poster-label">${x('ruleLabel')}</span>
        <p class="og-lead">${x('ruleBody')}</p>
        <code class="code-inline">GET ${apexUrl(ctx.ownerName)}</code> → <code class="code-inline">aimeat_portfolio_publish { html }</code> · ${x('ruleNoMcp')} <code>PUT /v1/portfolio/upload { html }</code>
        <div class="og-doors"><button type="button" class="poster-action poster-action--small" onClick=${() => ctx.copyRule()}>${x('copyRule')}</button></div>
      </div>
      <div class="facts">
        <div class="facts-k poster-label">${x('aiDoes')}</div><div class="facts-v">${x('aiDoesBody')}<small>${x('aiDoesSub', { max: ctx.maxKb })}</small></div>
        <div class="facts-k poster-label">${x('aiNot')}</div><div class="facts-v">${x('aiNotBody')}<small>${x('aiNotSub')}</small></div>
        <div class="facts-k poster-label">${x('aiAddress')}</div><div class="facts-v">${state === 'none' ? x('aiAddressBodyNew') : x('aiAddressBody')}</div>
      </div>
    <//>`;
}
