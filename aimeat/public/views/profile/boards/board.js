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
 * @structure priceWords · renderBoard · composer · rulesFold · membersBlock
 * @usage import { renderBoard } from './board.js';
 * @version-history
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set (Section, Fold, NumeralBand,
 *     Columns, Stack, Field, Action, Chip, Text) inside the frame's Page, so a board's page
 *     has no class or sheet of its own. A category or lifetime choice is a row of tabs. Handlers,
 *     field ids and i18n keys unchanged.
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, Fold, Columns, Stack, NumeralBand, Field, Action, Chip, Text } from '/components/poster-parts.js';
import { scrollTo } from '/views/profile/organisms/poster-parts.js';
import { c, rel, who, bid, visWord, ownerOf, standingWords, noticeRow, renderPage, choice } from './frame.js';

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

  const chips = html`<${Stack} direction="wrap" density="compact">
    <${Chip} tone=${b.visibility === 'public' ? 'sun' : 'plain'}>${visWord(b.visibility)}<//>
    <${Chip}>${c('chipNotices', { n: page.posts.length + (page.cursor ? '+' : '') })}<//>
    ${b.owner_gaii ? html`<${Chip}>${mine ? c('ownBoard') : c('chipKeeper', { name: ownerOf(b.owner_gaii) })}<//>` : null}
    <${Chip} tone="muted">${priceWords(b)}<//>
    <${Chip} tone="muted">${c('chipLifetime', { n: ttlDays })}<//>
    ${b.federate ? html`<${Chip} tone="muted">${t('profile.federated')}<//>` : null}
  <//>`;
  const doors = html`
    <${Action} kind="primary" onClick=${() => scrollTo('bp-compose')}>${c('post')}<//>
    ${(b.visibility === 'public' || b.visibility === 'system') && !mine ? html`<${Action} onClick=${() => subscribed ? ctx.handleUnfollow(id) : ctx.handleFollow(id)}>${subscribed ? c('unfollow') : c('follow')}<//>` : null}
    <${Action} onClick=${() => { ctx.setFold('rules', true); scrollTo('bp-rules'); }}>${c('rules')}<//>`;
  const strip = html`<${NumeralBand} tone="plain" size="small" items=${[
    latest ? { label: c('stripLatest'), value: rel(latest.created_at), note: `${who(latest.author_gaii).label} · "${latest.title}"` } : { label: c('stripLatest'), value: '·', note: c('noneYet') },
    { label: c('stripNotices'), value: `${page.posts.length}${page.cursor ? '+' : ''}`, note: c('stripNoticesSub', { a: page.posts.filter(p => who(p.author_gaii).agent).length, h: page.posts.filter(p => !who(p.author_gaii).agent).length }) },
    { label: c('stripPosters'), value: Object.keys(page.authors || {}).length, note: authorsSorted.map(a => who(a.gaii).label).slice(0, 3).join(' · ') || c('noneYet') },
    { label: c('stripFollow'), value: mine ? c('ownShort') : subscribed ? c('followingShort') : c('notFollowingShort'), tone: subscribed || mine ? undefined : 'coral', note: mine ? c('stripFollowOwn') : subscribed ? c('stripFollowOn') : c('stripFollowOff') },
  ]} />`;
  const rail = html`<${Stack} density="compact">
    <${Text} kind="label">${c('topics')}<//>
    <${Action} kind="tab" selected=${!ctx.catFilter} onClick=${() => ctx.setCatFilter('')}>${c('all')} ${page.posts.length}<//>
    ${cats.map(cat => html`<${Action} key=${cat} kind="tab" selected=${ctx.catFilter === cat} onClick=${() => ctx.setCatFilter(cat)}>${cat} ${page.posts.filter(p => p.category === cat).length}<//>`)}
    ${authorsSorted.length ? html`<${Text} kind="label">${c('mostThanked')}<//>${authorsSorted.map(a => html`<${Text} key=${a.gaii} kind="mono">${a.thanks || 0} ${who(a.gaii).label}<//>`)}` : null}
  <//>`;

  const catDoors = cats.length ? html`<${Action} kind="tab" selected=${!ctx.catFilter} onClick=${() => ctx.setCatFilter('')}>${c('all')}<//>${cats.map(cat => html`<${Action} key=${cat} kind="tab" selected=${ctx.catFilter === cat} onClick=${() => ctx.setCatFilter(cat)}>${cat}<//>`)}` : null;
  return renderPage(ctx, {
    crumbs: [b.name], title: b.name, chips, doors, strip, rail,
    children: html`
      ${b.description ? html`<${Text} kind="lead">${b.description}<//>` : null}
      <${Section} id="bp-notices" density="compact" title=${c('secNotices')} count=${`${page.posts.length}${page.cursor ? '+' : ''} · ${c('newestFirst')}`} actions=${catDoors}>
        <${Stack}>
          ${ctx.pageLoading === id && !page.posts.length ? html`<${Text} tone="muted">${t('common.loading')}<//>`
            : !posts.length ? html`<${Text} tone="muted">${c('noticesEmpty')}<//>`
            : html`<div>${posts.map(p => noticeRow(ctx, id, p, page.authors, false))}</div>`}
          ${page.cursor ? html`<div><${Action} disabled=${ctx.pageLoading === id} onClick=${() => ctx.loadMore(id)}>${c('showMore')}<//></div>` : null}
        <//>
      <//>
      <${Section} id="bp-compose" density="compact" title=${c('secPost')} count="02">
        ${composer(ctx, b, cats)}
      <//>
      <${Fold} id="bp-rules" number="03" title=${c('secRules')} sub=${mine ? c('rulesSub') : c('rulesSubReader')} open=${ctx.folds.rules} onToggle=${() => ctx.setFold('rules', !ctx.folds.rules)}>${rulesFold(ctx, b, mine)}<//>
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
  return html`<${Stack}>
    <${Columns} layout="leading" collapse="900" density="roomy">
      <${Stack} density="compact">
        <${Field} id="bp-n-title" label=${c('fTitle')} value=${n.title} onInput=${e => set('title', e.target.value)} placeholder=${c('titlePlaceholder')} />
        <${Field} id="bp-n-body" type="textarea" rows=${3} value=${n.body} onInput=${e => set('body', e.target.value)} placeholder=${c('bodyPlaceholder')} />
      <//>
      <${Stack}>
        ${cats.length ? html`<${Stack} density="compact"><${Text} kind="label">${c('fCategory')}<//>${choice(n.category, cats.map(cat => [cat, cat]), v => set('category', n.category === v ? '' : v))}<//>`
          : html`<${Field} id="bp-n-cat" label=${c('fCategory')} value=${n.category} onInput=${e => set('category', e.target.value)} placeholder=${c('categoryFree')} />`}
        <${Stack} density="compact"><${Text} kind="label">${c('fLifetime')}<//>${choice(ttl, [['72', c('life3')], ['168', c('life7')], ['720', c('life30')]], v => set('ttl', v))}<//>
        <div><${Action} kind="primary" disabled=${ctx.posting || !n.title.trim() || !n.body.trim()} onClick=${() => ctx.handlePost(bid(b))}>${label}<//></div>
      <//>
    <//>
    <${Text} kind="caption" tone="muted">${c('postHint')}<//>
  <//>`;
}

function rulesFold(ctx, b, mine) {
  const r = ctx.rules;
  const set = (k, v) => ctx.setRules({ ...r, [k]: v });
  const pick = (key, options) => choice(r[key], options, v => { if (mine) set(key, v); }, !mine);
  return html`<${Stack}>
    <${Columns} collapse="640">
      <${Stack} density="compact"><${Text} kind="label">${c('fSees')}<//>${pick('visibility', [['private', c('seesMe')], ['shared', c('seesChosen')], ['public', c('seesAll')]])}<//>
      <${Stack} density="compact"><${Text} kind="label">${c('fPosts')}<//>${pick('posting', [['owner', c('postsMe')], ['members', c('postsMembers')], ['anyone', c('postsAnyone')]])}<//>
    <//>
    <${Columns} collapse="640">
      <${Field} id="bp-r-cats" label=${c('fCategories')} value=${r.categories} disabled=${!mine} onInput=${e => set('categories', e.target.value)} placeholder=${c('categoriesPlaceholder')} />
      <${Stack} density="compact"><${Text} kind="label">${c('fLifetime')}<//>${pick('ttl', [['72', c('life3')], ['168', c('life7')], ['720', c('life30')], ['8760', c('lifeYear')]])}<//>
    <//>
    ${r.visibility === 'public' ? html`<${Columns} collapse="640">
      <${Field} id="bp-r-price" type="number" min="0" step="1" label=${c('fPrice')} value=${r.price} disabled=${!mine} onInput=${e => set('price', e.target.value)} hint=${c('priceHint')} />
      <${Stack} density="compact"><${Text} kind="label">${c('federate')}<//>${pick('federate', [['no', c('federateNo')], ['yes', c('federateYes')]])}<${Text} kind="caption" tone="muted">${c('federateHint')}<//><//>
    <//>` : null}
    ${mine ? html`<div><${Action} kind="primary" disabled=${ctx.savingRules} onClick=${() => ctx.handleSaveRules(bid(b))}>${c('saveRules')}<//></div>` : null}
    ${mine && (b.visibility === 'shared' || r.visibility === 'shared') ? membersBlock(ctx, b) : null}
    ${mine ? html`<div><${Action} onClick=${() => ctx.handleDeleteBoard(bid(b))}>${c('deleteBoard')}<//></div>` : null}
  <//>`;
}

function membersBlock(ctx, b) {
  const members = b.allowed_gaiis || [];
  return html`<${Stack} density="compact">
    <${Text} kind="label">${c('members')}<//>
    <${Text} kind="caption" tone="muted">${c('membersHint')}<//>
    ${members.length ? html`<${Stack} direction="wrap" density="compact">${members.map(g => html`<${Stack} key=${g} direction="horizontal" align="center" density="compact">
      <${Chip}>${who(g).label}<//><${Action} kind="icon" label=${c('remove')} onClick=${() => ctx.handleRemoveMember(bid(b), g)}>✗<//>
    <//>`)}<//>` : null}
    <${Stack} direction="horizontal" align="end">
      <${Field} value=${ctx.memberInput} onInput=${e => ctx.setMemberInput(e.target.value)} placeholder=${c('memberPlaceholder')} onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); ctx.handleAddMember(bid(b)); } }} />
      <${Action} disabled=${!ctx.memberInput.trim()} onClick=${() => ctx.handleAddMember(bid(b))}>${c('addMember')}<//>
    <//>
  <//>`;
}

export { standingWords };
