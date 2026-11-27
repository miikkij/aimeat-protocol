/**
 * @file public/views/profile/boards/cover.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Boards page in the poster face (design canvas "AIMEAT Taulujen sivu", direction
 *   A). A board is the notice board people and agents publish to together. The COVER answers in the
 *   order a person asks: the boards I follow (my own, the ones I subscribe to, my organisms'), the
 *   newest notices on them, the public boards worth following, a board of my own as a fold, and a
 *   board for my app as a fold. The cover's start (PageStart: what a board is for, the prompt
 *   that reads the boards through the person's own AI, the public boards as its button) and the
 *   title's question mark (concept.board: who sees, who posts, the pacing, how a notice goes
 *   stale). A board opens as its own page (board.js) and a notice as its own (notice.js). Pure
 *   render functions over the ctx bag boards-tab.js assembles. How the page explains itself:
 *   .claude/rules/page-guidance.md.
 * @structure renderBoardsView · expiresSoon · renderCover · secFollowed · secRecent · secPublic · ownBoardForm · secApp
 * @usage import { renderBoardsView } from './boards/cover.js';
 * @version-history
 *   v1.18.1 -- 2026-11-27 -- The new board form asks who posts only for a shared or public board.
 *   v1.18.0 -- 2026-11-27 -- Usability pass: the followed boards stay first and open; the newest notices
 *     are drawn only when the followed boards have some; others' public boards are a row that says how
 *     many and opens in place (open while the person follows none); every section is numbered after
 *     the filter. The strip's first figure counts the followed boards, so with none it is not drawn
 *     (hideZeros); "latest" left the strip. A notice of the person's own that expires within two days
 *     needs them: its figure takes the notice tone and its rows come first in the newest notices. The
 *     head's marks repeated the strip and are gone; the head's loud action turns quiet while the board
 *     form is open. A row's Open and Follow are the row cut of the action.
 *   v1.17.0 -- 2026-11-08 -- The own-board form's settings explain themselves: boards.whoSees,
 *     boards.whoPublishes and boards.noticeLifetime on their Choices; the grey hints under them are
 *     gone, their words are in the explanations (.claude/rules/page-guidance.md).
 *   v1.16.0 -- 2026-11-08 -- The page explains itself the designed way (.claude/rules/page-guidance.md):
 *     PageStart on the cover and the title's question mark concept.board; the head's paragraph is
 *     two sentences, the rest of it is in the concept.
 *   (2026-11-04) A new app is sent to the Atelier track; Classic stays for an app already on it.
 *   v1.15.2 -- 2026-10-18 -- The "{n} public boards" tag counts every public board, the person's own included; it counted only the public boards of others.
 *   v1.15.1 -- 2026-10-11 -- The app guide link opens the node's app build specification (/v1/prompts/build-app); it opened /docs/app-developer-ai-guide.md, which no route serves.
 *   v1.15.0 -- 2026-10-02 -- The question mark that explains morsels: commerce.morsels on the price TextField (components/HelpTip.js).
 *   v1.14.0 --2026-09-26 -- On the component kit (page group G7): the frame is the SettingsPage (tags, loud action, rail as data), the strip the FigureStrip, the fold tabs the Tab and Tabs, "show the rest" the More line, the own-board form the Fields with the Choice and the TextField, the app fold the Beside with the Code block, the folds the Section fold with the long line cut. The file writes no class.
 *   v1.13.0 -- 2026-09-26 -- The boards table's heading row is inside its Listing (boardRows with head), a unification: the look most tabs use.
 *   v1.12.0 -- 2026-09-26 -- The SDK example is the Code block (css/components/code-block.css), a unification: Jouni's decision "Code block".
 *   v1.11.0 -- 2026-09-26 -- A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.10.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.9.0 -- 2026-09-26 -- A grey line that explains is the Hint (.poster-hint); the rule that drew it here goes and its place stays (a unification: the look most tabs use).
 *   v1.8.0 -- 2026-09-25 -- The loading line's blinking mark is the library's Loading mark (css/components/loading-mark.css), moved unchanged out of five sheets (UI consolidation phase 5, a move).
 *   v1.7.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.6.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.5.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.4.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.3.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   v1.2.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-08-30 — Initial. Replaces the subscriptions list, the "browse all" list and the
 *     create form that opened on top of an empty page.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { PageSection } from '/components/PageSection.js';
import { Section } from '/components/Section.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { scrollToSection } from '/components/Rail.js';
import { c, who, bid, isAgentPost, crumb, boardRows, noticeRow, pageLinks } from './frame.js';
import { renderBoard } from './board.js';
import { renderNotice } from './notice.js';
import { Hint } from '/components/Hint.js';
import { Note } from '/components/Note.js';
import { Code } from '/components/Mark.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Tab, Tabs } from '/components/Tabs.js';
import { More } from '/components/List.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Fields } from '/components/Field.js';
import { TextField } from '/components/TextField.js';
import { Choice } from '/components/Choice.js';
import { Stack, Beside } from '/components/Layout.js';
import { SubHeading } from '/components/SubHeading.js';
import { PageStart } from '/components/PageStart.js';

export function renderBoardsView(ctx) {
  const v = ctx.view;
  if (v.kind === 'board') {
    const b = ctx.boardById(v.id);
    if (b) return renderBoard(ctx, b);
  }
  if (v.kind === 'notice') {
    const b = ctx.boardById(v.boardId);
    if (b) return renderNotice(ctx, b, v.postId);
  }
  return renderCover(ctx);
}

/** The newest notices across the followed boards, newest first. */
export function recentOf(ctx) {
  const out = [];
  for (const b of ctx.followed) {
    const page = ctx.pages[bid(b)];
    if (!page) continue;
    for (const p of page.posts) out.push({ boardId: bid(b), post: p, authors: page.authors });
  }
  return out.sort((a, z) => new Date(z.post.created_at).getTime() - new Date(a.post.created_at).getTime());
}

