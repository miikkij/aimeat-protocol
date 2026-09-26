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
 *   v1.18.0 -- 2026-09-26 -- Every part is a kit component (SettingsPage with its head, strip, rail and hidden file field as data; FigureStrip; Facts with the state words Tinted; List with the page's Thumb; PagePreview; Roads; TextArea; FileDrop; Box; Label; Code; Note; Action): the page passes data and writes no class (page group G8).
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
import { PageSection } from '/components/PageSection.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Facts } from '/components/Facts.js';
import { Tinted } from '/components/Figure.js';
import { Box } from '/components/Box.js';
import { Roads, Road } from '/components/Roads.js';
import { List, Row, Thumb, Name, Doors } from '/components/List.js';
import { PagePreview } from '/components/PagePreview.js';
import { TextArea } from '/components/TextField.js';
import { FileDrop } from '/components/FileDrop.js';
import { Label, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { x, apexUrl, dateWord, timeWord, writtenBy, crumb, pageLinks } from './frame.js';
import { Hint } from '/components/Hint.js';

const copyDoor = (text, label, onCopied) => html`<${Action} small copy=${text} copiedLabel=${t('common.copied')} onCopied=${onCopied}>${label}<//>`;
const openDoor = (href, words, soft = true) => html`<${Action} small soft=${soft} href=${href} newTab>${words}<//>`;

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
    <${SettingsPage} name="portfolio"
      crumb=${crumb()}
      ...${mast(ctx, state)}
      strip=${strip(ctx, state)}
      railTitle=${x('railTitle')}
      sections=${rail.map(([num, id, label, count]) => ({ id, num, label, count }))}
      pagesLabel=${x('pages')}
      pages=${pageLinks(ctx.navigate)}
      after=${html`
        <${FileDrop} hidden accept=".html,.htm,text/html" inputRef=${ctx.fileRef} onChange=${(e) => ctx.readFile(e)} />
        <${ctx.ConfirmUI} />`}>
      ${state === 'loading' ? html`<${Note} kind="loading">${x('loading')}<//>` : null}
      ${state === 'none' ? secFirst(ctx) : null}
      ${state === 'on' ? secAddresses(ctx) : null}
      ${state === 'on' || state === 'off' ? secVisibility(ctx, state) : null}
      ${state === 'on' || state === 'off' ? secPage(ctx, state) : null}
      ${state === 'on' || state === 'off' ? secChange(ctx) : null}
      ${state !== 'loading' ? secAgent(ctx, state) : null}
    <//>`;
}

/** The head: the title, its tags and line, the loud action and the doors, as SettingsPage props. */
function mast(ctx, state) {
  const d = ctx.data;
  const cfg = d?.config;
  const others = Math.max(0, (ctx.members ?? 0) - (state === 'on' ? 1 : 0));
  const marks = state === 'on'
    ? [{ label: x('chipPublic'), tone: 'sun' }, { label: cfg?.seoIndex ? x('chipSearch') : x('chipNoSearch') }, { label: x('chipShowcase') }, { label: `${x('kb', { n: d.html.size_kb })} · ${dateWord(d.html.stored_at)}` }]
    : state === 'off'
      ? [{ label: x('chipOff'), tone: 'coral' }, { label: x('chipStored', { n: d.html.size_kb }) }, cfg?.seoIndex ? { label: x('chipSearchAllowed') } : null]
      : state === 'none'
        ? [{ label: x('chipNone'), tone: 'coral' }, ctx.members != null ? { label: x('chipOthers', { n: others }) } : null]
        : [];
  const desc = state === 'on' ? x('desc') : state === 'off' ? x('descOff', { date: dateWord(cfg?.updatedAt || cfg?.unpublishedAt) || dateWord(d?.html?.stored_at) }) : state === 'none' ? x('descNone') : '';
  const loud = state === 'off'
    ? html`<${Loud} control disabled=${ctx.busy === 'enable'} onClick=${() => ctx.setEnabled(true)}>${x('republish')}<//>`
    : state === 'none'
      ? html`<${Loud} control disabled=${ctx.busy === 'mat'} onClick=${() => ctx.copyMatPrompt()}>${x('makeMat')}<//>`
      : html`<${Loud} onClick=${() => ctx.copyAiRequest()}>${x('askAi')}<//>`;
  return {
    title: t('portfolio.tabLabel'), sub: x('titleSub'), marks, desc,
    actions: html`${loud}<${Actions}>
      ${state === 'on' ? openDoor(apexUrl(ctx.ownerName), x('openPage'), false) : null}
      <${Action} small soft onClick=${() => ctx.navigate('/v1/portfolio')}>${x('builder')}<//>
    <//>`,
  };
}

function strip(ctx, state) {
  const d = ctx.data;
  const cfg = d?.config;
  const m = ctx.members;
  const others = m == null ? null : Math.max(0, m - (state === 'on' ? 1 : 0));
  if (state === 'loading') return html`<${FigureStrip} loading=${4} />`;
  if (state === 'none') {
    return html`<${FigureStrip} items=${[
      { key: 'pages', n: 0, label: x('stripPages'), sub: x('stripPagesNone') },
      { key: 'showcase', n: m ?? '…', label: x('stripShowcase'), sub: x('stripShowcaseNone') },
      { key: 'addresses', n: ctx.standaloneUrl ? 2 : 1, label: x('stripAddressesReady'), sub: ctx.standaloneUrl ? x('stripAddressesSub') : x('stripAddressOne') },
      { key: 'roads', n: 3, label: x('stripRoads'), sub: x('stripRoadsSub') },
    ]} />`;
  }
  if (state === 'off') {
    return html`<${FigureStrip} items=${[
      { key: 'off', n: x('stripOff'), tone: 'coral', label: x('stripOffLabel'), sub: x('stripOffSub') },
      { key: 'published', n: dateWord(d.html.stored_at), label: x('stripPublished'), sub: `${x('kb', { n: d.html.size_kb })}${cfg?.designStyle ? ` · ${x('style.' + cfg.designStyle) || cfg.designStyle}` : ''}` },
      { key: 'showcase', n: others ?? '…', label: x('stripShowcase'), sub: x('stripShowcaseOff') },
      { key: 'addresses', n: ctx.standaloneUrl ? 2 : 1, label: x('stripAddresses'), sub: x('stripAddressesOff') },
    ]} />`;
  }
  return html`<${FigureStrip} items=${[
    { key: 'published', n: dateWord(d.html.stored_at), label: x('stripPublished'), sub: [timeWord(d.html.stored_at), x('kb', { n: d.html.size_kb }), cfg?.designStyle ? x('style.' + cfg.designStyle) : ''].filter(Boolean).join(' · ') },
    { key: 'public', n: x('stripPublic'), tone: 'coral', label: x('stripPublicLabel'), sub: cfg?.seoIndex ? x('stripSearchOn') : x('stripSearchOff') },
    { key: 'showcase', n: m ?? '…', label: x('stripShowcase'), sub: others != null ? x('stripShowcaseSub', { n: others }) : '' },
    { key: 'addresses', n: ctx.standaloneUrl ? 2 : 1, label: x('stripAddresses'), sub: ctx.standaloneUrl ? x('stripAddressesSub') : x('stripAddressOne') },
  ]} />`;
}

function secAddresses(ctx) {
  const url = apexUrl(ctx.ownerName);
  const badgeOn = ctx.data.config?.showBadge !== false;
  const copied = () => ctx.toast(x('copiedAddress'));
  const own = ctx.standaloneUrl;
  return html`
    <${PageSection} id="pf-addresses" num="01" title=${x('secAddresses')} count=${own ? '2' : '1'} first=${true}>
      <${Facts} rows=${[
        { k: x('addressNode'), v: url, sub: x('addressNodeSub'),
          actions: html`${copyDoor(url, t('common.copy'), copied)}${openDoor(url, x('open'))}` },
        own && { k: x('addressOwn'), v: own, sub: `${x('addressOwnSub')} ${badgeOn ? x('badgeOn') : x('badgeOff')}`,
          actions: html`${copyDoor(own, t('common.copy'), copied)}${openDoor(own, x('open'))}<${Action} small soft disabled=${ctx.busy === 'badge'} onClick=${() => ctx.setBadge(!badgeOn)}>${badgeOn ? x('hideBadge') : x('showBadge')}<//>` },
      ]} />
      <${Hint}>${own ? x('hintAddresses') : x('hintAddressOne')}<//>
    <//>`;
}

