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
 *   v1.11.0 — 2026-09-26 — A member's ✗ is the Tag's remove mark (.poster-chip-x, poster.css): grey, coral under the pointer, where it was coral always (a unification: Jouni's decision "Remove mark").
 *   v1.10.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.9.0 — 2026-09-26 — The hairline over a part of the panel is the split (.og-split), a unification: the line Workflows and Boards drew alike.
 *   v1.8.0 — 2026-09-25 — The loading line's blinking mark is the library's Loading mark (css/components/loading-mark.css), moved unchanged out of five sheets (UI consolidation phase 5, a move).
 *   v1.7.0 — 2026-09-25 — Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.6.0 — 2026-09-25 — Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.5.0 — 2026-09-25 — The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.4.0 — 2026-09-25 — A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.3.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.2.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   v1.1.0 — 2026-09-25 — The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { PageSection } from '/components/PageSection.js';
import { FoldSection } from '/components/FoldSection.js';
import { scrollTo } from '/views/profile/organisms/poster-parts.js';
import { c, rel, who, bid, visWord, ownerOf, standingWords, noticeRow, renderPage } from './frame.js';
import { Hint } from '/components/Hint.js';

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
    <span class=${`poster-chip ${b.visibility === 'public' ? 'poster-chip--sun' : ''}`}>${visWord(b.visibility)}</span>
    <span class="poster-chip">${c('chipNotices', { n: page.posts.length + (page.cursor ? '+' : '') })}</span>
    ${b.owner_gaii ? html`<span class="poster-chip">${mine ? c('ownBoard') : c('chipKeeper', { name: ownerOf(b.owner_gaii) })}</span>` : null}
    <span class="poster-chip">${priceWords(b)}</span>
    <span class="poster-chip">${c('chipLifetime', { n: ttlDays })}</span>
    ${b.federate ? html`<span class="poster-chip">${t('profile.federated')}</span>` : null}`;
  const doors = html`
    <button type="button" class="poster-slab" onClick=${() => scrollTo('bp-compose')}>${c('post')}</button>
    ${(b.visibility === 'public' || b.visibility === 'system') && !mine ? html`<button type="button" class="poster-action poster-action--small" onClick=${() => subscribed ? ctx.handleUnfollow(id) : ctx.handleFollow(id)}>${subscribed ? c('unfollow') : c('follow')}</button>` : null}
    <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => { ctx.setFold('rules', true); scrollTo('bp-rules'); }}>${c('rules')}</button>`;
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

  const catDoors = cats.length ? html`<button type="button" class=${`poster-tab poster-tab--fold ${!ctx.catFilter ? 'is-on' : ''}`} onClick=${() => ctx.setCatFilter('')}>${c('all')}</button>${cats.map(cat => html`<button type="button" key=${cat} class=${`poster-tab poster-tab--fold ${ctx.catFilter === cat ? 'is-on' : ''}`} onClick=${() => ctx.setCatFilter(cat)}>${cat}</button>`)}` : null;
  return renderPage(ctx, {
    crumbs: [b.name], title: b.name, chips, doors, strip, rail,
    children: html`
      ${b.description ? html`<p class="og-desc og-desc--page">${b.description}</p>` : null}
      <${PageSection} id="bp-notices" num="01" title=${c('secNotices')} count=${`${page.posts.length}${page.cursor ? '+' : ''} · ${c('newestFirst')}`} doors=${catDoors} first>
        ${ctx.pageLoading === id && !page.posts.length ? html`<p class="poster-quiet loading-mark">${t('common.loading')}</p>`
          : !posts.length ? html`<p class="poster-quiet">${c('noticesEmpty')}</p>`
          : posts.map(p => noticeRow(ctx, id, p, page.authors, false))}
        ${page.cursor ? html`<div class="og-doors bp-more"><button type="button" class="poster-action poster-action--more" disabled=${ctx.pageLoading === id} onClick=${() => ctx.loadMore(id)}>${c('showMore')}</button></div>` : null}
      <//>
      <${PageSection} id="bp-compose" num="02" title=${c('secPost')}>
        ${composer(ctx, b, cats)}
      <//>
      <${FoldSection} id="bp-rules" num="03" title=${c('secRules')} sub=${mine ? c('rulesSub') : c('rulesSubReader')} open=${ctx.folds.rules} onToggle=${() => ctx.setFold('rules', !ctx.folds.rules)}>${rulesFold(ctx, b, mine)}<//>
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
        <label class="poster-label" for="bp-n-title">${c('fTitle')}</label>
        <input id="bp-n-title" class="og-input" value=${n.title} onInput=${e => set('title', e.target.value)} placeholder=${c('titlePlaceholder')} />
        <textarea id="bp-n-body" class="og-textarea" rows="3" value=${n.body} onInput=${e => set('body', e.target.value)} placeholder=${c('bodyPlaceholder')}></textarea>
      </div>
      <div class="bp-composer-side">
        ${cats.length ? html`<div class="og-field"><span class="poster-label">${c('fCategory')}</span><div class="pf-tabs">${cats.map(cat => html`<button type="button" key=${cat} class=${`poster-tab ${n.category === cat ? 'is-on' : ''}`} onClick=${() => set('category', n.category === cat ? '' : cat)}>${cat}</button>`)}</div></div>`
          : html`<div class="og-field"><label class="poster-label" for="bp-n-cat">${c('fCategory')}</label><input id="bp-n-cat" class="og-input" value=${n.category} onInput=${e => set('category', e.target.value)} placeholder=${c('categoryFree')} /></div>`}
        <div class="og-field"><span class="poster-label">${c('fLifetime')}</span><div class="pf-tabs">${[['72', c('life3')], ['168', c('life7')], ['720', c('life30')]].map(([v, l]) => html`<button type="button" key=${v} class=${`poster-tab ${ttl === v ? 'is-on' : ''}`} onClick=${() => set('ttl', v)}>${l}</button>`)}</div></div>
        <div class="og-doors"><button type="button" class="poster-slab poster-slab--control" disabled=${ctx.posting || !n.title.trim() || !n.body.trim()} onClick=${() => ctx.handlePost(bid(b))}>${label}</button></div>
      </div>
    </div>
    <${Hint}>${c('postHint')}<//>`;
}

