/**
 * @file public/views/profile/portfolio/page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Portfolio page in the poster face: the person's own page at their address. The
 *   mast and the strip say whether it is public and since when; then where it is (the two
 *   addresses), who can see it (the two switches and the member showcase, in words), the page
 *   itself (title, preview, who wrote it, size, where it is stored), the three ways to change it
 *   (ask your AI, the builder, bring a finished HTML) and the rule an agent gets with what a publish
 *   does and does not do. With no page yet the first section is the three roads to one, and a page
 *   taken off the web keeps its preview and the way back. The page explains itself the designed way
 *   (.claude/rules/page-guidance.md): the page's start (PageStart "portfolio") and the title's
 *   question mark (concept.portfolio). Pure render over the ctx bag.
 * @structure renderPage · accessSaid · mast · strip · secAddresses · secVisibility · accessChoices ·
 *   secPage · secChange · secFirst · secAgent
 * @usage import { renderPage } from './portfolio/page.js';
 * @version-history
 *   v1.21.1 -- 2026-11-28 -- The roads' requests and the agent rule copy under common.copyForAi ("Copy the
 *     prompt for your AI"), the one name of a prompt copy.
 *   v1.21.0 -- 2026-11-27 -- Who can open the page is a row of the visibility section with its value (anyone,
 *     people signed in here, the members of one organism) and Change, which opens the three choices in place, one
 *     row each with what choosing it does; one organism is picked from the person's own. A page that needs a
 *     sign-in is no longer called public: the head's tag, the strip's figure and the On the web row say who may
 *     open it, and the search row says a search engine cannot read it (its switch is drawn only for anyone).
 *   v1.20.0 -- 2026-11-27 -- With no page yet there is no figure strip (its four figures counted a reserved address,
 *     the ways to a page and other people's pages, nothing to act on); with a page the strip drops the address count,
 *     which section 01 says. "Changing the page" and "Your AI and your page" are FoldSection rows that say their state
 *     and open in place (a pasted page keeps the first open); the sections are numbered after the filter, so a page off
 *     the web no longer starts at 02, and the rail is drawn only with two or more. Off the web, Make it public again
 *     in the visibility row is a quiet action beside the head's loud one; the head's "Ask your AI" is drawn quiet while
 *     a pasted page waits for Publish. A style or page kind the page has no word for shows its own value, not a key.
 *     No control was removed.
 *   v1.19.0 -- 2026-11-08 -- The page explains itself the designed way (.claude/rules/page-guidance.md):
 *     PageStart "portfolio" in the start slot (folded once a page is stored; its button opens the
 *     builder) and the title's question mark concept.portfolio. Section 05 loses its lead paragraph
 *     (pfpage.aiIntro), which explained the concept; the concept says it now, and the section keeps
 *     the rule to copy and the limits of a publish.
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
import { FoldSection } from '/components/FoldSection.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Facts } from '/components/Facts.js';
import { Tinted } from '/components/Figure.js';
import { Box } from '/components/Box.js';
import { Roads, Road } from '/components/Roads.js';
import { List, Row, Thumb, Tick, Name, Doors } from '/components/List.js';
import { Select } from '/components/Select.js';
import { PagePreview } from '/components/PagePreview.js';
import { TextArea } from '/components/TextField.js';
import { FileDrop } from '/components/FileDrop.js';
import { Mark, Label, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { x, apexUrl, dateWord, timeWord, writtenBy, crumb, pageLinks } from './frame.js';
import { Hint } from '/components/Hint.js';
import { PageStart } from '/components/PageStart.js';

const copyDoor = (text, label, onCopied) => html`<${Action} small copy=${text} copiedLabel=${t('common.copied')} onCopied=${onCopied}>${label}<//>`;
const openDoor = (href, words, soft = true) => html`<${Action} small soft=${soft} href=${href} newTab>${words}<//>`;

export function renderPage(ctx) {
  const d = ctx.data;            // null while loading
  const cfg = d?.config || null;
  const hasPage = !!d?.html;     // a stored file, published or not
  const isOn = hasPage && !!cfg?.enabled;
  const state = !d ? 'loading' : !hasPage ? 'none' : isOn ? 'on' : 'off';
  const stored = state === 'on' || state === 'off';
  // What is drawn in each state, numbered after the filter so a section that is not drawn leaves no
  // gap: with no page, the first page and the AI's rule; a page off the web has no addresses to give;
  // the ways to change the page and the AI's rule are rows that open in place.
  const rail = [
    state === 'none' ? { id: 'pf-first', label: x('secFirst') } : null,
    state === 'on' ? { id: 'pf-addresses', label: x('secAddresses'), count: ctx.standaloneUrl ? '2' : '1' } : null,
    stored ? { id: 'pf-visibility', label: x('secVisibility') } : null,
    stored ? { id: 'pf-page', label: x('secPage'), count: x('kb', { n: d.html.size_kb }) } : null,
    stored ? { id: 'pf-change', label: x('secChange') } : null,
    state !== 'loading' ? { id: 'pf-ai', label: x('secAi') } : null,
  ].filter(Boolean).map((s, i) => ({ count: '', ...s, num: String(i + 1).padStart(2, '0') }));
  const numOf = Object.fromEntries(rail.map((s) => [s.id, s.num]));

  // The start: folded once a page is stored; its button opens the builder.
  const start = html`<${PageStart} id="portfolio" done=${state === 'loading' ? null : hasPage}
    action=${{ onClick: () => ctx.navigate('/v1/portfolio') }} />`;
  return html`
    <${SettingsPage} name="portfolio"
      crumb=${crumb()}
      ...${mast(ctx, state)}
      help="concept.portfolio"
      start=${start}
      strip=${strip(ctx, state)}
      railTitle=${x('railTitle')}
      sections=${rail.length > 1 ? rail : undefined}
      pagesLabel=${x('pages')}
      pages=${pageLinks(ctx.navigate)}
      after=${html`
        <${FileDrop} hidden accept=".html,.htm,text/html" inputRef=${ctx.fileRef} onChange=${(e) => ctx.readFile(e)} />
        <${ctx.ConfirmUI} />`}>
      ${state === 'loading' ? html`<${Note} kind="loading">${x('loading')}<//>` : null}
      ${state === 'none' ? secFirst(ctx, numOf['pf-first']) : null}
      ${state === 'on' ? secAddresses(ctx, numOf['pf-addresses']) : null}
      ${stored ? secVisibility(ctx, state, numOf['pf-visibility']) : null}
      ${stored ? secPage(ctx, state, numOf['pf-page']) : null}
      ${stored ? secChange(ctx, numOf['pf-change']) : null}
      ${state !== 'loading' ? secAgent(ctx, state, numOf['pf-ai']) : null}
    <//>`;
}

/**
 * Who may open the page, in words: the setting's value (`access`: anyone, signed-in, organism:<id>)
 * with the name of the organism, and, on a server that shows its pages to signed-in people only
 * (js/site.js signedInOnly), "anyone" said as what it is there. `open` is the kind the page is open to.
 */
