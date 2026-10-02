/**
 * @file public/views/profile/boards/cover.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Boards page in the poster face (design canvas "AIMEAT Taulujen sivu", direction
 *   A). A board is the notice board people and agents publish to together. The COVER answers in the
 *   order a person asks: the boards I follow (my own, the ones I subscribe to, my organisms'), the
 *   newest notices on them, the public boards worth following, a board of my own as a fold, and a
 *   board for my app as a fold. A board opens as its own page (board.js) and a notice as its own
 *   (notice.js). Pure render functions over the ctx bag boards-tab.js assembles.
 * @structure renderBoardsView · renderCover · secFollowed · secRecent · secPublic · ownBoardForm · secApp
 * @usage import { renderBoardsView } from './boards/cover.js';
 * @version-history
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
import { c, rel, who, bid, isAgentPost, crumb, boardRows, noticeRow, pageLinks } from './frame.js';
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

function renderCover(ctx) {
  const recent = recentOf(ctx);
  const dayAgo = Date.now() - 864e5;
  const fresh = recent.filter(r => new Date(r.post.created_at).getTime() > dayAgo).length;
  const me = ctx.session?.owner || '';
  const own = recent.filter(r => who(r.post.author_gaii).owner === me);
  const myStanding = recent.map(r => r.authors?.[ctx.session?.ghii]).find(Boolean);
  const latest = recent[0];
  const ownBoards = ctx.boards.filter(b => ctx.isMine(b)).length;
  const chip = (n, key, tone) => ({ label: c(key, { n }), tone });
  const strip = html`<${FigureStrip} items=${[
    { n: fresh, tone: fresh ? 'coral' : undefined, label: c('stripNew'), sub: c('stripNewSub') },
    latest
      ? { n: rel(latest.post.created_at), label: c('stripLatest'), sub: `${ctx.boardById(latest.boardId)?.name} · ${who(latest.post.author_gaii).label} · "${latest.post.title}"` }
      : { n: '·', label: c('stripLatest'), sub: c('noneYet') },
    { n: own.length, label: c('stripOwn'), sub: own[0] ? `${own[0].post.title}` : c('stripOwnSub') },
    myStanding
      ? { n: myStanding.thanks || 0, tone: 'coral', label: c('stripThanks'), sub: c('stripThanksSub', { n: myStanding.posts || 0 }) }
      : { n: '·', label: c('stripThanks'), sub: c('noneYet') },
  ]} />`;
  const marks = [
    chip(ctx.followed.length, 'chipFollowed'),
    fresh ? chip(fresh, 'chipNew', 'coral') : null,
    chip(ctx.others.length, 'chipPublic'),
    ownBoards ? chip(ownBoards, 'chipOwn') : null,
  ];
  const openOwn = () => { ctx.setFold('own', true); scrollToSection('bp-own'); };
  const actions = html`
    <${Loud} onClick=${() => ctx.startNotice()}>${c('post')}<//>
    <${Actions}><${Action} small onClick=${openOwn}>${c('ownBoard')}<//><//>`;
  const sections = [
    { id: 'bp-followed', num: '01', label: c('secFollowed'), count: ctx.followed.length },
    { id: 'bp-recent', num: '02', label: c('secRecent'), count: recent.length },
    { id: 'bp-public', num: '03', label: c('secPublic'), count: ctx.others.length },
    { id: 'bp-own', num: '04', label: c('secOwn') },
    { id: 'bp-app', num: '05', label: c('secApp') },
  ];
  return html`
    <${SettingsPage} name="bp" crumb=${crumb(ctx, [])} title=${t('profile.tabs.boards')} marks=${marks} desc=${c('desc')}
      actions=${actions} strip=${strip} railTitle=${c('railTitle')} sections=${sections} pagesLabel=${c('pages')} pages=${pageLinks()}
      after=${html`<${ctx.ConfirmUI} />`}>
      ${secFollowed(ctx)}
      ${secRecent(ctx, recent)}
      ${secPublic(ctx)}
      <${Section} fold clip id="bp-own" num="04" title=${c('secOwn')} sub=${c('ownSub')} open=${ctx.folds.own} onToggle=${() => ctx.setFold('own', !ctx.folds.own)}>${ownBoardForm(ctx)}<//>
      <${Section} fold clip id="bp-app" num="05" title=${c('secApp')} sub=${c('appSub')} open=${ctx.folds.app} onToggle=${() => ctx.setFold('app', !ctx.folds.app)}>${secApp(ctx)}<//>
    <//>`;
}

function secFollowed(ctx) {
  const list = ctx.onlyNew ? ctx.followed.filter(b => (ctx.pages[bid(b)]?.posts || []).some(p => new Date(p.created_at).getTime() > Date.now() - 864e5)) : ctx.followed;
  const doors = html`<${Tab} tone="fold" on=${ctx.onlyNew} pressed=${!!ctx.onlyNew} onClick=${() => ctx.setOnlyNew(!ctx.onlyNew)}>${c('onlyNew')}<//>`;
  const openDoor = (b) => html`<${Action} small onClick=${() => ctx.pickView({ kind: 'board', id: bid(b) })}>${c('open')}<//>`;
  return html`
    <${PageSection} id="bp-followed" num="01" title=${c('secFollowed')} count=${`${ctx.followed.length} · ${c('secFollowedSub')}`} doors=${doors} first>
      ${ctx.loading && !ctx.boards.length ? html`<${Note} kind="loading">${t('common.loading')}<//>`
        : !list.length ? html`<${Note} kind="quiet">${ctx.followed.length ? c('emptyNew') : c('empty')}<//>`
        : boardRows(ctx, list, openDoor, { head: true })}
      <${Hint}>${c('followedHint')}<//>
    <//>`;
}

function secRecent(ctx, recent) {
  const shown = recent.filter(r => ctx.recentFilter === 'all' || (ctx.recentFilter === 'agents') === isAgentPost(r.post));
  const doors = html`<${Tabs} tone="fold" value=${ctx.recentFilter} onSelect=${(f) => ctx.setRecentFilter(f)}
    items=${['all', 'humans', 'agents'].map((f) => ({ value: f, label: c(f) }))} />`;
  const limit = ctx.recentAll ? shown.length : 8;
  const showRest = () => ctx.setRecentAll(true);
  return html`
    <${PageSection} id="bp-recent" num="02" title=${c('secRecent')} count=${c('secRecentSub')} doors=${doors}>
      ${!shown.length ? html`<${Note} kind="quiet">${c('emptyRecent')}<//>` : shown.slice(0, limit).map(r => noticeRow(ctx, r.boardId, r.post, r.authors, true))}
      ${shown.length > limit ? html`<${More} label=${c('showRest', { n: shown.length - limit })} onMore=${showRest} />` : null}
    <//>`;
}

function secPublic(ctx) {
  const list = ctx.publicAll ? ctx.others : ctx.others.slice(0, 8);
  const doors = ctx.others.length > 8 && !ctx.publicAll ? html`<${Action} tone="more" onClick=${() => ctx.setPublicAll(true)}>${c('showAll', { n: ctx.others.length })}<//>` : null;
  const followDoor = (b) => html`<${Action} small onClick=${() => ctx.handleFollow(bid(b))}>${c('follow')}<//>`;
  return html`
    <${PageSection} id="bp-public" num="03" title=${c('secPublic')} count=${`${ctx.others.length} · ${c('secPublicSub')}`} doors=${doors}>
      ${!list.length ? html`<${Note} kind="quiet">${c('emptyPublic')}<//>` : boardRows(ctx, list, followDoor)}
    <//>`;
}

/** The form for a board of one's own: name, description, who sees, who posts, price, categories, lifetime. */
export function ownBoardForm(ctx) {
  const f = ctx.form;
  const set = (k, v) => ctx.setForm({ ...f, [k]: v });
  const choice = (key, label, hint, options) => html`<${Choice} label=${label} hint=${hint} value=${f[key]} onChange=${(v) => set(key, v)} options=${options} />`;
  return html`
    <${Fields}>
      <${TextField} id="bp-f-name" label=${c('fName')} value=${f.name} onInput=${(v) => set('name', v)} placeholder=${t('profile.boards.namePlaceholder')} />
      <${TextField} id="bp-f-desc" label=${c('fDesc')} value=${f.description} onInput=${(v) => set('description', v)} placeholder=${t('profile.boards.descPlaceholder')} />
      <${Fields} cols=${2}>
        ${choice('visibility', c('fSees'), f.visibility === 'public' ? c('seesAllHint') : f.visibility === 'shared' ? c('seesChosenHint') : c('seesMeHint'), [['private', c('seesMe')], ['shared', c('seesChosen')], ['public', c('seesAll')]])}
        ${choice('posting', c('fPosts'), c('postsHint'), [['owner', c('postsMe')], ['members', c('postsMembers')], ['anyone', c('postsAnyone')]])}
        <${TextField} id="bp-f-cats" label=${c('fCategories')} hint=${c('categoriesHint')} value=${f.categories} onInput=${(v) => set('categories', v)} placeholder=${c('categoriesPlaceholder')} />
        ${choice('ttl', c('fLifetime'), c('lifetimeHint'), [['72', c('life3')], ['168', c('life7')], ['720', c('life30')], ['8760', c('lifeYear')]])}
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
  const openGuide = () => window.open('/docs/app-developer-ai-guide.md', '_blank', 'noopener');
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
