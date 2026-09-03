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
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { Section, scrollTo } from '/views/profile/organisms/poster-parts.js';
import { x, apexUrl, dateWord, timeWord, writtenBy, crumb, pageLinks } from './frame.js';

const chip = (text, cls = '') => html`<span class=${`og-chip ${cls}`}>${text}</span>`;
const copyDoor = (text, label, onCopied) => html`<${CopyButton} text=${text} label=${label} copiedLabel=${t('common.copied')} className="og-door" onCopied=${onCopied} />`;

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
          ${state === 'loading' ? html`<p class="pf-empty">${x('loading')}</p>` : null}
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
    ? [chip(x('chipPublic'), 'og-chip--sun'), cfg?.seoIndex ? chip(x('chipSearch')) : chip(x('chipNoSearch'), 'og-chip--dim'), chip(x('chipShowcase')), chip(`${x('kb', { n: d.html.size_kb })} · ${dateWord(d.html.stored_at)}`, 'og-chip--dim')]
    : state === 'off'
      ? [chip(x('chipOff'), 'og-chip--coral'), chip(x('chipStored', { n: d.html.size_kb })), cfg?.seoIndex ? chip(x('chipSearchAllowed'), 'og-chip--dim') : null]
      : state === 'none'
        ? [chip(x('chipNone'), 'og-chip--coral'), ctx.members != null ? chip(x('chipOthers', { n: others }), 'og-chip--dim') : null]
        : [];
  const desc = state === 'on' ? x('desc') : state === 'off' ? x('descOff', { date: dateWord(cfg?.updatedAt || cfg?.unpublishedAt) || dateWord(d?.html?.stored_at) }) : state === 'none' ? x('descNone') : '';
  return html`
    <div class="og-mast">
      <div class="og-mast-words">
        <h1 class="og-title">${t('portfolio.tabLabel')}<small>${x('titleSub')}</small></h1>
        <div class="og-chips">${chips}</div>
        <p class="og-desc">${desc}</p>
      </div>
      <div class="og-mast-actions">
        ${state === 'off'
          ? html`<button type="button" class="og-slab" disabled=${ctx.busy === 'enable'} onClick=${() => ctx.setEnabled(true)}>${x('republish')}</button>`
          : state === 'none'
            ? html`<button type="button" class="og-slab" disabled=${ctx.busy === 'mat'} onClick=${() => ctx.copyMatPrompt()}>${x('makeMat')}</button>`
            : html`<button type="button" class="og-slab" onClick=${() => ctx.copyAiRequest()}>${x('askAi')}</button>`}
        <div class="og-doors">
          ${state === 'on' ? html`<a class="og-door" href=${apexUrl(ctx.ownerName)} target="_blank" rel="noopener">${x('openPage')}</a>` : null}
          <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.navigate('/v1/portfolio')}>${x('builder')}</button>
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
    <${Section} id="pf-addresses" num="01" title=${x('secAddresses')} count=${ctx.standaloneUrl ? '2' : '1'} first=${true}>
      <div class="pf-adr">
        <div class="pf-k">${x('addressNode')}</div>
        <div class="pf-u">${url}<small>${x('addressNodeSub')}</small></div>
        <div class="pf-go">${copyDoor(url, t('common.copy'), () => ctx.toast(x('copiedAddress')))}<a class="og-door og-door--quiet" href=${url} target="_blank" rel="noopener">${x('open')}</a></div>
        ${ctx.standaloneUrl ? html`
          <div class="pf-k">${x('addressOwn')}</div>
          <div class="pf-u">${ctx.standaloneUrl}<small>${x('addressOwnSub')} ${badgeOn ? x('badgeOn') : x('badgeOff')}</small></div>
          <div class="pf-go">${copyDoor(ctx.standaloneUrl, t('common.copy'), () => ctx.toast(x('copiedAddress')))}<a class="og-door og-door--quiet" href=${ctx.standaloneUrl} target="_blank" rel="noopener">${x('open')}</a><button type="button" class="og-door og-door--quiet" disabled=${ctx.busy === 'badge'} onClick=${() => ctx.setBadge(!badgeOn)}>${badgeOn ? x('hideBadge') : x('showBadge')}</button></div>` : null}
      </div>
      <p class="pf-hint">${ctx.standaloneUrl ? x('hintAddresses') : x('hintAddressOne')}</p>
    <//>`;
}