function accessSaid(ctx) {
  const a = ctx.access || 'anyone';
  if (a === 'anyone') return { open: ctx.nodeSignedInOnly ? 'signed-in' : 'anyone', org: '' };
  if (a === 'signed-in') return { open: 'signed-in', org: '' };
  const id = a.slice('organism:'.length);
  const known = (ctx.organisms || []).find((o) => o.id === id);
  return { open: 'organism', org: known ? known.name : ctx.organisms ? x('access.organismUnknown') : '…' };
}

/** A style or a kind of page in the reader's words; a value the page has no word for is shown as it is. */
const choiceWord = (kind, v) => { if (!v) return ''; const k = `pfpage.${kind}.${v}`; const w = t(k); return w === k ? v : w; };

/** The head: the title, its tags and line, the loud action and the doors, as SettingsPage props. */
function mast(ctx, state) {
  const d = ctx.data;
  const cfg = d?.config;
  const others = Math.max(0, (ctx.members ?? 0) - (state === 'on' ? 1 : 0));
  // A page that needs a sign-in is on the web, not public, and no search engine reads it.
  const { open } = accessSaid(ctx);
  const openChip = open === 'anyone' ? { label: x('chipPublic'), tone: 'sun' } : { label: open === 'signed-in' ? x('chipSignedIn') : x('chipOrganism'), tone: 'sun' };
  const marks = state === 'on'
    ? [openChip, { label: cfg?.seoIndex && open === 'anyone' ? x('chipSearch') : x('chipNoSearch') }, { label: x('chipShowcase') }, { label: `${x('kb', { n: d.html.size_kb })} · ${dateWord(d.html.stored_at)}` }]
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
      // While a pasted page waits under "Changing the page", its Publish is the loud action.
      : html`<${Loud} quiet=${!!(ctx.paste || '').trim()} onClick=${() => ctx.copyAiRequest()}>${x('askAi')}<//>`;
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
  if (state === 'loading') return html`<${FigureStrip} loading=${3} />`;
  // With no page there is nothing to count: the reserved address, the ways to a page and the other
  // people's pages were a band of figures that said nothing to act on. The first section says it.
  if (state === 'none') return null;
  // The number of addresses is in section 01's count and its rows; the strip keeps the state.
  if (state === 'off') {
    return html`<${FigureStrip} items=${[
      { key: 'off', n: x('stripOff'), tone: 'coral', label: x('stripOffLabel'), sub: x('stripOffSub') },
      { key: 'published', n: dateWord(d.html.stored_at), label: x('stripPublished'), sub: `${x('kb', { n: d.html.size_kb })}${cfg?.designStyle ? ` · ${choiceWord('style', cfg.designStyle)}` : ''}` },
      { key: 'showcase', n: others ?? '…', label: x('stripShowcase'), sub: x('stripShowcaseOff') },
    ]} />`;
  }
  const said = accessSaid(ctx);
  const openFigure = said.open === 'anyone'
    ? { n: x('stripPublic'), sub: cfg?.seoIndex ? x('stripSearchOn') : x('stripSearchOff') }
    : said.open === 'signed-in'
      ? { n: x('stripSignedIn'), sub: x('stripSignedInSub') }
      : { n: x('stripMembers'), sub: x('stripMembersSub', { org: said.org }) };
  return html`<${FigureStrip} items=${[
    { key: 'published', n: dateWord(d.html.stored_at), label: x('stripPublished'), sub: [timeWord(d.html.stored_at), x('kb', { n: d.html.size_kb }), choiceWord('style', cfg?.designStyle)].filter(Boolean).join(' · ') },
    { key: 'public', n: openFigure.n, tone: 'coral', label: x('stripPublicLabel'), sub: openFigure.sub },
    { key: 'showcase', n: m ?? '…', label: x('stripShowcase'), sub: others != null ? x('stripShowcaseSub', { n: others }) : '' },
  ]} />`;
}