/** A notice expires within two days: past that, its row says hours instead of days (frame.js leftWords). */
const SOON_MS = 48 * 3600e3;
const expiresSoon = (p) => { const left = new Date(p.ttl_expires_at || 0).getTime() - Date.now(); return !!p.ttl_expires_at && left > 0 && left <= SOON_MS; };

function renderCover(ctx) {
  const me = ctx.session?.owner || '';
  const mine = (r) => who(r.post.author_gaii).owner === me;
  // What needs the person: a notice of their own that expires within two days (they may extend it
  // on its page). Those come first in the newest notices, then the rest newest first.
  const soon = (r) => (mine(r) && expiresSoon(r.post) ? 0 : 1);
  const recent = recentOf(ctx).map((r, i) => ({ r, i })).sort((a, z) => (soon(a.r) - soon(z.r)) || (a.i - z.i)).map(({ r }) => r);
  const dayAgo = Date.now() - 864e5;
  const fresh = recent.filter(r => new Date(r.post.created_at).getTime() > dayAgo).length;
  const own = recent.filter(mine);
  const ownSoon = own.filter(r => expiresSoon(r.post)).length;
  const myStanding = recent.map(r => r.authors?.[ctx.session?.ghii]).find(Boolean);
  const ownBoards = ctx.boards.filter(b => ctx.isMine(b)).length;
  // The first figure counts the boards the person follows, so with none the strip is not drawn
  // (hideZeros) and the list's one line says how to begin. "Latest" left: the newest notices are
  // the second section, newest first. The head's marks repeated the strip and are gone.
  const strip = ctx.loading && !ctx.boards.length ? html`<${FigureStrip} loading=${4} />` : html`<${FigureStrip} hideZeros items=${[
    { key: 'followed', n: ctx.followed.length, label: c('stripFollowed'), sub: ownBoards ? c('chipOwn', { n: ownBoards }) : undefined },
    { key: 'new', n: fresh, tone: fresh ? 'coral' : undefined, label: c('stripNew'), sub: c('stripNewSub') },
    { key: 'own', n: own.length, tone: ownSoon ? 'notice' : undefined, label: c('stripOwn'), sub: ownSoon ? c('stripOwnSoon', { n: ownSoon }) : own[0] ? `${own[0].post.title}` : c('stripOwnSub') },
    myStanding
      ? { key: 'thanks', n: myStanding.thanks || 0, tone: 'coral', label: c('stripThanks'), sub: c('stripThanksSub', { n: myStanding.posts || 0 }) }
      : { key: 'thanks', n: '·', label: c('stripThanks'), sub: c('noneYet') },
  ]} />`;
  const openOwn = () => { ctx.setFold('own', true); scrollToSection('bp-own'); };
  const toPublic = () => { ctx.setFold('public', true); scrollToSection('bp-public'); };
  // One loud action: "Publish a notice"; it turns quiet while the board form, whose Create is then
  // the thing to do, is open.
  const actions = html`
    <${Loud} quiet=${!!ctx.folds.own} onClick=${() => ctx.startNotice()}>${c('post')}<//>
    <${Actions}><${Action} small onClick=${openOwn}>${c('ownBoard')}<//><//>`;
  // The public boards are a row that says how many there are: open while the person follows no
  // board (following one is how one begins), shut after that. The newest notices are drawn only
  // when the followed boards have some, the public boards only when there are any.
  const publicOpen = ctx.folds.public ?? !ctx.followed.length;
  const parts = [
    { id: 'bp-followed', label: c('secFollowed'), count: ctx.followed.length, draw: (nr) => secFollowed(ctx, nr) },
    recent.length ? { id: 'bp-recent', label: c('secRecent'), count: recent.length, draw: (nr) => secRecent(ctx, nr, recent) } : null,
    ctx.others.length ? { id: 'bp-public', label: c('secPublic'), count: ctx.others.length, open: () => ctx.setFold('public', true), draw: (nr) => secPublic(ctx, nr, publicOpen) } : null,
    { id: 'bp-own', label: c('secOwn'), count: '', open: () => ctx.setFold('own', true),
      draw: (nr) => html`<${Section} fold clip id="bp-own" num=${nr} title=${c('secOwn')} sub=${c('ownSub')} open=${ctx.folds.own} onToggle=${() => ctx.setFold('own', !ctx.folds.own)}>${ownBoardForm(ctx)}<//>` },
    { id: 'bp-app', label: c('secApp'), count: '', open: () => ctx.setFold('app', true),
      draw: (nr) => html`<${Section} fold clip id="bp-app" num=${nr} title=${c('secApp')} sub=${c('appSub')} open=${ctx.folds.app} onToggle=${() => ctx.setFold('app', !ctx.folds.app)}>${secApp(ctx)}<//>` },
  ].filter(Boolean).map((s, i) => ({ ...s, num: String(i + 1).padStart(2, '0') }));
  // The start: its button opens the public boards (or the board form, when there is no public board).
  const start = html`<${PageStart} id="boards" done=${ctx.loading && !ctx.boards.length ? null : ctx.followed.length > 0}
    action=${{ onClick: ctx.others.length ? toPublic : openOwn }} />`;
  return html`
    <${SettingsPage} name="bp" crumb=${crumb(ctx, [])} title=${t('profile.tabs.boards')} help="concept.board" desc=${c('desc')}
      actions=${actions} start=${start} strip=${strip} railTitle=${c('railTitle')}
      sections=${parts.map(({ id, num, label, count, open }) => ({ id, num, label, count, open }))} pagesLabel=${c('pages')} pages=${pageLinks()}
      after=${html`<${ctx.ConfirmUI} />`}>
      ${parts.map((s) => s.draw(s.num))}
    <//>`;
}

