/**
 * @file public/views/profile/boards/cover.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Boards page in the poster face (design canvas "AIMEAT Taulujen sivu", direction
 *   A). A board is the notice board people and agents publish to together. The COVER answers in the
 *   order a person asks: the boards I follow (my own, the ones I subscribe to, my organisms'), the
 *   newest notices on them, the public boards worth following, a board of my own as a fold, and a
 *   board for my app as a fold. A board opens as its own page (board.js) and a notice as its own
 *   (notice.js). Pure render functions over the ctx bag boards-tab.js assembles, composed from the
 *   shared component set (components/poster-parts.js) with no class or style of its own.
 * @structure renderBoardsView · recentOf · renderCover · secFollowed · secRecent · secPublic · ownBoardForm · secApp
 * @usage import { renderBoardsView } from './boards/cover.js';
 * @version-history
 *   v2.1.0 -- 2026-09-22 -- The rail's two fold entries open their fold before the jump, the new
 *     notices chip is coral, and the jump to one's own board uses the set's scrollToId.
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set (Page, Rail, Section, Fold,
 *     NumeralBand, ListRow, Columns, Field, Surface, Action, Chip, Text) so the cover follows
 *     the one theme and boards-poster.css can go. A choice of options is a row of tabs. Content,
 *     handlers, field ids and i18n keys unchanged; the outside-link arrow is the allowed →.
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-08-30 — Initial. Replaces the subscriptions list, the "browse all" list and the
 *     create form that opened on top of an empty page.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Page, Rail, Section, Fold, Columns, Stack, NumeralBand, Field, Surface, Action, Chip, Text, scrollToId } from '/components/poster-parts.js';
import { c, rel, who, bid, isAgentPost, crumb, boardRows, noticeRow, pageLinks, choice } from './frame.js';
import { renderBoard } from './board.js';
import { renderNotice } from './notice.js';

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
  const chip = (n, key, tone) => html`<${Chip} tone=${tone}>${c(key, { n })}<//>`;
  const strip = html`<${NumeralBand} tone="plain" size="small" items=${[
    { label: c('stripNew'), value: fresh, note: c('stripNewSub'), tone: fresh ? 'coral' : undefined },
    latest ? { label: c('stripLatest'), value: rel(latest.post.created_at), note: `${ctx.boardById(latest.boardId)?.name} · ${who(latest.post.author_gaii).label} · "${latest.post.title}"` }
      : { label: c('stripLatest'), value: '·', note: c('noneYet') },
    { label: c('stripOwn'), value: own.length, note: own[0] ? `${own[0].post.title}` : c('stripOwnSub') },
    myStanding ? { label: c('stripThanks'), value: myStanding.thanks || 0, note: c('stripThanksSub', { n: myStanding.posts || 0 }), tone: 'coral' }
      : { label: c('stripThanks'), value: '·', note: c('noneYet') },
  ]} />`;
  const rail = html`<${Rail} kind="index" title=${c('railTitle')} entries=${[
    { href: '#bp-followed', label: c('secFollowed'), count: ctx.followed.length },
    { href: '#bp-recent', label: c('secRecent'), count: recent.length },
    { href: '#bp-public', label: c('secPublic'), count: ctx.others.length },
    { href: '#bp-own', label: c('secOwn'), onClick: () => ctx.setFold('own', true) },
    { href: '#bp-app', label: c('secApp'), onClick: () => ctx.setFold('app', true) },
  ]}>${pageLinks()}<//>`;
  return html`<${Page} title=${t('profile.tabs.boards')} crumbs=${crumb(ctx, [])}
    identity=${html`<${Stack} direction="wrap" density="compact">
      ${chip(ctx.followed.length, 'chipFollowed')}${fresh ? chip(fresh, 'chipNew', 'coral') : null}${chip(ctx.others.length, 'chipPublic')}${ownBoards ? chip(ownBoards, 'chipOwn') : null}
    <//>`}
    actions=${html`<${Action} kind="primary" onClick=${() => ctx.startNotice()}>${c('post')}<//>
      <${Action} onClick=${() => { ctx.setFold('own', true); scrollToId('bp-own'); }}>${c('ownBoard')}<//>`}
    rail=${rail}>
    <${Stack}>
      <${Text} tone="muted">${c('desc')}<//>
      ${strip}
      ${secFollowed(ctx)}
      ${secRecent(ctx, recent)}
      ${secPublic(ctx)}
      <div>
        <${Fold} id="bp-own" number="04" title=${c('secOwn')} sub=${c('ownSub')} open=${ctx.folds.own} onToggle=${() => ctx.setFold('own', !ctx.folds.own)}>${ownBoardForm(ctx)}<//>
        <${Fold} id="bp-app" number="05" title=${c('secApp')} sub=${c('appSub')} open=${ctx.folds.app} onToggle=${() => ctx.setFold('app', !ctx.folds.app)}>${secApp(ctx)}<//>
      </div>
    <//>
    <${ctx.ConfirmUI} />
  <//>`;
}

function secFollowed(ctx) {
  const list = ctx.onlyNew ? ctx.followed.filter(b => (ctx.pages[bid(b)]?.posts || []).some(p => new Date(p.created_at).getTime() > Date.now() - 864e5)) : ctx.followed;
  const doors = html`<${Action} kind="tab" selected=${ctx.onlyNew} onClick=${() => ctx.setOnlyNew(!ctx.onlyNew)}>${c('onlyNew')}<//>`;
  return html`<${Section} id="bp-followed" density="compact" title=${c('secFollowed')} count=${`${ctx.followed.length} · ${c('secFollowedSub')}`} actions=${doors}>
    <${Stack}>
      ${ctx.loading && !ctx.boards.length ? html`<${Text} tone="muted">${t('common.loading')}<//>`
        : !list.length ? html`<${Text} tone="muted">${ctx.followed.length ? c('emptyNew') : c('empty')}<//>`
        : boardRows(ctx, list, (b) => html`<${Action} onClick=${() => ctx.pickView({ kind: 'board', id: bid(b) })}>${c('open')}<//>`)}
      <${Text} kind="caption" tone="muted">${c('followedHint')}<//>
    <//>
  <//>`;
}

function secRecent(ctx, recent) {
  const shown = recent.filter(r => ctx.recentFilter === 'all' || (ctx.recentFilter === 'agents') === isAgentPost(r.post));
  const doors = ['all', 'humans', 'agents'].map(f => html`<${Action} key=${f} kind="tab" selected=${ctx.recentFilter === f} onClick=${() => ctx.setRecentFilter(f)}>${c(f)}<//>`);
  const limit = ctx.recentAll ? shown.length : 8;
  return html`<${Section} id="bp-recent" density="compact" title=${c('secRecent')} count=${c('secRecentSub')} actions=${doors}>
    <${Stack}>
      ${!shown.length ? html`<${Text} tone="muted">${c('emptyRecent')}<//>` : html`<div>${shown.slice(0, limit).map(r => noticeRow(ctx, r.boardId, r.post, r.authors, true))}</div>`}
      ${shown.length > limit ? html`<div><${Action} onClick=${() => ctx.setRecentAll(true)}>${c('showRest', { n: shown.length - limit })}<//></div>` : null}
    <//>
  <//>`;
}

function secPublic(ctx) {
  const list = ctx.publicAll ? ctx.others : ctx.others.slice(0, 8);
  const doors = ctx.others.length > 8 && !ctx.publicAll ? html`<${Action} onClick=${() => ctx.setPublicAll(true)}>${c('showAll', { n: ctx.others.length })}<//>` : null;
  return html`<${Section} id="bp-public" density="compact" title=${c('secPublic')} count=${`${ctx.others.length} · ${c('secPublicSub')}`} actions=${doors}>
    ${!list.length ? html`<${Text} tone="muted">${c('emptyPublic')}<//>`
      : boardRows(ctx, list, (b) => html`<${Action} onClick=${() => ctx.handleFollow(bid(b))}>${c('follow')}<//>`)}
  <//>`;
}

/** The form for a board of one's own: name, description, who sees, who posts, price, categories, lifetime. */
export function ownBoardForm(ctx) {
  const f = ctx.form;
  const set = (k, v) => ctx.setForm({ ...f, [k]: v });
  return html`<${Stack}>
    <${Field} id="bp-f-name" label=${c('fName')} value=${f.name} onInput=${e => set('name', e.target.value)} placeholder=${t('profile.boards.namePlaceholder')} />
    <${Field} id="bp-f-desc" label=${c('fDesc')} value=${f.description} onInput=${e => set('description', e.target.value)} placeholder=${t('profile.boards.descPlaceholder')} />
    <${Columns} collapse="640">
      <${Stack} density="compact"><${Text} kind="label">${c('fSees')}<//>${choice(f.visibility, [['private', c('seesMe')], ['shared', c('seesChosen')], ['public', c('seesAll')]], v => set('visibility', v))}
        <${Text} kind="caption" tone="muted">${f.visibility === 'public' ? c('seesAllHint') : f.visibility === 'shared' ? c('seesChosenHint') : c('seesMeHint')}<//><//>
      <${Stack} density="compact"><${Text} kind="label">${c('fPosts')}<//>${choice(f.posting, [['owner', c('postsMe')], ['members', c('postsMembers')], ['anyone', c('postsAnyone')]], v => set('posting', v))}
        <${Text} kind="caption" tone="muted">${c('postsHint')}<//><//>
    <//>
    <${Columns} collapse="640">
      <${Field} id="bp-f-cats" label=${c('fCategories')} value=${f.categories} onInput=${e => set('categories', e.target.value)} placeholder=${c('categoriesPlaceholder')} hint=${c('categoriesHint')} />
      <${Stack} density="compact"><${Text} kind="label">${c('fLifetime')}<//>${choice(f.ttl, [['72', c('life3')], ['168', c('life7')], ['720', c('life30')], ['8760', c('lifeYear')]], v => set('ttl', v))}
        <${Text} kind="caption" tone="muted">${c('lifetimeHint')}<//><//>
    <//>
    ${f.visibility === 'public' ? html`<${Columns} layout="trailing" collapse="640"><${Field} id="bp-f-price" type="number" min="0" step="1" label=${c('fPrice')} value=${f.price} onInput=${e => set('price', e.target.value)} hint=${c('priceHint')} /><//>` : null}
    <${Stack} direction="horizontal" align="center">
      <${Action} kind="primary" disabled=${ctx.creating || !f.name.trim()} onClick=${() => ctx.handleCreate()}>${c('create')}<//>
      <${Action} onClick=${() => ctx.setFold('own', false)}>${t('profile.cancel')}<//>
    <//>
  <//>`;
}