function rulesFold(ctx, b, mine) {
  const r = ctx.rules;
  const set = (k, v) => ctx.setRules({ ...r, [k]: v });
  const choice = (key, options) => html`<div class="pf-tabs">${options.map(([v, label]) => html`<button type="button" key=${v} class=${`poster-tab ${r[key] === v ? 'is-on' : ''}`} disabled=${!mine} onClick=${() => mine && set(key, v)}>${label}</button>`)}</div>`;
  return html`
    <div class="og-fields bp-form">
      <div class="og-fields--2">
        <div class="og-field"><span class="poster-label">${c('fSees')}</span>${choice('visibility', [['private', c('seesMe')], ['shared', c('seesChosen')], ['public', c('seesAll')]])}</div>
        <div class="og-field"><span class="poster-label">${c('fPosts')}</span>${choice('posting', [['owner', c('postsMe')], ['members', c('postsMembers')], ['anyone', c('postsAnyone')]])}</div>
      </div>
      <div class="og-fields--2">
        <div class="og-field"><label class="poster-label" for="bp-r-cats">${c('fCategories')}</label><input id="bp-r-cats" class="og-input" value=${r.categories} disabled=${!mine} onInput=${e => set('categories', e.target.value)} placeholder=${c('categoriesPlaceholder')} /></div>
        <div class="og-field"><span class="poster-label">${c('fLifetime')}</span>${choice('ttl', [['72', c('life3')], ['168', c('life7')], ['720', c('life30')], ['8760', c('lifeYear')]])}</div>
      </div>
      ${r.visibility === 'public' ? html`<div class="og-fields--2">
        <div class="og-field bp-field--narrow"><label class="poster-label" for="bp-r-price">${c('fPrice')}</label><input id="bp-r-price" class="og-input" type="number" min="0" step="1" value=${r.price} disabled=${!mine} onInput=${e => set('price', e.target.value)} /><span class="poster-hint">${c('priceHint')}</span></div>
        <div class="og-field"><span class="poster-label">${c('federate')}</span>${choice('federate', [['no', c('federateNo')], ['yes', c('federateYes')]])}<span class="poster-hint">${c('federateHint')}</span></div>
      </div>` : null}
      ${mine ? html`<div class="og-doors"><button type="button" class="poster-slab poster-slab--control" disabled=${ctx.savingRules} onClick=${() => ctx.handleSaveRules(bid(b))}>${c('saveRules')}</button></div>` : null}
      ${mine && (b.visibility === 'shared' || r.visibility === 'shared') ? membersBlock(ctx, b) : null}
      ${mine ? html`<div class="og-doors og-split bp-danger-row"><button type="button" class="poster-action poster-action--small poster-action--danger" onClick=${() => ctx.handleDeleteBoard(bid(b))}>${c('deleteBoard')}</button></div>` : null}
    </div>`;
}

function membersBlock(ctx, b) {
  const members = b.allowed_gaiis || [];
  return html`
    <div class="og-split bp-members">
      <span class="poster-label">${c('members')}</span>
      <${Hint}>${c('membersHint')}<//>
      ${members.length ? html`<div class="bp-member-list">${members.map(g => html`<span class="poster-chip" key=${g}>${who(g).label} <button type="button" class="poster-chip-x" aria-label=${c('remove')} onClick=${() => ctx.handleRemoveMember(bid(b), g)}>✗</button></span>`)}</div>` : null}
      <div class="bp-member-add">
        <input class="og-input" value=${ctx.memberInput} onInput=${e => ctx.setMemberInput(e.target.value)} placeholder=${c('memberPlaceholder')} onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); ctx.handleAddMember(bid(b)); } }} />
        <button type="button" class="poster-action poster-action--small" disabled=${!ctx.memberInput.trim()} onClick=${() => ctx.handleAddMember(bid(b))}>${c('addMember')}</button>
      </div>
    </div>`;
}

export { standingWords };
