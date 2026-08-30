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
 *   v1.0.0 — 2026-08-30 — Initial. Replaces the subscriptions list, the "browse all" list and the
 *     create form that opened on top of an empty page.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, Fold, scrollTo } from '/views/profile/organisms/poster-parts.js';
import { c, rel, who, bid, isAgentPost, crumb, boardRows, rowsHead, noticeRow, pageLinks } from './frame.js';
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
  const chip = (n, key, cls = '') => html`<span class=${`og-chip ${cls}`}>${c(key, { n })}</span>`;
  const strip = html`
    <div class="og-strip">
      <div><b class=${fresh ? 'og-strip-coral' : ''}>${fresh}</b><span>${c('stripNew')}</span><small>${c('stripNewSub')}</small></div>
      <div>${latest ? html`<b>${rel(latest.post.created_at)}</b><span>${c('stripLatest')}</span><small>${ctx.boardById(latest.boardId)?.name} · ${who(latest.post.author_gaii).label} · "${latest.post.title}"</small>` : html`<b>·</b><span>${c('stripLatest')}</span><small>${c('noneYet')}</small>`}</div>
      <div><b>${own.length}</b><span>${c('stripOwn')}</span><small>${own[0] ? `${own[0].post.title}` : c('stripOwnSub')}</small></div>
      <div>${myStanding ? html`<b class="og-strip-coral">${myStanding.thanks || 0}</b><span>${c('stripThanks')}</span><small>${c('stripThanksSub', { n: myStanding.posts || 0 })}</small>` : html`<b>·</b><span>${c('stripThanks')}</span><small>${c('noneYet')}</small>`}</div>
    </div>`;
  return html`
    <div class="og og-bp">
      ${crumb(ctx, [])}
      <div class="og-mast">
        <div class="og-mast-words">
          <h1 class="og-title">${t('profile.tabs.boards')}</h1>
          <div class="og-chips">
            ${chip(ctx.followed.length, 'chipFollowed')}${fresh ? chip(fresh, 'chipNew', 'og-chip--coral') : null}${chip(ctx.others.length, 'chipPublic')}${ownBoards ? chip(ownBoards, 'chipOwn') : null}
          </div>
          <p class="og-desc">${c('desc')}</p>
        </div>
        <div class="og-mast-actions">
          <button type="button" class="og-slab" onClick=${() => ctx.startNotice()}>${c('post')}</button>
          <div class="og-doors"><button type="button" class="og-door" onClick=${() => { ctx.setFold('own', true); scrollTo('bp-own'); }}>${c('ownBoard')}</button></div>
        </div>
      </div>
      ${strip}
      <div class="og-grid">
        <div class="og-main">
          ${secFollowed(ctx)}
          ${secRecent(ctx, recent)}
          ${secPublic(ctx)}
          <${Fold} id="bp-own" num="04" title=${c('secOwn')} sub=${c('ownSub')} open=${ctx.folds.own} onToggle=${() => ctx.setFold('own', !ctx.folds.own)}>${ownBoardForm(ctx)}<//>
          <${Fold} id="bp-app" num="05" title=${c('secApp')} sub=${c('appSub')} open=${ctx.folds.app} onToggle=${() => ctx.setFold('app', !ctx.folds.app)}>${secApp(ctx)}<//>
        </div>
        <nav class="og-rail" aria-label=${c('railTitle')}>
          <span class="og-rail-label">${c('railTitle')}</span>
          ${[['01', 'bp-followed', c('secFollowed'), ctx.followed.length], ['02', 'bp-recent', c('secRecent'), recent.length], ['03', 'bp-public', c('secPublic'), ctx.others.length], ['04', 'bp-own', c('secOwn'), ''], ['05', 'bp-app', c('secApp'), '']]
            .map(([n, id, label, count]) => html`<button type="button" class="og-rail-link" key=${id} onClick=${() => scrollTo(id)}><i>${n}</i>${label}<em>${count}</em></button>`)}
          <hr />
          <span class="og-rail-label">${c('pages')}</span>
          ${pageLinks()}
        </nav>
      </div>
      <${ctx.ConfirmUI} />
    </div>`;
}

