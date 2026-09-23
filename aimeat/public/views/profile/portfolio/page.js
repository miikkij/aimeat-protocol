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
 * @structure renderPage · identity · strip · secAddresses · secVisibility · secPage · secChange ·
 *   roads · secFirst · secAgent
 * @usage import { renderPage } from './portfolio/page.js';
 * @version-history
 *   2026-09-22 -- Composed from the shared component set (Page, Rail, Section, NumeralBand, ListRow,
 *     KeyValue, Field, Surface), so the page follows the theme and the parts in one edit;
 *     portfolio-poster.css is gone. The preview frame keeps its height as an attribute until the set
 *     has a part for an embedded page.
 *   v1.2.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.1.0 -- 2026-09-13 -- V2: select the shared ink frame for the agent rule.
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Page, Rail, Section, Stack, Columns, NumeralBand, Field, ListRow, Surface, KeyValue,
  Text, Chip, Action, CopyAction } from '/components/poster-parts.js';
import { x, apexUrl, dateWord, timeWord, writtenBy, crumb, pageLinks } from './frame.js';

const copyDoor = (text, label, onCopied) => html`<${CopyAction} text=${text} label=${label} copiedLabel=${t('common.copied')} onCopied=${onCopied} />`;
const kv = (label, body, sub) => html`<${KeyValue} label=${label}><${Stack} density="compact"><span>${body}</span>${sub ? html`<${Text} kind="caption" tone="muted">${sub}<//>` : null}<//><//>`;

export function renderPage(ctx) {
  const d = ctx.data;            // null while loading
  const cfg = d?.config || null;
  const hasPage = !!d?.html;     // a stored file, published or not
  const isOn = hasPage && !!cfg?.enabled;
  const state = !d ? 'loading' : !hasPage ? 'none' : isOn ? 'on' : 'off';
  const size = d?.html ? x('kb', { n: d.html.size_kb }) : undefined;
  const entries = state === 'none'
    ? [{ href: '#pf-first', label: x('secFirst') }, { href: '#pf-ai', label: x('secAi') }]
    : state === 'off'
      ? [{ href: '#pf-visibility', label: x('secVisibility') }, { href: '#pf-page', label: x('secPage'), count: size }, { href: '#pf-change', label: x('secChange') }, { href: '#pf-ai', label: x('secAi') }]
      : [{ href: '#pf-addresses', label: x('secAddresses'), count: ctx.standaloneUrl ? '2' : '1' }, { href: '#pf-visibility', label: x('secVisibility') }, { href: '#pf-page', label: x('secPage'), count: size }, { href: '#pf-change', label: x('secChange') }, { href: '#pf-ai', label: x('secAi') }];
  const desc = state === 'on' ? x('desc') : state === 'off' ? x('descOff', { date: dateWord(cfg?.updatedAt || cfg?.unpublishedAt) || dateWord(d?.html?.stored_at) }) : state === 'none' ? x('descNone') : '';

  return html`<${Page} crumbs=${crumb()} title=${t('portfolio.tabLabel')} identity=${identity(ctx, state)}
    actions=${html`${state === 'off'
        ? html`<${Action} kind="primary" disabled=${ctx.busy === 'enable'} onClick=${() => ctx.setEnabled(true)}>${x('republish')}<//>`
        : state === 'none'
          ? html`<${Action} kind="primary" disabled=${ctx.busy === 'mat'} onClick=${() => ctx.copyMatPrompt()}>${x('makeMat')}<//>`
          : html`<${Action} kind="primary" onClick=${() => ctx.copyAiRequest()}>${x('askAi')}<//>`}
      ${state === 'on' ? html`<${Action} href=${apexUrl(ctx.ownerName)} target="_blank">${x('openPage')}<//>` : null}
      <${Action} onClick=${() => ctx.navigate('/v1/portfolio')}>${x('builder')}<//>`}
    rail=${html`<${Rail} kind="index" title=${x('railTitle')} entries=${entries}>${pageLinks(ctx.navigate)}<//>`}>
    <${Stack}>
      ${desc ? html`<${Text} tone="muted">${desc}<//>` : null}
      ${strip(ctx, state)}
      ${state === 'loading' ? html`<${Text} tone="muted">${x('loading')}<//>` : null}
      ${state === 'none' ? secFirst(ctx) : null}
      ${state === 'on' ? secAddresses(ctx) : null}
      ${state === 'on' || state === 'off' ? secVisibility(ctx, state) : null}
      ${state === 'on' || state === 'off' ? secPage(ctx, state) : null}
      ${state === 'on' || state === 'off' ? secChange(ctx) : null}
      ${state !== 'loading' ? secAgent(ctx, state) : null}
    <//>
    <input type="file" accept=".html,.htm,text/html" hidden ref=${ctx.fileRef} onChange=${(e) => ctx.readFile(e)} />
    <${ctx.ConfirmUI} />
  <//>`;
}