const SDK_EXAMPLE = `const b = await AIMEAT.social.createBoard('My notices', { visibility: 'public',
  rules: { categories: ['for-sale', 'wanted'], default_ttl_hours: 168 } });
await AIMEAT.social.post(b.id, { title: 'Bike, 16"', body: '60 €, Tapiola.', category: 'for-sale' });
const { posts, authors } = await AIMEAT.social.posts(b.id);   // works for a visitor too
if (AIMEAT.social.signedIn()) await AIMEAT.social.subscribe(b.id, { filters: { categories: ['wanted'] } });`;

function secApp(ctx) {
  return html`<${Columns} layout="leading" collapse="900" density="roomy">
    <${Stack} density="compact">
      <${Text} tone="muted">${c('appText')}<//>
      <${Surface} kind="code" density="compact">${SDK_EXAMPLE}<//>
      <${Stack} direction="wrap"><${Action} onClick=${() => ctx.copy(SDK_EXAMPLE, c('copied'))}>${c('copyExample')}<//><${Action} onClick=${() => window.open('/docs/app-developer-ai-guide.md', '_blank', 'noopener')}>${c('appGuide')} →<//><//>
    <//>
    <${Stack} density="compact">
      <${Text}><strong>${c('agentTitle')}</strong><//>
      <${Text} tone="muted">${c('agentText')}<//>
      <div><${Action} onClick=${() => ctx.copy(ctx.agentPrompt(), c('copied'))}>${c('copyAgent')}<//></div>
    <//>
  <//>`;
}
