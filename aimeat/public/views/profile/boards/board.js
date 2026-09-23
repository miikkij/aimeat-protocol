/**
 * @file public/views/profile/boards/board.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One board as its own page under the Boards crumb: what it is as chips (visibility,
 *   notices, keeper, price, lifetime); publish, follow and the rules as doors; a strip with the
 *   latest notice, the count, the posters and whether I follow it; the notices as rows with a
 *   category filter and a next page; the composer (title, text, category, lifetime, the price said
 *   on the button); and the rules and settings as a fold the keeper edits (who sees, who posts,
 *   categories, price, lifetime, members, federation, delete).
 * @structure renderBoard · composer · rulesFold · membersBlock
 * @usage import { renderBoard } from './board.js';
 * @version-history
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, Fold, scrollTo } from '/views/profile/organisms/poster-parts.js';
import { c, rel, who, bid, visWord, ownerOf, standingWords, noticeRow, renderPage } from './frame.js';

export function priceWords(b) {
  if (b.visibility !== 'public' && b.visibility !== 'system') return c('chipFree');
  const cost = b.rules?.post_cost;
  if (cost === 0) return c('chipFree');
  if (cost !== undefined) return c('chipPriceShort', { n: cost });
  return c('chipPriced');
}

export function renderBoard(ctx, b) {
  const id = bid(b);
  const page = ctx.pages[id] || { posts: [], authors: {}, cursor: undefined };
  const mine = ctx.isMine(b);
  const subscribed = ctx.isSubscribed(b);
  const cats = b.rules?.categories?.length ? b.rules.categories : [...new Set(page.posts.map(p => p.category).filter(Boolean))];
  const posts = ctx.catFilter ? page.posts.filter(p => p.category === ctx.catFilter) : page.posts;
  const authorsSorted = Object.values(page.authors || {}).sort((a, z) => (z.thanks || 0) - (a.thanks || 0)).slice(0, 5);
  const latest = page.posts[0];
  const ttlDays = Math.round((b.rules?.default_ttl_hours ?? 168) / 24);

  const chips = html`
    <span class=${`og-chip ${b.visibility === 'public' ? 'og-chip--sun' : ''}`}>${visWord(b.visibility)}</span>
    <span class="og-chip">${c('chipNotices', { n: page.posts.length + (page.cursor ? '+' : '') })}</span>
    ${b.owner_gaii ? html`<span class="og-chip bp-chip--case">${mine ? c('ownBoard') : c('chipKeeper', { name: ownerOf(b.owner_gaii) })}</span>` : null}
    <span class="og-chip og-chip--dim">${priceWords(b)}</span>
    <span class="og-chip og-chip--dim">${c('chipLifetime', { n: ttlDays })}</span>
    ${b.federate ? html`<span class="og-chip og-chip--dim">${t('profile.federated')}</span>` : null}`;
  const doors = html`
    <button type="button" class="og-slab" onClick=${() => scrollTo('bp-compose')}>${c('post')}</button>
    ${(b.visibility === 'public' || b.visibility === 'system') && !mine ? html`<button type="button" class="og-door" onClick=${() => subscribed ? ctx.handleUnfollow(id) : ctx.handleFollow(id)}>${subscribed ? c('unfollow') : c('follow')}</button>` : null}
    <button type="button" class="og-door og-door--quiet" onClick=${() => { ctx.setFold('rules', true); scrollTo('bp-rules'); }}>${c('rules')}</button>`;
  const strip = html`
    <div class="og-strip">
      <div>${latest ? html`<b>${rel(latest.created_at)}</b><span>${c('stripLatest')}</span><small>${who(latest.author_gaii).label} · "${latest.title}"</small>` : html`<b>·</b><span>${c('stripLatest')}</span><small>${c('noneYet')}</small>`}</div>
      <div><b>${page.posts.length}${page.cursor ? '+' : ''}</b><span>${c('stripNotices')}</span><small>${c('stripNoticesSub', { a: page.posts.filter(p => who(p.author_gaii).agent).length, h: page.posts.filter(p => !who(p.author_gaii).agent).length })}</small></div>
      <div><b>${Object.keys(page.authors || {}).length}</b><span>${c('stripPosters')}</span><small>${authorsSorted.map(a => who(a.gaii).label).slice(0, 3).join(' · ') || c('noneYet')}</small></div>
      <div><b class=${subscribed || mine ? '' : 'og-strip-coral'}>${mine ? c('ownShort') : subscribed ? c('followingShort') : c('notFollowingShort')}</b><span>${c('stripFollow')}</span><small>${mine ? c('stripFollowOwn') : subscribed ? c('stripFollowOn') : c('stripFollowOff')}</small></div>
    </div>`;
  const rail = html`
    <hr />
    <span class="og-rail-label">${c('topics')}</span>
    <button type="button" class=${`og-rail-link ${!ctx.catFilter ? 'on' : ''}`} onClick=${() => ctx.setCatFilter('')}><i>${page.posts.length}</i>${c('all')}</button>
    ${cats.map(cat => html`<button type="button" key=${cat} class=${`og-rail-link ${ctx.catFilter === cat ? 'on' : ''}`} onClick=${() => ctx.setCatFilter(cat)}><i>${page.posts.filter(p => p.category === cat).length}</i>${cat}</button>`)}
    ${authorsSorted.length ? html`<hr /><span class="og-rail-label">${c('mostThanked')}</span>${authorsSorted.map(a => html`<span class="og-rail-link bp-rail-static" key=${a.gaii}><i>${a.thanks || 0}</i>${who(a.gaii).label}</span>`)}` : null}`;

  const catDoors = cats.length ? html`<button type="button" class=${`og-door og-door--quiet ${!ctx.catFilter ? 'on' : ''}`} onClick=${() => ctx.setCatFilter('')}>${c('all')}</button>${cats.map(cat => html`<button type="button" key=${cat} class=${`og-door og-door--quiet bp-door--case ${ctx.catFilter === cat ? 'on' : ''}`} onClick=${() => ctx.setCatFilter(cat)}>${cat}</button>`)}` : null;
  return renderPage(ctx, {
    crumbs: [b.name], title: b.name, chips, doors, strip, rail,
    children: html`
      ${b.description ? html`<p class="og-desc og-desc--page">${b.description}</p>` : null}
      <${Section} id="bp-notices" num="01" title=${c('secNotices')} count=${`${page.posts.length}${page.cursor ? '+' : ''} · ${c('newestFirst')}`} doors=${catDoors} first>
        ${ctx.pageLoading === id && !page.posts.length ? html`<p class="og-empty bp-loading">${t('common.loading')}</p>`
          : !posts.length ? html`<p class="og-empty">${c('noticesEmpty')}</p>`
          : posts.map(p => noticeRow(ctx, id, p, page.authors, false))}
        ${page.cursor ? html`<div class="og-doors bp-more"><button type="button" class="og-door og-door--quiet" disabled=${ctx.pageLoading === id} onClick=${() => ctx.loadMore(id)}>${c('showMore')}</button></div>` : null}
      <//>
      <${Section} id="bp-compose" num="02" title=${c('secPost')}>
        ${composer(ctx, b, cats)}
      <//>
      <${Fold} id="bp-rules" num="03" title=${c('secRules')} sub=${mine ? c('rulesSub') : c('rulesSubReader')} open=${ctx.folds.rules} onToggle=${() => ctx.setFold('rules', !ctx.folds.rules)}>${rulesFold(ctx, b, mine)}<//>
      <${ctx.ConfirmUI} />`,
  });
}

function composer(ctx, b, cats) {
  const n = ctx.notice;
  const set = (k, v) => ctx.setNotice({ ...n, [k]: v });
  const cost = b.visibility === 'public' || b.visibility === 'system' ? b.rules?.post_cost : 0;
  const label = cost === 0 || cost === undefined && b.visibility !== 'public' ? c('publish') : cost !== undefined ? c('publishFor', { n: cost }) : c('publishPriced');
  const ttlDefault = String(b.rules?.default_ttl_hours ?? 168);
  const ttl = n.ttl || ttlDefault;
  return html`
    <div class="bp-composer">
      <div class="og-field bp-composer-main">
        <label class="og-label" for="bp-n-title">${c('fTitle')}</label>
        <input id="bp-n-title" class="og-input" value=${n.title} onInput=${e => set('title', e.target.value)} placeholder=${c('titlePlaceholder')} />
        <textarea id="bp-n-body" class="og-textarea" rows="3" value=${n.body} onInput=${e => set('body', e.target.value)} placeholder=${c('bodyPlaceholder')}></textarea>
      </div>
      <div class="bp-composer-side">
        ${cats.length ? html`<div class="og-field"><span class="og-label">${c('fCategory')}</span><div class="og-choice">${cats.map(cat => html`<button type="button" key=${cat} class=${`og-choice-btn ${n.category === cat ? 'on' : ''}`} onClick=${() => set('category', n.category === cat ? '' : cat)}>${cat}</button>`)}</div></div>`
          : html`<div class="og-field"><label class="og-label" for="bp-n-cat">${c('fCategory')}</label><input id="bp-n-cat" class="og-input" value=${n.category} onInput=${e => set('category', e.target.value)} placeholder=${c('categoryFree')} /></div>`}
        <div class="og-field"><span class="og-label">${c('fLifetime')}</span><div class="og-choice">${[['72', c('life3')], ['168', c('life7')], ['720', c('life30')]].map(([v, l]) => html`<button type="button" key=${v} class=${`og-choice-btn ${ttl === v ? 'on' : ''}`} onClick=${() => set('ttl', v)}>${l}</button>`)}</div></div>
        <div class="og-doors"><button type="button" class="og-slab" disabled=${ctx.posting || !n.title.trim() || !n.body.trim()} onClick=${() => ctx.handlePost(bid(b))}>${label}</button></div>
      </div>
    </div>
    <p class="bp-hint">${c('postHint')}</p>`;
}

function rulesFold(ctx, b, mine) {
  const r = ctx.rules;
  const set = (k, v) => ctx.setRules({ ...r, [k]: v });
  const choice = (key, options) => html`<div class="og-choice">${options.map(([v, label]) => html`<button type="button" key=${v} class=${`og-choice-btn ${r[key] === v ? 'on' : ''}`} disabled=${!mine} onClick=${() => mine && set(key, v)}>${label}</button>`)}</div>`;
  return html`
    <div class="og-fields bp-form">
      <div class="og-fields--2">
        <div class="og-field"><span class="og-label">${c('fSees')}</span>${choice('visibility', [['private', c('seesMe')], ['shared', c('seesChosen')], ['public', c('seesAll')]])}</div>
        <div class="og-field"><span class="og-label">${c('fPosts')}</span>${choice('posting', [['owner', c('postsMe')], ['members', c('postsMembers')], ['anyone', c('postsAnyone')]])}</div>
      </div>
      <div class="og-fields--2">
        <div class="og-field"><label class="og-label" for="bp-r-cats">${c('fCategories')}</label><input id="bp-r-cats" class="og-input" value=${r.categories} disabled=${!mine} onInput=${e => set('categories', e.target.value)} placeholder=${c('categoriesPlaceholder')} /></div>
        <div class="og-field"><span class="og-label">${c('fLifetime')}</span>${choice('ttl', [['72', c('life3')], ['168', c('life7')], ['720', c('life30')], ['8760', c('lifeYear')]])}</div>
      </div>
      ${r.visibility === 'public' ? html`<div class="og-fields--2">
        <div class="og-field bp-field--narrow"><label class="og-label" for="bp-r-price">${c('fPrice')}</label><input id="bp-r-price" class="og-input" type="number" min="0" step="1" value=${r.price} disabled=${!mine} onInput=${e => set('price', e.target.value)} /><span class="bp-hint">${c('priceHint')}</span></div>
        <div class="og-field"><span class="og-label">${c('federate')}</span>${choice('federate', [['no', c('federateNo')], ['yes', c('federateYes')]])}<span class="bp-hint">${c('federateHint')}</span></div>
      </div>` : null}
      ${mine ? html`<div class="og-doors"><button type="button" class="og-slab" disabled=${ctx.savingRules} onClick=${() => ctx.handleSaveRules(bid(b))}>${c('saveRules')}</button></div>` : null}
      ${mine && (b.visibility === 'shared' || r.visibility === 'shared') ? membersBlock(ctx, b) : null}
      ${mine ? html`<div class="og-doors bp-danger-row"><button type="button" class="og-door og-door--danger" onClick=${() => ctx.handleDeleteBoard(bid(b))}>${c('deleteBoard')}</button></div>` : null}
    </div>`;
}

function membersBlock(ctx, b) {
  const members = b.allowed_gaiis || [];
  return html`
    <div class="bp-members">
      <span class="og-label">${c('members')}</span>
      <p class="bp-hint">${c('membersHint')}</p>
      ${members.length ? html`<div class="bp-member-list">${members.map(g => html`<span class="og-chip bp-chip--case" key=${g}>${who(g).label} <button type="button" class="bp-member-x" aria-label=${c('remove')} onClick=${() => ctx.handleRemoveMember(bid(b), g)}>✗</button></span>`)}</div>` : null}
      <div class="bp-member-add">
        <input class="og-input" value=${ctx.memberInput} onInput=${e => ctx.setMemberInput(e.target.value)} placeholder=${c('memberPlaceholder')} onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); ctx.handleAddMember(bid(b)); } }} />
        <button type="button" class="og-door" disabled=${!ctx.memberInput.trim()} onClick=${() => ctx.handleAddMember(bid(b))}>${c('addMember')}</button>
      </div>
    </div>`;
}

export { standingWords };