function secVisibility(ctx, state) {
  const cfg = ctx.data.config || {};
  const off = state === 'off';
  const others = Math.max(0, (ctx.members ?? 1) - (off ? 0 : 1));
  return html`
    <${Section} id="pf-visibility" num="02" title=${x('secVisibility')} count=${x('secVisibilitySub')} first=${off}>
      <div class="pf-adr">
        <div class="pf-k">${x('visWeb')}</div>
        <div class="pf-w">${off ? html`<b class="is-off">${x('visWebOff')}</b> ${x('visWebOffSub')}` : html`<b class="is-on">${x('visWebOn')}</b> ${x('visWebOnSub')}`}<small>${x('visWebHint')}</small></div>
        <div class="pf-go">${off
          ? html`<button type="button" class="og-slab og-slab--sm" disabled=${ctx.busy === 'enable'} onClick=${() => ctx.setEnabled(true)}>${x('republish')}</button>`
          : html`<button type="button" class="og-door og-door--quiet og-door--danger" disabled=${ctx.busy === 'enable'} onClick=${() => ctx.setEnabled(false)}>${x('unpublish')}</button>`}</div>
        <div class="pf-k">${x('visSearch')}</div>
        <div class="pf-w">${off
          ? html`<b>${x('visSearchOffWeb')}</b> ${cfg.seoIndex ? x('visSearchOffWebAllowed') : x('visSearchOffWebDenied')}`
          : cfg.seoIndex ? html`<b class="is-on">${x('visSearchOn')}</b> ${x('visSearchOnSub')}` : html`<b>${x('visSearchOff')}</b> ${x('visSearchOffSub')}`}<small>${x('visSearchHint')}</small></div>
        <div class="pf-go">${off ? null : html`<button type="button" class="og-door og-door--quiet" disabled=${ctx.busy === 'seo'} onClick=${() => ctx.setSeo(!cfg.seoIndex)}>${cfg.seoIndex ? x('searchOff') : x('searchOn')}</button>`}</div>
        <div class="pf-k">${x('visShowcase')}</div>
        <div class="pf-w">${off ? html`<b>${x('visShowcaseOff')}</b> ${x('visShowcaseOffSub')}` : html`<b class="is-on">${x('visShowcaseOn')}</b> ${x('visShowcaseOnSub', { n: others })}`}<small>${x('visShowcaseHint')}</small></div>
        <div class="pf-go"><a class="og-door og-door--quiet" href="/v1/members" target="_blank" rel="noopener">${x('openShowcase')}</a></div>
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
    <${Section} id="pf-page" num="03" title=${x('secPage')} count=${x('kb', { n: d.html.size_kb })}>
      <div class="pf-pg">
        <div class="pf-thumb" aria-hidden="true"><i></i><i></i></div>
        <div class="pf-pg-words"><b>${title}</b><small>${[x('publishedOn', { date: dateWord(d.html.stored_at), time: timeWord(d.html.stored_at) }), x('kb', { n: d.html.size_kb }), choices.slice(0, 2).join(', ')].filter(Boolean).join(' · ')}</small></div>
        <div class="pf-pg-go">
          <button type="button" class="og-door" onClick=${() => ctx.togglePreview()}>${ctx.previewOpen ? x('hidePreview') : x('preview')}</button>
          ${state === 'on' ? html`<a class="og-door og-door--quiet" href=${apexUrl(ctx.ownerName)} target="_blank" rel="noopener">${x('open')}</a>` : null}
        </div>
      </div>
      ${ctx.previewOpen ? html`
        <div class="pf-prev">
          ${ctx.pageHtml ? html`<iframe class="pf-prev-frame" title=${title} sandbox="allow-scripts" srcdoc=${ctx.previewDoc()}></iframe>` : html`<p class="pf-empty">${x('loading')}</p>`}
        </div>
        <p class="pf-hint">${x('previewHint')}</p>
        <div class="og-doors pf-prev-doors">
          ${state === 'on' ? html`<a class="og-door" href=${apexUrl(ctx.ownerName)} target="_blank" rel="noopener">${x('open')}</a>` : null}
          ${state === 'on' && ctx.standaloneUrl ? html`<a class="og-door og-door--quiet" href=${ctx.standaloneUrl} target="_blank" rel="noopener">${x('ownAddress')}</a>` : null}
        </div>` : null}
      <div class="pf-kv">
        <div class="pf-k">${x('writer')}</div><div class="pf-v">${by.main}<small>${by.sub}</small></div>
        <div class="pf-k">${x('choices')}</div><div class="pf-v">${choices.length ? choices.join(', ') : x('choicesNone')}<small>${x('choicesSub')}</small></div>
        <div class="pf-k">${x('size')}</div><div class="pf-v">${x('sizeOf', { n: d.html.size_kb, max: ctx.maxKb })}<small>${x('sizeSub')}</small></div>
        <div class="pf-k">${x('storage')}</div><div class="pf-v">${x('storageIn')} <code>portfolio/index.html</code><small>${x('storageSub')}</small></div>
      </div>
    <//>`;
}

function secChange(ctx) {
  return html`
    <${Section} id="pf-change" num="04" title=${x('secChange')} count=${x('secChangeSub')}>
      <p class="pf-para">${x('changeIntro')}</p>
      ${roads(ctx, true)}
    <//>`;
}