function identity(ctx, state) {
  const d = ctx.data;
  const cfg = d?.config;
  const others = Math.max(0, (ctx.members ?? 0) - (state === 'on' ? 1 : 0));
  const chips = state === 'on'
    ? [html`<${Chip} tone="sun">${x('chipPublic')}<//>`, cfg?.seoIndex ? html`<${Chip}>${x('chipSearch')}<//>` : html`<${Chip} tone="muted">${x('chipNoSearch')}<//>`, html`<${Chip}>${x('chipShowcase')}<//>`, html`<${Chip} tone="muted">${`${x('kb', { n: d.html.size_kb })} · ${dateWord(d.html.stored_at)}`}<//>`]
    : state === 'off'
      ? [html`<${Chip} tone="coral">${x('chipOff')}<//>`, html`<${Chip}>${x('chipStored', { n: d.html.size_kb })}<//>`, cfg?.seoIndex ? html`<${Chip} tone="muted">${x('chipSearchAllowed')}<//>` : null]
      : state === 'none'
        ? [html`<${Chip} tone="coral">${x('chipNone')}<//>`, ctx.members != null ? html`<${Chip} tone="muted">${x('chipOthers', { n: others })}<//>` : null]
        : [];
  return html`<${Stack} density="compact"><${Text} tone="muted">${x('titleSub')}<//>
    ${chips.length ? html`<${Stack} direction="wrap" density="compact">${chips}<//>` : null}<//>`;
}

function strip(ctx, state) {
  const d = ctx.data;
  const cfg = d?.config;
  const m = ctx.members;
  const others = m == null ? null : Math.max(0, m - (state === 'on' ? 1 : 0));
  const band = (items) => html`<${NumeralBand} tone="plain" size="small" items=${items} />`;
  if (state === 'loading') return band([{ id: 'a', label: '', value: '…' }, { id: 'b', label: '', value: '…' }, { id: 'c', label: '', value: '…' }, { id: 'd', label: '', value: '…' }]);
  if (state === 'none') {
    return band([
      { id: 'pages', label: x('stripPages'), value: 0, note: x('stripPagesNone') },
      { id: 'showcase', label: x('stripShowcase'), value: m ?? '…', note: x('stripShowcaseNone') },
      { id: 'addr', label: x('stripAddressesReady'), value: ctx.standaloneUrl ? 2 : 1, note: ctx.standaloneUrl ? x('stripAddressesSub') : x('stripAddressOne') },
      { id: 'roads', label: x('stripRoads'), value: 3, note: x('stripRoadsSub') },
    ]);
  }
  if (state === 'off') {
    return band([
      { id: 'off', label: x('stripOffLabel'), value: x('stripOff'), tone: 'coral', note: x('stripOffSub') },
      { id: 'pub', label: x('stripPublished'), value: dateWord(d.html.stored_at), note: `${x('kb', { n: d.html.size_kb })}${cfg?.designStyle ? ` · ${x('style.' + cfg.designStyle) || cfg.designStyle}` : ''}` },
      { id: 'showcase', label: x('stripShowcase'), value: others ?? '…', note: x('stripShowcaseOff') },
      { id: 'addr', label: x('stripAddresses'), value: ctx.standaloneUrl ? 2 : 1, note: x('stripAddressesOff') },
    ]);
  }
  return band([
    { id: 'pub', label: x('stripPublished'), value: dateWord(d.html.stored_at), note: [timeWord(d.html.stored_at), x('kb', { n: d.html.size_kb }), cfg?.designStyle ? x('style.' + cfg.designStyle) : ''].filter(Boolean).join(' · ') },
    { id: 'public', label: x('stripPublicLabel'), value: x('stripPublic'), tone: 'coral', note: cfg?.seoIndex ? x('stripSearchOn') : x('stripSearchOff') },
    { id: 'showcase', label: x('stripShowcase'), value: m ?? '…', note: others != null ? x('stripShowcaseSub', { n: others }) : '' },
    { id: 'addr', label: x('stripAddresses'), value: ctx.standaloneUrl ? 2 : 1, note: ctx.standaloneUrl ? x('stripAddressesSub') : x('stripAddressOne') },
  ]);
}