function secVisibility(ctx, state) {
  const cfg = ctx.data.config || {};
  const off = state === 'off';
  const others = Math.max(0, (ctx.members ?? 1) - (off ? 0 : 1));
  // A state word in its colour: on in the fine colour, off in coral (main's b.is-on / b.is-off).
  const said = (tone, word, rest) => html`<${Tinted} strong tone=${tone}>${word}<//> ${rest}`;
  const webDoor = off
    ? html`<${Loud} control disabled=${ctx.busy === 'enable'} onClick=${() => ctx.setEnabled(true)}>${x('republish')}<//>`
    : html`<${Action} small soft tone="danger" disabled=${ctx.busy === 'enable'} onClick=${() => ctx.setEnabled(false)}>${x('unpublish')}<//>`;
  const search = off
    ? said(undefined, x('visSearchOffWeb'), cfg.seoIndex ? x('visSearchOffWebAllowed') : x('visSearchOffWebDenied'))
    : cfg.seoIndex ? said('fine', x('visSearchOn'), x('visSearchOnSub')) : said(undefined, x('visSearchOff'), x('visSearchOffSub'));
  return html`
    <${PageSection} id="pf-visibility" num="02" title=${x('secVisibility')} count=${x('secVisibilitySub')} first=${off}>
      <${Facts} rows=${[
        { k: x('visWeb'), v: off ? said('notice', x('visWebOff'), x('visWebOffSub')) : said('fine', x('visWebOn'), x('visWebOnSub')),
          sub: x('visWebHint'), actions: webDoor },
        { k: x('visSearch'), v: search, sub: x('visSearchHint'),
          actions: off ? null : html`<${Action} small soft disabled=${ctx.busy === 'seo'} onClick=${() => ctx.setSeo(!cfg.seoIndex)}>${cfg.seoIndex ? x('searchOff') : x('searchOn')}<//>` },
        { k: x('visShowcase'), v: off ? said(undefined, x('visShowcaseOff'), x('visShowcaseOffSub')) : said('fine', x('visShowcaseOn'), x('visShowcaseOnSub', { n: others })),
          sub: x('visShowcaseHint'), actions: openDoor('/v1/members', x('openShowcase')) },
      ]} />
    <//>`;
}