function roads(ctx, hasPage) {
  const filled = !!(ctx.paste || '').trim();
  const kb = Math.ceil(new TextEncoder().encode(ctx.paste || '').length / 1024);
  const tooBig = kb > ctx.maxKb;
  return html`
    <div class="pf-roads">
      <div class="pf-road pf-road--lead">
        <span class="pf-road-t">${x('roadAi')}</span>
        <p>${hasPage ? x('roadAiBody') : x('roadAiBodyNew')}</p>
        <pre class="pf-req">${ctx.aiRequestText()}</pre>
        <div class="og-doors"><button type="button" class="og-door" onClick=${() => ctx.copyAiRequest()}>${x('copyRequest')}</button></div>
      </div>
      <div class="pf-road">
        <span class="pf-road-t">${x('roadBuilder')}</span>
        <p>${hasPage ? x('roadBuilderBody') : x('roadBuilderBodyNew')}</p>
        <div class="og-doors"><button type="button" class="og-door" onClick=${() => ctx.navigate('/v1/portfolio')}>${x('openBuilder')}</button></div>
      </div>
      <div class="pf-road">
        <span class="pf-road-t">${x('roadImport')}</span>
        <p>${x('roadImportBody', { max: ctx.maxKb })}</p>
        <textarea class="og-textarea pf-paste" rows="6" placeholder=${x('pastePlaceholder')} aria-label=${x('roadImport')} value=${ctx.paste} onInput=${(e) => ctx.setPaste(e.target.value)}></textarea>
        ${filled ? html`<small class=${`pf-paste-meta ${tooBig ? 'is-warn' : ''}`}>${tooBig ? x('pasteTooBig', { n: kb, max: ctx.maxKb }) : x('pasteSize', { n: kb, max: ctx.maxKb })}</small>` : null}
        <div class="og-doors">
          ${filled
            ? html`<button type="button" class="og-slab og-slab--sm" disabled=${ctx.busy === 'publish' || tooBig} onClick=${() => ctx.publishPaste()}>${x('publish')}</button><button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setPaste('')}>${x('clear')}</button>`
            : html`<button type="button" class="og-door" onClick=${() => ctx.pickFile()}>${x('chooseFile')}</button>`}
        </div>
      </div>
    </div>`;
}

function secFirst(ctx) {
  return html`
    <${Section} id="pf-first" num="01" title=${x('secFirst')} count=${x('secFirstSub')} first=${true}>
      <p class="pf-empty"><b>${x('emptyNone')}</b> ${x('emptyNoneSub')}</p>
      <div class="pf-roads">
        <div class="pf-road pf-road--lead">
          <span class="pf-road-t">${x('roadMat')}</span>
          <p>${x('roadMatBody')}</p>
          ${ctx.matPrompt ? html`<pre class="pf-req">${ctx.matPrompt.slice(0, 420)}${ctx.matPrompt.length > 420 ? '…' : ''}</pre>` : null}
          <div class="og-doors"><button type="button" class="og-door" disabled=${ctx.busy === 'mat'} onClick=${() => ctx.copyMatPrompt()}>${x('copyRequest')}</button><button type="button" class="og-door og-door--quiet" onClick=${() => ctx.navigate('/v1/home')}>${x('goHome')}</button></div>
        </div>
        <div class="pf-road">
          <span class="pf-road-t">${x('roadAi')}</span>
          <p>${x('roadAiBodyNew')}</p>
          <div class="og-doors"><button type="button" class="og-door" onClick=${() => ctx.copyAiRequest()}>${x('copyRequest')}</button></div>
        </div>
        <div class="pf-road">
          <span class="pf-road-t">${x('roadBuilder')}</span>
          <p>${x('roadBuilderBodyNew')}</p>
          <div class="og-doors"><button type="button" class="og-door" onClick=${() => ctx.navigate('/v1/portfolio')}>${x('openBuilder')}</button></div>
        </div>
      </div>
    <//>`;
}

function secAgent(ctx, state) {
  return html`
    <${Section} id="pf-ai" num="05" title=${x('secAi')} count=${null}>
      <p class="pf-para">${x('aiIntro')}</p>
      <div class="pf-rule">
        <span class="og-label">${x('ruleLabel')}</span>
        <p class="pf-para">${x('ruleBody')}</p>
        <code>GET ${apexUrl(ctx.ownerName)}</code> → <code>aimeat_portfolio_publish { html }</code> · ${x('ruleNoMcp')} <code>PUT /v1/portfolio/upload { html }</code>
        <div class="og-doors"><button type="button" class="og-door" onClick=${() => ctx.copyRule()}>${x('copyRule')}</button></div>
      </div>
      <div class="pf-kv">
        <div class="pf-k">${x('aiDoes')}</div><div class="pf-v">${x('aiDoesBody')}<small>${x('aiDoesSub', { max: ctx.maxKb })}</small></div>
        <div class="pf-k">${x('aiNot')}</div><div class="pf-v">${x('aiNotBody')}<small>${x('aiNotSub')}</small></div>
        <div class="pf-k">${x('aiAddress')}</div><div class="pf-v">${state === 'none' ? x('aiAddressBodyNew') : x('aiAddressBody')}</div>
      </div>
    <//>`;
}