function secFollowed(ctx) {
  const list = ctx.onlyNew ? ctx.followed.filter(b => (ctx.pages[bid(b)]?.posts || []).some(p => new Date(p.created_at).getTime() > Date.now() - 864e5)) : ctx.followed;
  const doors = html`<button type="button" class=${`og-door og-door--quiet ${ctx.onlyNew ? 'on' : ''}`} onClick=${() => ctx.setOnlyNew(!ctx.onlyNew)}>${c('onlyNew')}</button>`;
  return html`
    <${Section} id="bp-followed" num="01" title=${c('secFollowed')} count=${`${ctx.followed.length} · ${c('secFollowedSub')}`} doors=${doors} first>
      ${ctx.loading && !ctx.boards.length ? html`<p class="og-empty bp-loading">${t('common.loading')}</p>`
        : !list.length ? html`<p class="og-empty">${ctx.followed.length ? c('emptyNew') : c('empty')}</p>`
        : html`${rowsHead()}${boardRows(ctx, list, (b) => html`<button type="button" class="og-door" onClick=${() => ctx.pickView({ kind: 'board', id: bid(b) })}>${c('open')}</button>`)}`}
      <p class="bp-hint">${c('followedHint')}</p>
    <//>`;
}

function secRecent(ctx, recent) {
  const shown = recent.filter(r => ctx.recentFilter === 'all' || (ctx.recentFilter === 'agents') === isAgentPost(r.post));
  const doors = ['all', 'humans', 'agents'].map(f => html`<button type="button" key=${f} class=${`og-door og-door--quiet ${ctx.recentFilter === f ? 'on' : ''}`} onClick=${() => ctx.setRecentFilter(f)}>${c(f)}</button>`);
  const limit = ctx.recentAll ? shown.length : 8;
  return html`
    <${Section} id="bp-recent" num="02" title=${c('secRecent')} count=${c('secRecentSub')} doors=${doors}>
      ${!shown.length ? html`<p class="og-empty">${c('emptyRecent')}</p>` : shown.slice(0, limit).map(r => noticeRow(ctx, r.boardId, r.post, r.authors, true))}
      ${shown.length > limit ? html`<div class="og-doors bp-more"><button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setRecentAll(true)}>${c('showRest', { n: shown.length - limit })}</button></div>` : null}
    <//>`;
}

function secPublic(ctx) {
  const list = ctx.publicAll ? ctx.others : ctx.others.slice(0, 8);
  const doors = ctx.others.length > 8 && !ctx.publicAll ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setPublicAll(true)}>${c('showAll', { n: ctx.others.length })}</button>` : null;
  return html`
    <${Section} id="bp-public" num="03" title=${c('secPublic')} count=${`${ctx.others.length} · ${c('secPublicSub')}`} doors=${doors}>
      ${!list.length ? html`<p class="og-empty">${c('emptyPublic')}</p>`
        : boardRows(ctx, list, (b) => html`<button type="button" class="og-door" onClick=${() => ctx.handleFollow(bid(b))}>${c('follow')}</button>`)}
    <//>`;
}