function secAddresses(ctx, n) {
  const url = apexUrl(ctx.ownerName);
  const badgeOn = ctx.data.config?.showBadge !== false;
  const copied = () => ctx.toast(x('copiedAddress'));
  const own = ctx.standaloneUrl;
  return html`
    <${PageSection} id="pf-addresses" num=${n} title=${x('secAddresses')} count=${own ? '2' : '1'} first=${true}>
      <${Facts} rows=${[
        { k: x('addressNode'), v: url, sub: x('addressNodeSub'),
          actions: html`${copyDoor(url, t('common.copy'), copied)}${openDoor(url, x('open'))}` },
        own && { k: x('addressOwn'), v: own, sub: `${x('addressOwnSub')} ${badgeOn ? x('badgeOn') : x('badgeOff')}`,
          actions: html`${copyDoor(own, t('common.copy'), copied)}${openDoor(own, x('open'))}<${Action} small soft disabled=${ctx.busy === 'badge'} onClick=${() => ctx.setBadge(!badgeOn)}>${badgeOn ? x('hideBadge') : x('showBadge')}<//>` },
      ]} />
      <${Hint}>${own ? x('hintAddresses') : x('hintAddressOne')}<//>
    <//>`;
}

function secVisibility(ctx, state, n) {
  const cfg = ctx.data.config || {};
  const off = state === 'off';
  const others = Math.max(0, (ctx.members ?? 1) - (off ? 0 : 1));
  // A state word in its colour: on in the fine colour, off in coral (main's b.is-on / b.is-off).
  const said = (tone, word, rest) => html`<${Tinted} strong tone=${tone}>${word}<//> ${rest}`;
  // Off the web, "Make it public again" is the head's loud action; here the same act is a quiet one.
  const webDoor = off
    ? html`<${Action} small disabled=${ctx.busy === 'enable'} onClick=${() => ctx.setEnabled(true)}>${x('republish')}<//>`
    : html`<${Action} small soft tone="danger" disabled=${ctx.busy === 'enable'} onClick=${() => ctx.setEnabled(false)}>${x('unpublish')}<//>`;
  // Who may open it decides what "on the web" means and whether a search engine can read the page.
  const who = accessSaid(ctx);
  const limited = who.open !== 'anyone';
  const webOn = who.open === 'anyone' ? said('fine', x('visWebOn'), x('visWebOnSub'))
    : who.open === 'signed-in' ? said('fine', x('visWebOnLimited'), x('visWebOnSignedInSub'))
      : said('fine', x('visWebOnLimited'), x('visWebOnOrganismSub', { org: who.org }));
  const search = off
    ? said(undefined, x('visSearchOffWeb'), cfg.seoIndex ? x('visSearchOffWebAllowed') : x('visSearchOffWebDenied'))
    : limited ? said(undefined, x('visSearchOffWeb'), x('visSearchLimitedSub'))
      : cfg.seoIndex ? said('fine', x('visSearchOn'), x('visSearchOnSub')) : said(undefined, x('visSearchOff'), x('visSearchOffSub'));
  const accessValue = who.open === 'anyone' ? said('fine', x('access.valueAnyone'), x('access.anyoneSub'))
    : who.open === 'signed-in' ? said('notice', x('access.valueSignedIn'), ctx.access === 'anyone' ? x('access.anyoneNodeSignedIn') : x('access.signedInSub'))
      : said('notice', x('access.valueOrganism', { org: who.org }), x('access.organismNamedSub', { org: who.org }));
  // The choices open right under the row that changes them, so the rows after it are split off.
  return html`
    <${PageSection} id="pf-visibility" num=${n} title=${x('secVisibility')} count=${x('secVisibilitySub')} first=${off}>
      <${Facts} rows=${[
        { k: x('visWeb'), v: off ? said('notice', x('visWebOff'), x('visWebOffSub')) : webOn,
          sub: x('visWebHint'), actions: webDoor },
        { k: x('visAccess'), v: accessValue, sub: x('visAccessHint'),
          actions: html`<${Action} small soft pressed=${ctx.accessOpen} disabled=${ctx.busy === 'access'} onClick=${() => ctx.toggleAccess()}>${ctx.accessOpen ? x('access.close') : x('access.change')}<//>` },
      ]} />
      ${ctx.accessOpen ? accessChoices(ctx) : null}
      <${Facts} rows=${[
        { k: x('visSearch'), v: search, sub: x('visSearchHint'),
          actions: off || limited ? null : html`<${Action} small soft disabled=${ctx.busy === 'seo'} onClick=${() => ctx.setSeo(!cfg.seoIndex)}>${cfg.seoIndex ? x('searchOff') : x('searchOn')}<//>` },
        { k: x('visShowcase'), v: off ? said(undefined, x('visShowcaseOff'), x('visShowcaseOffSub')) : said('fine', x('visShowcaseOn'), x('visShowcaseOnSub', { n: others })),
          sub: x('visShowcaseHint'), actions: openDoor('/v1/members', x('openShowcase')) },
      ]} />
    <//>`;
}