function secPage(ctx, state) {
  const d = ctx.data;
  const cfg = d.config || {};
  const title = ctx.title || x('untitled');
  const by = writtenBy(cfg, ctx.ai);
  const choices = [cfg.designStyle ? x('style.' + cfg.designStyle) : '', cfg.portfolioType ? x('type.' + cfg.portfolioType) : '', (cfg.authGates || []).length ? x('gatesN', { n: cfg.authGates.length }) : x('gatesNone')].filter(Boolean);
  const on = state === 'on';
  return html`
    <${PageSection} id="pf-page" num="03" title=${x('secPage')} count=${x('kb', { n: d.html.size_kb })}>
      <${List} cols="mark-name-doors">
        <${Row} key="page">
          <${Thumb} />
          <${Name} meta=${[x('publishedOn', { date: dateWord(d.html.stored_at), time: timeWord(d.html.stored_at) }), x('kb', { n: d.html.size_kb }), choices.slice(0, 2).join(', ')].filter(Boolean).join(' · ')}>${title}<//>
          <${Doors}>
            <${Action} small row onClick=${() => ctx.togglePreview()}>${ctx.previewOpen ? x('hidePreview') : x('preview')}<//>
            ${on ? html`<${Action} small row soft href=${apexUrl(ctx.ownerName)} newTab>${x('open')}<//>` : null}
          <//>
        <//>
      <//>
      ${ctx.previewOpen ? html`
        <${PagePreview} title=${title} srcdoc=${ctx.pageHtml ? ctx.previewDoc() : null} loadingLabel=${x('loading')} />
        <${Hint}>${x('previewHint')}<//>
        <${Actions}>
          ${on ? openDoor(apexUrl(ctx.ownerName), x('open'), false) : null}
          ${on && ctx.standaloneUrl ? openDoor(ctx.standaloneUrl, x('ownAddress')) : null}
        <//>` : null}
      <${Facts} rows=${[
        { k: x('writer'), v: by.main, sub: by.sub },
        { k: x('choices'), v: choices.length ? choices.join(', ') : x('choicesNone'), sub: x('choicesSub') },
        { k: x('size'), v: x('sizeOf', { n: d.html.size_kb, max: ctx.maxKb }), sub: x('sizeSub') },
        { k: x('storage'), v: html`${x('storageIn')} <${Code}>portfolio/index.html<//>`, sub: x('storageSub') },
      ]} />
    <//>`;
}

function secChange(ctx) {
  return html`
    <${PageSection} id="pf-change" num="04" title=${x('secChange')} count=${x('secChangeSub')}>
      <${Note} kind="lead">${x('changeIntro')}<//>
      ${roads(ctx, true)}
    <//>`;
}