/** The form for a board of one's own: name, description, who sees, who posts, price, categories, lifetime. */
export function ownBoardForm(ctx) {
  const f = ctx.form;
  const set = (k, v) => ctx.setForm({ ...f, [k]: v });
  const choice = (key, options) => html`<div class="og-choice">${options.map(([v, label]) => html`<button type="button" key=${v} class=${`og-choice-btn ${f[key] === v ? 'on' : ''}`} onClick=${() => set(key, v)}>${label}</button>`)}</div>`;
  return html`
    <div class="og-fields bp-form">
      <div class="og-field"><label class="og-label" for="bp-f-name">${c('fName')}</label><input id="bp-f-name" class="og-input" value=${f.name} onInput=${e => set('name', e.target.value)} placeholder=${t('profile.boards.namePlaceholder')} /></div>
      <div class="og-field"><label class="og-label" for="bp-f-desc">${c('fDesc')}</label><input id="bp-f-desc" class="og-input" value=${f.description} onInput=${e => set('description', e.target.value)} placeholder=${t('profile.boards.descPlaceholder')} /></div>
      <div class="og-fields--2">
        <div class="og-field"><span class="og-label">${c('fSees')}</span>${choice('visibility', [['private', c('seesMe')], ['shared', c('seesChosen')], ['public', c('seesAll')]])}<span class="bp-hint">${f.visibility === 'public' ? c('seesAllHint') : f.visibility === 'shared' ? c('seesChosenHint') : c('seesMeHint')}</span></div>
        <div class="og-field"><span class="og-label">${c('fPosts')}</span>${choice('posting', [['owner', c('postsMe')], ['members', c('postsMembers')], ['anyone', c('postsAnyone')]])}<span class="bp-hint">${c('postsHint')}</span></div>
      </div>
      <div class="og-fields--2">
        <div class="og-field"><label class="og-label" for="bp-f-cats">${c('fCategories')}</label><input id="bp-f-cats" class="og-input" value=${f.categories} onInput=${e => set('categories', e.target.value)} placeholder=${c('categoriesPlaceholder')} /><span class="bp-hint">${c('categoriesHint')}</span></div>
        <div class="og-field"><span class="og-label">${c('fLifetime')}</span>${choice('ttl', [['72', c('life3')], ['168', c('life7')], ['720', c('life30')], ['8760', c('lifeYear')]])}<span class="bp-hint">${c('lifetimeHint')}</span></div>
      </div>
      ${f.visibility === 'public' ? html`<div class="og-field bp-field--narrow"><label class="og-label" for="bp-f-price">${c('fPrice')}</label><input id="bp-f-price" class="og-input" type="number" min="0" step="1" value=${f.price} onInput=${e => set('price', e.target.value)} /><span class="bp-hint">${c('priceHint')}</span></div>` : null}
      <div class="og-doors">
        <button type="button" class="og-slab" disabled=${ctx.creating || !f.name.trim()} onClick=${() => ctx.handleCreate()}>${c('create')}</button>
        <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setFold('own', false)}>${t('profile.cancel')}</button>
      </div>
    </div>`;
}

const SDK_EXAMPLE = `const b = await AIMEAT.social.createBoard('My notices', { visibility: 'public',
  rules: { categories: ['for-sale', 'wanted'], default_ttl_hours: 168 } });
await AIMEAT.social.post(b.id, { title: 'Bike, 16"', body: '60 €, Tapiola.', category: 'for-sale' });
const { posts, authors } = await AIMEAT.social.posts(b.id);   // works for a visitor too
if (AIMEAT.social.signedIn()) await AIMEAT.social.subscribe(b.id, { filters: { categories: ['wanted'] } });`;

function secApp(ctx) {
  return html`
    <div class="bp-app">
      <div class="bp-app-col">
        <p>${c('appText')}</p>
        <pre class="bp-code">${SDK_EXAMPLE}</pre>
        <div class="og-doors"><button type="button" class="og-door" onClick=${() => ctx.copy(SDK_EXAMPLE, c('copied'))}>${c('copyExample')}</button><button type="button" class="og-door og-door--quiet" onClick=${() => window.open('/docs/app-developer-ai-guide.md', '_blank', 'noopener')}>${c('appGuide')} ↗</button></div>
      </div>
      <div class="bp-app-col">
        <b>${c('agentTitle')}</b>
        <p>${c('agentText')}</p>
        <div class="og-doors"><button type="button" class="og-door" onClick=${() => ctx.copy(ctx.agentPrompt(), c('copied'))}>${c('copyAgent')}</button></div>
      </div>
    </div>`;
}