/**
 * The three choices of who may open the page, one row each: what happens when it is chosen, and the
 * press that chooses it. "One organism" picks from the organisms the person is an active member of,
 * the only ones the server accepts (services/page/access.ts parsePageAccessInput).
 */
function accessChoices(ctx) {
  const current = ctx.access || 'anyone';
  const orgs = ctx.organisms;
  const onOrg = current.startsWith('organism:');
  const busy = ctx.busy === 'access';
  const choose = (value, words = x('access.choose')) => html`<${Action} small row disabled=${busy} onClick=${() => ctx.setAccess(value)}>${words}<//>`;
  const chosen = html`<${Mark} kind="status" tone="fine">${x('access.chosen')}<//>`;
  const orgDoors = orgs === null
    ? html`<${Mark} tone="dim">${x('access.loadingOrganisms')}<//>`
    : !orgs.length ? null
      : html`
        <${Select} fit ariaLabel=${x('access.pickOrganism')} value=${ctx.orgPick} disabled=${busy}
          onChange=${(v) => ctx.setOrgPick(v)} options=${orgs.map((o) => [o.id, o.name])} />
        ${onOrg && current === `organism:${ctx.orgPick}` ? chosen : choose(`organism:${ctx.orgPick}`)}`;
  return html`
    <${List} cols="mark-name-doors" keepCols>
      <${Row} key="anyone">
        <${Tick} bare state=${current === 'anyone' ? 'done' : 'off'} />
        <${Name} desc=${ctx.nodeSignedInOnly ? x('access.anyoneDescNode') : x('access.anyoneDesc')}>${x('access.anyone')}<//>
        <${Doors}>${current === 'anyone' ? chosen : choose('anyone')}<//>
      <//>
      <${Row} key="signed-in">
        <${Tick} bare state=${current === 'signed-in' ? 'done' : 'off'} />
        <${Name} desc=${x('access.signedInDesc')}>${x('access.signedIn')}<//>
        <${Doors}>${current === 'signed-in' ? chosen : choose('signed-in')}<//>
      <//>
      <${Row} key="organism">
        <${Tick} bare state=${onOrg ? 'done' : 'off'} />
        <${Name} desc=${orgs && !orgs.length ? x('access.noOrganisms') : x('access.organismDesc')}>${x('access.organism')}<//>
        <${Doors}>${orgDoors}<//>
      <//>
    <//>`;
}