function roads(ctx, hasPage) {
  const filled = !!(ctx.paste || '').trim();
  const kb = Math.ceil(new TextEncoder().encode(ctx.paste || '').length / 1024);
  const tooBig = kb > ctx.maxKb;
  const importDoors = filled
    ? html`<${Loud} control disabled=${ctx.busy === 'publish' || tooBig} onClick=${() => ctx.publishPaste()}>${x('publish')}<//><${Action} small soft onClick=${() => ctx.setPaste('')}>${x('clear')}<//>`
    : html`<${Action} small onClick=${() => ctx.pickFile()}>${x('chooseFile')}<//>`;
  // The size line under the pasted page: grey while it fits, the refusal when it is too large.
  const size = !filled ? {} : tooBig
    ? { message: x('pasteTooBig', { n: kb, max: ctx.maxKb }), error: true }
    : { hint: x('pasteSize', { n: kb, max: ctx.maxKb }) };
  return html`
    <${Roads} cols="three" wide>
      <${Road} lead name=${x('roadAi')} text=${hasPage ? x('roadAiBody') : x('roadAiBodyNew')} code=${ctx.aiRequestText()}
        doors=${html`<${Action} small onClick=${() => ctx.copyAiRequest()}>${x('copyRequest')}<//>`} />
      <${Road} name=${x('roadBuilder')} text=${hasPage ? x('roadBuilderBody') : x('roadBuilderBodyNew')}
        doors=${html`<${Action} small onClick=${() => ctx.navigate('/v1/portfolio')}>${x('openBuilder')}<//>`} />
      <${Road} name=${x('roadImport')} text=${x('roadImportBody', { max: ctx.maxKb })} doors=${importDoors}>
        <${TextArea} rows=${6} placeholder=${x('pastePlaceholder')} ariaLabel=${x('roadImport')} value=${ctx.paste}
          onInput=${(v) => ctx.setPaste(v)} ...${size} />
      <//>
    <//>`;
}

function secFirst(ctx) {
  const mat = ctx.matPrompt ? `${ctx.matPrompt.slice(0, 420)}${ctx.matPrompt.length > 420 ? '…' : ''}` : null;
  return html`
    <${PageSection} id="pf-first" num="01" title=${x('secFirst')} count=${x('secFirstSub')} first=${true}>
      <${Note} kind="quiet"><b>${x('emptyNone')}</b> ${x('emptyNoneSub')}<//>
      <${Roads} cols="three" wide>
        <${Road} lead name=${x('roadMat')} text=${x('roadMatBody')} code=${mat}
          doors=${html`<${Action} small disabled=${ctx.busy === 'mat'} onClick=${() => ctx.copyMatPrompt()}>${x('copyRequest')}<//><${Action} small soft onClick=${() => ctx.navigate('/v1/home')}>${x('goHome')}<//>`} />
        <${Road} name=${x('roadAi')} text=${x('roadAiBodyNew')}
          doors=${html`<${Action} small onClick=${() => ctx.copyAiRequest()}>${x('copyRequest')}<//>`} />
        <${Road} name=${x('roadBuilder')} text=${x('roadBuilderBodyNew')}
          doors=${html`<${Action} small onClick=${() => ctx.navigate('/v1/portfolio')}>${x('openBuilder')}<//>`} />
      <//>
    <//>`;
}

function secAgent(ctx, state) {
  return html`
    <${PageSection} id="pf-ai" num="05" title=${x('secAi')} count=${null}>
      <${Note} kind="lead">${x('aiIntro')}<//>
      <${Box} doors=${html`<${Action} small onClick=${() => ctx.copyRule()}>${x('copyRule')}<//>`}>
        <${Label} block>${x('ruleLabel')}<//>
        <${Note} kind="lead">${x('ruleBody')}<//>
        <${Code}>GET ${apexUrl(ctx.ownerName)}<//> → <${Code}>aimeat_portfolio_publish { html }<//> · ${x('ruleNoMcp')} <${Code}>PUT /v1/portfolio/upload { html }<//>
      <//>
      <${Facts} rows=${[
        { k: x('aiDoes'), v: x('aiDoesBody'), sub: x('aiDoesSub', { max: ctx.maxKb }) },
        { k: x('aiNot'), v: x('aiNotBody'), sub: x('aiNotSub') },
        { k: x('aiAddress'), v: state === 'none' ? x('aiAddressBodyNew') : x('aiAddressBody') },
      ]} />
    <//>`;
}