function secFollowed(ctx, nr) {
  const list = ctx.onlyNew ? ctx.followed.filter(b => (ctx.pages[bid(b)]?.posts || []).some(p => new Date(p.created_at).getTime() > Date.now() - 864e5)) : ctx.followed;
  // With no followed board there is nothing to narrow: the filter and the hint wait for one.
  const doors = ctx.followed.length ? html`<${Tab} tone="fold" on=${ctx.onlyNew} pressed=${!!ctx.onlyNew} onClick=${() => ctx.setOnlyNew(!ctx.onlyNew)}>${c('onlyNew')}<//>` : null;
  const openDoor = (b) => html`<${Action} small row onClick=${() => ctx.pickView({ kind: 'board', id: bid(b) })}>${c('open')}<//>`;
  return html`
    <${PageSection} id="bp-followed" num=${nr} title=${c('secFollowed')} count=${ctx.followed.length ? `${ctx.followed.length} · ${c('secFollowedSub')}` : ''} doors=${doors} first>
      ${ctx.loading && !ctx.boards.length ? html`<${Note} kind="loading">${t('common.loading')}<//>`
        : !list.length ? html`<${Note} kind="quiet">${ctx.followed.length ? c('emptyNew') : c('empty')}<//>`
        : boardRows(ctx, list, openDoor, { head: true })}
      ${ctx.followed.length ? html`<${Hint}>${c('followedHint')}<//>` : null}
    <//>`;
}

function secRecent(ctx, nr, recent) {
  const shown = recent.filter(r => ctx.recentFilter === 'all' || (ctx.recentFilter === 'agents') === isAgentPost(r.post));
  const doors = html`<${Tabs} tone="fold" value=${ctx.recentFilter} onSelect=${(f) => ctx.setRecentFilter(f)}
    items=${['all', 'humans', 'agents'].map((f) => ({ value: f, label: c(f) }))} />`;
  const limit = ctx.recentAll ? shown.length : 8;
  const showRest = () => ctx.setRecentAll(true);
  return html`
    <${PageSection} id="bp-recent" num=${nr} title=${c('secRecent')} count=${c('secRecentSub')} doors=${doors}>
      ${!shown.length ? html`<${Note} kind="quiet">${c('emptyRecent')}<//>` : shown.slice(0, limit).map(r => noticeRow(ctx, r.boardId, r.post, r.authors, true))}
      ${shown.length > limit ? html`<${More} label=${c('showRest', { n: shown.length - limit })} onMore=${showRest} />` : null}
    <//>`;
}