function secAddresses(ctx) {
  const url = apexUrl(ctx.ownerName);
  const badgeOn = ctx.data.config?.showBadge !== false;
  return html`
    <${Section} id="pf-addresses" title=${x('secAddresses')} count=${ctx.standaloneUrl ? '2' : '1'}>
      <${Stack}>
        <div>
          <${ListRow} name=${x('addressNode')} detail=${url}
            actions=${html`${copyDoor(url, t('common.copy'), () => ctx.toast(x('copiedAddress')))}<${Action} href=${url} target="_blank">${x('open')}<//>`}>
            <${Text} kind="caption" tone="muted">${x('addressNodeSub')}<//>
          <//>
          ${ctx.standaloneUrl ? html`<${ListRow} name=${x('addressOwn')} detail=${ctx.standaloneUrl}
            actions=${html`${copyDoor(ctx.standaloneUrl, t('common.copy'), () => ctx.toast(x('copiedAddress')))}<${Action} href=${ctx.standaloneUrl} target="_blank">${x('open')}<//>
              <${Action} disabled=${ctx.busy === 'badge'} onClick=${() => ctx.setBadge(!badgeOn)}>${badgeOn ? x('hideBadge') : x('showBadge')}<//>`}>
            <${Text} kind="caption" tone="muted">${x('addressOwnSub')} ${badgeOn ? x('badgeOn') : x('badgeOff')}<//>
          <//>` : null}
        </div>
        <${Text} kind="caption" tone="muted">${ctx.standaloneUrl ? x('hintAddresses') : x('hintAddressOne')}<//>
      <//>
    <//>`;
}

function secVisibility(ctx, state) {
  const cfg = ctx.data.config || {};
  const off = state === 'off';
  const others = Math.max(0, (ctx.members ?? 1) - (off ? 0 : 1));
  /** One switch in words: what it is, its state word in bold before the sentence, the hint, its door. */
  const row = (name, word, _tone, sentence, hint, door) => html`<${ListRow} name=${name} detailKind="text" detail=${html`<strong>${word}</strong> ${sentence}`}
    actions=${door}><${Text} kind="caption" tone="muted">${hint}<//><//>`;
  return html`
    <${Section} id="pf-visibility" title=${x('secVisibility')} count=${x('secVisibilitySub')}>
      <div>
        ${off
          ? row(x('visWeb'), x('visWebOff'), 'coral', x('visWebOffSub'), x('visWebHint'), html`<${Action} disabled=${ctx.busy === 'enable'} onClick=${() => ctx.setEnabled(true)}>${x('republish')}<//>`)
          : row(x('visWeb'), x('visWebOn'), 'success', x('visWebOnSub'), x('visWebHint'), html`<${Action} tone="danger" disabled=${ctx.busy === 'enable'} onClick=${() => ctx.setEnabled(false)}>${x('unpublish')}<//>`)}
        ${off
          ? row(x('visSearch'), x('visSearchOffWeb'), 'plain', cfg.seoIndex ? x('visSearchOffWebAllowed') : x('visSearchOffWebDenied'), x('visSearchHint'), null)
          : cfg.seoIndex
            ? row(x('visSearch'), x('visSearchOn'), 'success', x('visSearchOnSub'), x('visSearchHint'), html`<${Action} disabled=${ctx.busy === 'seo'} onClick=${() => ctx.setSeo(false)}>${x('searchOff')}<//>`)
            : row(x('visSearch'), x('visSearchOff'), 'plain', x('visSearchOffSub'), x('visSearchHint'), html`<${Action} disabled=${ctx.busy === 'seo'} onClick=${() => ctx.setSeo(true)}>${x('searchOn')}<//>`)}
        ${off
          ? row(x('visShowcase'), x('visShowcaseOff'), 'plain', x('visShowcaseOffSub'), x('visShowcaseHint'), html`<${Action} href="/v1/members" target="_blank">${x('openShowcase')}<//>`)
          : row(x('visShowcase'), x('visShowcaseOn'), 'success', x('visShowcaseOnSub', { n: others }), x('visShowcaseHint'), html`<${Action} href="/v1/members" target="_blank">${x('openShowcase')}<//>`)}
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
    <${Section} id="pf-page" title=${x('secPage')} count=${x('kb', { n: d.html.size_kb })}>
      <${Stack}>
        <${ListRow} selected=${ctx.previewOpen} name=${title}
          detail=${[x('publishedOn', { date: dateWord(d.html.stored_at), time: timeWord(d.html.stored_at) }), x('kb', { n: d.html.size_kb }), choices.slice(0, 2).join(', ')].filter(Boolean).join(' · ')}
          actions=${html`<${Action} expanded=${ctx.previewOpen} onClick=${() => ctx.togglePreview()}>${ctx.previewOpen ? x('hidePreview') : x('preview')}<//>
            ${state === 'on' ? html`<${Action} href=${apexUrl(ctx.ownerName)} target="_blank">${x('open')}<//>` : null}`} />
        ${ctx.previewOpen ? html`
          <${Surface} kind="record" density="flush">
            ${ctx.pageHtml ? html`<iframe title=${title} sandbox="allow-scripts" srcdoc=${ctx.previewDoc()} width="100%" height="544" frameborder="0"></iframe>` : html`<${Text} tone="muted">${x('loading')}<//>`}
          <//>
          <${Text} kind="caption" tone="muted">${x('previewHint')}<//>
          <${Stack} direction="wrap" align="center">
            ${state === 'on' ? html`<${Action} href=${apexUrl(ctx.ownerName)} target="_blank">${x('open')}<//>` : null}
            ${state === 'on' && ctx.standaloneUrl ? html`<${Action} href=${ctx.standaloneUrl} target="_blank">${x('ownAddress')}<//>` : null}
          <//>` : null}
        <div>
          ${kv(x('writer'), by.main, by.sub)}
          ${kv(x('choices'), choices.length ? choices.join(', ') : x('choicesNone'), x('choicesSub'))}
          ${kv(x('size'), x('sizeOf', { n: d.html.size_kb, max: ctx.maxKb }), x('sizeSub'))}
          ${kv(x('storage'), html`${x('storageIn')} <${Text} kind="mono">portfolio/index.html<//>`, x('storageSub'))}
        </div>
      <//>
    <//>`;
}

function secChange(ctx) {
  return html`
    <${Section} id="pf-change" title=${x('secChange')} count=${x('secChangeSub')} description=${x('changeIntro')}>
      ${roads(ctx, true)}
    <//>`;
}

/** One road to a page: its title, what it does, and what to press. */
const road = (title, body, children) => html`<${Stack}>
  <${Text} kind="heading" size="small">${title}<//>
  <${Text}>${body}<//>
  ${children}
<//>`;

function roads(ctx, hasPage) {
  const filled = !!(ctx.paste || '').trim();
  const kb = Math.ceil(new TextEncoder().encode(ctx.paste || '').length / 1024);
  const tooBig = kb > ctx.maxKb;
  return html`
    <${Stack}>
      <${Surface} kind="box">${road(x('roadAi'), hasPage ? x('roadAiBody') : x('roadAiBodyNew'), html`
        <${Surface} kind="code">${ctx.aiRequestText()}<//>
        <div><${Action} onClick=${() => ctx.copyAiRequest()}>${x('copyRequest')}<//></div>`)}<//>
      <${Columns} collapse="640" density="roomy">
        ${road(x('roadBuilder'), hasPage ? x('roadBuilderBody') : x('roadBuilderBodyNew'), html`<div><${Action} onClick=${() => ctx.navigate('/v1/portfolio')}>${x('openBuilder')}<//></div>`)}
        ${road(x('roadImport'), x('roadImportBody', { max: ctx.maxKb }), html`
          <${Field} type="textarea" rows=${6} placeholder=${x('pastePlaceholder')} ariaLabel=${x('roadImport')} value=${ctx.paste} onInput=${(e) => ctx.setPaste(e.target.value)} spellCheck=${false} />
          ${filled ? html`<${Text} kind="caption" tone=${tooBig ? 'coral' : 'muted'}>${tooBig ? x('pasteTooBig', { n: kb, max: ctx.maxKb }) : x('pasteSize', { n: kb, max: ctx.maxKb })}<//>` : null}
          <${Stack} direction="wrap" align="center">
            ${filled
              ? html`<${Action} disabled=${ctx.busy === 'publish' || tooBig} onClick=${() => ctx.publishPaste()}>${x('publish')}<//><${Action} onClick=${() => ctx.setPaste('')}>${x('clear')}<//>`
              : html`<${Action} onClick=${() => ctx.pickFile()}>${x('chooseFile')}<//>`}
          <//>`)}
      <//>
    <//>`;
}

function secFirst(ctx) {
  return html`
    <${Section} id="pf-first" title=${x('secFirst')} count=${x('secFirstSub')}>
      <${Stack}>
        <${Text}><strong>${x('emptyNone')}</strong> ${x('emptyNoneSub')}<//>
        <${Surface} kind="box">${road(x('roadMat'), x('roadMatBody'), html`
          ${ctx.matPrompt ? html`<${Surface} kind="code">${ctx.matPrompt.slice(0, 420)}${ctx.matPrompt.length > 420 ? '…' : ''}<//>` : null}
          <${Stack} direction="wrap" align="center"><${Action} disabled=${ctx.busy === 'mat'} onClick=${() => ctx.copyMatPrompt()}>${x('copyRequest')}<//><${Action} onClick=${() => ctx.navigate('/v1/home')}>${x('goHome')}<//><//>`)}<//>
        <${Columns} collapse="640" density="roomy">
          ${road(x('roadAi'), x('roadAiBodyNew'), html`<div><${Action} onClick=${() => ctx.copyAiRequest()}>${x('copyRequest')}<//></div>`)}
          ${road(x('roadBuilder'), x('roadBuilderBodyNew'), html`<div><${Action} onClick=${() => ctx.navigate('/v1/portfolio')}>${x('openBuilder')}<//></div>`)}
        <//>
      <//>
    <//>`;
}

function secAgent(ctx, state) {
  return html`
    <${Section} id="pf-ai" title=${x('secAi')} description=${x('aiIntro')}>
      <${Stack}>
        <${Surface} kind="box">
          <${Stack}>
            <${Text} kind="label">${x('ruleLabel')}<//>
            <${Text}>${x('ruleBody')}<//>
            <${Text} kind="mono">GET ${apexUrl(ctx.ownerName)} → aimeat_portfolio_publish { html } · ${x('ruleNoMcp')} PUT /v1/portfolio/upload { html }<//>
            <div><${Action} onClick=${() => ctx.copyRule()}>${x('copyRule')}<//></div>
          <//>
        <//>
        <div>
          ${kv(x('aiDoes'), x('aiDoesBody'), x('aiDoesSub', { max: ctx.maxKb }))}
          ${kv(x('aiNot'), x('aiNotBody'), x('aiNotSub'))}
          ${kv(x('aiAddress'), state === 'none' ? x('aiAddressBodyNew') : x('aiAddressBody'))}
        </div>
      <//>
    <//>`;
}