function secPage(ctx, state, n) {
  const d = ctx.data;
  const cfg = d.config || {};
  const title = ctx.title || x('untitled');
  const by = writtenBy(cfg, ctx.ai);
  const choices = [choiceWord('style', cfg.designStyle), choiceWord('type', cfg.portfolioType), (cfg.authGates || []).length ? x('gatesN', { n: cfg.authGates.length }) : x('gatesNone')].filter(Boolean);
  const on = state === 'on';
  return html`
    <${PageSection} id="pf-page" num=${n} title=${x('secPage')} count=${x('kb', { n: d.html.size_kb })}>
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

/**
 * The ways to change the page: one row that opens in place. The head's loud action already asks the
 * AI, so the three ways are a secondary tool; a pasted page keeps the row open until it is published
 * or cleared.
 */
function secChange(ctx, n) {
  const open = ctx.changeOpen || !!(ctx.paste || '').trim();
  return html`
    <${FoldSection} id="pf-change" num=${n} title=${x('secChange')} sub=${x('secChangeSub')} open=${open} onToggle=${() => ctx.toggleChange()}>
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
        doors=${html`<${Action} small onClick=${() => ctx.copyAiRequest()}>${t('common.copyForAi')}<//>`} />
      <${Road} name=${x('roadBuilder')} text=${hasPage ? x('roadBuilderBody') : x('roadBuilderBodyNew')}
        doors=${html`<${Action} small onClick=${() => ctx.navigate('/v1/portfolio')}>${x('openBuilder')}<//>`} />
      <${Road} name=${x('roadImport')} text=${x('roadImportBody', { max: ctx.maxKb })} doors=${importDoors}>
        <${TextArea} rows=${6} placeholder=${x('pastePlaceholder')} ariaLabel=${x('roadImport')} value=${ctx.paste}
          onInput=${(v) => ctx.setPaste(v)} ...${size} />
      <//>
    <//>`;
}

function secFirst(ctx, n) {
  const mat = ctx.matPrompt ? `${ctx.matPrompt.slice(0, 420)}${ctx.matPrompt.length > 420 ? '…' : ''}` : null;
  return html`
    <${PageSection} id="pf-first" num=${n} title=${x('secFirst')} count=${x('secFirstSub')} first=${true}>
      <${Note} kind="quiet"><b>${x('emptyNone')}</b> ${x('emptyNoneSub')}<//>
      <${Roads} cols="three" wide>
        <${Road} lead name=${x('roadMat')} text=${x('roadMatBody')} code=${mat}
          doors=${html`<${Action} small disabled=${ctx.busy === 'mat'} onClick=${() => ctx.copyMatPrompt()}>${t('common.copyForAi')}<//><${Action} small soft onClick=${() => ctx.navigate('/v1/home')}>${x('goHome')}<//>`} />
        <${Road} name=${x('roadAi')} text=${x('roadAiBodyNew')}
          doors=${html`<${Action} small onClick=${() => ctx.copyAiRequest()}>${t('common.copyForAi')}<//>`} />
        <${Road} name=${x('roadBuilder')} text=${x('roadBuilderBodyNew')}
          doors=${html`<${Action} small onClick=${() => ctx.navigate('/v1/portfolio')}>${x('openBuilder')}<//>`} />
      <//>
    <//>`;
}

/** The rule an agent gets and what a publish does: one row that opens in place, in every state. */
function secAgent(ctx, state, n) {
  return html`
    <${FoldSection} id="pf-ai" num=${n} title=${x('secAi')} sub=${x('secAiSub')} open=${ctx.aiOpen} onToggle=${() => ctx.toggleAi()}>
      <${Box} doors=${html`<${Action} small onClick=${() => ctx.copyRule()}>${t('common.copyForAi')}<//>`}>
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