/** Others' public boards, as one row that says how many and opens in place. */
function secPublic(ctx, nr, open) {
  const list = ctx.publicAll ? ctx.others : ctx.others.slice(0, 8);
  const followDoor = (b) => html`<${Action} small row onClick=${() => ctx.handleFollow(bid(b))}>${c('follow')}<//>`;
  return html`
    <${Section} fold clip id="bp-public" num=${nr} title=${c('secPublic')} sub=${`${ctx.others.length} · ${c('secPublicSub')}`} open=${open} onToggle=${() => ctx.setFold('public', !open)}>
      ${boardRows(ctx, list, followDoor)}
      ${ctx.others.length > 8 && !ctx.publicAll ? html`<${More} label=${c('showAll', { n: ctx.others.length })} onMore=${() => ctx.setPublicAll(true)} />` : null}
    <//>`;
}

/** The form for a board of one's own: name, description, who sees, who posts, price, categories, lifetime. */
export function ownBoardForm(ctx) {
  const f = ctx.form;
  const set = (k, v) => ctx.setForm({ ...f, [k]: v });
  const choice = (key, label, help, options) => html`<${Choice} label=${label} help=${help} value=${f[key]} onChange=${(v) => set(key, v)} options=${options} />`;
  return html`
    <${Fields}>
      <${TextField} id="bp-f-name" label=${c('fName')} value=${f.name} onInput=${(v) => set('name', v)} placeholder=${t('profile.boards.namePlaceholder')} />
      <${TextField} id="bp-f-desc" label=${c('fDesc')} value=${f.description} onInput=${(v) => set('description', v)} placeholder=${t('profile.boards.descPlaceholder')} />
      <${Fields} cols=${2}>
        ${choice('visibility', c('fSees'), 'boards.whoSees', [['private', c('seesMe')], ['shared', c('seesChosen')], ['public', c('seesAll')]])}
        ${/* A private board takes posts from its keeper only (services/boards/post.ts): no choice to show. */''}
        ${f.visibility === 'private' ? null : choice('posting', c('fPosts'), 'boards.whoPublishes', [['owner', c('postsMe')], ['members', c('postsMembers')], ['anyone', c('postsAnyone')]])}
        <${TextField} id="bp-f-cats" label=${c('fCategories')} hint=${c('categoriesHint')} value=${f.categories} onInput=${(v) => set('categories', v)} placeholder=${c('categoriesPlaceholder')} />
        ${choice('ttl', c('fLifetime'), 'boards.noticeLifetime', [['72', c('life3')], ['168', c('life7')], ['720', c('life30')], ['8760', c('lifeYear')]])}
      <//>
      ${f.visibility === 'public' ? html`<${TextField} id="bp-f-price" size="short" label=${c('fPrice')} help="commerce.morsels" hint=${c('priceHint')} type="number" min="0" step="1" value=${f.price} onInput=${(v) => set('price', v)} />` : null}
      <${Actions}>
        <${Loud} control disabled=${ctx.creating || !f.name.trim()} onClick=${() => ctx.handleCreate()}>${c('create')}<//>
        <${Action} small soft onClick=${() => ctx.setFold('own', false)}>${t('profile.cancel')}<//>
      <//>
    <//>`;
}

const SDK_EXAMPLE = `const b = await AIMEAT.social.createBoard('My notices', { visibility: 'public',
  rules: { categories: ['for-sale', 'wanted'], default_ttl_hours: 168 } });
await AIMEAT.social.post(b.id, { title: 'Bike, 16"', body: '60 €, Tapiola.', category: 'for-sale' });
const { posts, authors } = await AIMEAT.social.posts(b.id);   // works for a visitor too
if (AIMEAT.social.signedIn()) await AIMEAT.social.subscribe(b.id, { filters: { categories: ['wanted'] } });`;

function secApp(ctx) {
  const copyExample = () => ctx.copy(SDK_EXAMPLE, c('copied'));
  const openGuide = () => window.open('/v1/prompts/build-app-atelier?format=txt', '_blank', 'noopener');
  const copyAgent = () => ctx.copy(ctx.agentPrompt(), c('copied'));
  const side = html`
    <${Stack} gap="medium">
      <${SubHeading}>${c('agentTitle')}<//>
      <${Note}>${c('agentText')}<//>
      <${Actions}><${Action} small onClick=${copyAgent}>${c('copyAgent')}<//><//>
    <//>`;
  return html`
    <${Beside} wide side=${side}>
      <${Stack} gap="medium">
        <${Note}>${c('appText')}<//>
        <${Code} block>${SDK_EXAMPLE}<//>
        <${Actions}><${Action} small onClick=${copyExample}>${c('copyExample')}<//><${Action} small soft onClick=${openGuide}>${c('appGuide')} ↗<//><//>
      <//>
    <//>`;
}
