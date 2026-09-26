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
 *   v1.12.0 — 2026-09-26 — On the component kit (page group G7): the tags, the strip and the rail are data (the topics and the most thanked as rail items), the category filter the Tabs in the fold tone, "show more" the More line, the composer the Beside with the TextField, TextArea and Choice (a chosen category pressed again clears it), the rules the Fields with the Choice, the members the Tags with their remove mark and the TextField with its add door, the hairlines the Split. The file writes no class.
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
import { Section } from '/components/Section.js';
import { scrollToSection } from '/components/Rail.js';
import { c, rel, who, bid, visWord, ownerOf, standingWords, noticeRow, renderPage } from './frame.js';
import { Hint } from '/components/Hint.js';
import { Note } from '/components/Note.js';
import { Mark, Marks, Label } from '/components/Mark.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Tabs } from '/components/Tabs.js';
import { More } from '/components/List.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Fields } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Choice } from '/components/Choice.js';
import { Stack, Space, Split, Beside } from '/components/Layout.js';

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

  const marks = [
    { label: visWord(b.visibility), tone: b.visibility === 'public' ? 'sun' : undefined },
    { label: c('chipNotices', { n: page.posts.length + (page.cursor ? '+' : '') }) },
    b.owner_gaii ? { label: mine ? c('ownBoard') : c('chipKeeper', { name: ownerOf(b.owner_gaii) }) } : null,
    { label: priceWords(b), tone: 'dim' },
    { label: c('chipLifetime', { n: ttlDays }), tone: 'dim' },
    b.federate ? { label: t('profile.federated'), tone: 'dim' } : null,
  ];
  const follow = () => (subscribed ? ctx.handleUnfollow(id) : ctx.handleFollow(id));
  const openRules = () => { ctx.setFold('rules', true); scrollToSection('bp-rules'); };
  const doors = html`
    <${Loud} onClick=${() => scrollToSection('bp-compose')}>${c('post')}<//>
    ${(b.visibility === 'public' || b.visibility === 'system') && !mine ? html`<${Action} small onClick=${follow}>${subscribed ? c('unfollow') : c('follow')}<//>` : null}
    <${Action} small soft onClick=${openRules}>${c('rules')}<//>`;
  const strip = html`<${FigureStrip} items=${[
    latest
      ? { n: rel(latest.created_at), label: c('stripLatest'), sub: `${who(latest.author_gaii).label} · "${latest.title}"` }
      : { n: '·', label: c('stripLatest'), sub: c('noneYet') },
    { n: `${page.posts.length}${page.cursor ? '+' : ''}`, label: c('stripNotices'), sub: c('stripNoticesSub', { a: page.posts.filter(p => who(p.author_gaii).agent).length, h: page.posts.filter(p => !who(p.author_gaii).agent).length }) },
    { n: Object.keys(page.authors || {}).length, label: c('stripPosters'), sub: authorsSorted.map(a => who(a.gaii).label).slice(0, 3).join(' · ') || c('noneYet') },
    { n: mine ? c('ownShort') : subscribed ? c('followingShort') : c('notFollowingShort'), tone: subscribed || mine ? undefined : 'coral', label: c('stripFollow'), sub: mine ? c('stripFollowOwn') : subscribed ? c('stripFollowOn') : c('stripFollowOff') },
  ]} />`;
  const rail = [
    { label: c('topics'), items: [
      { mark: page.posts.length, label: c('all'), on: !ctx.catFilter, onClick: () => ctx.setCatFilter(''), key: '*' },
      ...cats.map((cat) => ({ key: cat, mark: page.posts.filter(p => p.category === cat).length, label: cat, on: ctx.catFilter === cat, onClick: () => ctx.setCatFilter(cat) })),
    ] },
    authorsSorted.length ? { label: c('mostThanked'), items: authorsSorted.map((a) => ({ key: a.gaii, plain: true, mark: a.thanks || 0, label: who(a.gaii).label })) } : null,
  ].filter(Boolean);

  const catDoors = cats.length ? html`<${Tabs} tone="fold" value=${ctx.catFilter || ''} onSelect=${(v) => ctx.setCatFilter(v)}
    items=${[{ value: '', label: c('all') }, ...cats.map((cat) => ({ value: cat, label: cat }))]} />` : null;
  const loadMore = () => ctx.loadMore(id);
  return renderPage(ctx, {
    crumbs: [b.name], title: b.name, marks, desc: b.description || null, doors, strip, rail,
    after: html`<${ctx.ConfirmUI} />`,
    children: html`
      <${PageSection} id="bp-notices" num="01" title=${c('secNotices')} count=${`${page.posts.length}${page.cursor ? '+' : ''} · ${c('newestFirst')}`} doors=${catDoors} first>
        ${ctx.pageLoading === id && !page.posts.length ? html`<${Note} kind="loading">${t('common.loading')}<//>`
          : !posts.length ? html`<${Note} kind="quiet">${c('noticesEmpty')}<//>`
          : posts.map(p => noticeRow(ctx, id, p, page.authors, false))}
        ${page.cursor ? html`<${More} label=${c('showMore')} disabled=${ctx.pageLoading === id} onMore=${loadMore} />` : null}
      <//>
      <${PageSection} id="bp-compose" num="02" title=${c('secPost')}>
        ${composer(ctx, b, cats)}
      <//>
      <${Section} fold clip id="bp-rules" num="03" title=${c('secRules')} sub=${mine ? c('rulesSub') : c('rulesSubReader')} open=${ctx.folds.rules} onToggle=${() => ctx.setFold('rules', !ctx.folds.rules)}>${rulesFold(ctx, b, mine)}<//>`,
  });
}

function composer(ctx, b, cats) {
  const n = ctx.notice;
  const set = (k, v) => ctx.setNotice({ ...n, [k]: v });
  const cost = b.visibility === 'public' || b.visibility === 'system' ? b.rules?.post_cost : 0;
  const label = cost === 0 || cost === undefined && b.visibility !== 'public' ? c('publish') : cost !== undefined ? c('publishFor', { n: cost }) : c('publishPriced');
  const ttlDefault = String(b.rules?.default_ttl_hours ?? 168);
  const ttl = n.ttl || ttlDefault;
  const post = () => ctx.handlePost(bid(b));
  const side = html`
    <${Stack} gap="large">
      ${cats.length
        ? html`<${Choice} label=${c('fCategory')} clearable value=${n.category} onChange=${(v) => set('category', v)} options=${cats.map((cat) => [cat, cat])} />`
        : html`<${TextField} id="bp-n-cat" label=${c('fCategory')} value=${n.category} onInput=${(v) => set('category', v)} placeholder=${c('categoryFree')} />`}
      <${Choice} label=${c('fLifetime')} value=${ttl} onChange=${(v) => set('ttl', v)} options=${[['72', c('life3')], ['168', c('life7')], ['720', c('life30')]]} />
      <${Actions}><${Loud} control disabled=${ctx.posting || !n.title.trim() || !n.body.trim()} onClick=${post}>${label}<//><//>
    <//>`;
  return html`
    <${Beside} narrow side=${side}>
      <${Stack} gap="small">
        <${TextField} id="bp-n-title" label=${c('fTitle')} value=${n.title} onInput=${(v) => set('title', v)} placeholder=${c('titlePlaceholder')} />
        <${TextArea} id="bp-n-body" rows=${3} ariaLabel=${c('bodyPlaceholder')} value=${n.body} onInput=${(v) => set('body', v)} placeholder=${c('bodyPlaceholder')} />
      <//>
    <//>
    <${Hint}>${c('postHint')}<//>`;
}

function rulesFold(ctx, b, mine) {
  const r = ctx.rules;
  const set = (k, v) => ctx.setRules({ ...r, [k]: v });
  const choice = (key, label, options, hint) => html`<${Choice} label=${label} hint=${hint} disabled=${!mine} value=${r[key]} onChange=${(v) => mine && set(key, v)} options=${options} />`;
  const save = () => ctx.handleSaveRules(bid(b));
  const remove = () => ctx.handleDeleteBoard(bid(b));
  return html`
    <${Fields} cols=${2}>
      ${choice('visibility', c('fSees'), [['private', c('seesMe')], ['shared', c('seesChosen')], ['public', c('seesAll')]])}
      ${choice('posting', c('fPosts'), [['owner', c('postsMe')], ['members', c('postsMembers')], ['anyone', c('postsAnyone')]])}
      <${TextField} id="bp-r-cats" label=${c('fCategories')} value=${r.categories} disabled=${!mine} onInput=${(v) => set('categories', v)} placeholder=${c('categoriesPlaceholder')} />
      ${choice('ttl', c('fLifetime'), [['72', c('life3')], ['168', c('life7')], ['720', c('life30')], ['8760', c('lifeYear')]])}
      ${r.visibility === 'public' ? html`
        <${TextField} id="bp-r-price" size="short" label=${c('fPrice')} hint=${c('priceHint')} type="number" min="0" step="1" value=${r.price} disabled=${!mine} onInput=${(v) => set('price', v)} />
        ${choice('federate', c('federate'), [['no', c('federateNo')], ['yes', c('federateYes')]], c('federateHint'))}` : null}
    <//>
    ${mine ? html`<${Space} above="large"><${Actions}><${Loud} control disabled=${ctx.savingRules} onClick=${save}>${c('saveRules')}<//><//><//>` : null}
    ${mine && (b.visibility === 'shared' || r.visibility === 'shared') ? membersBlock(ctx, b) : null}
    ${mine ? html`<${Split} above="small" pad="large"><${Actions}><${Action} small tone="danger" onClick=${remove}>${c('deleteBoard')}<//><//><//>` : null}`;
}

function membersBlock(ctx, b) {
  const members = b.allowed_gaiis || [];
  const add = () => ctx.handleAddMember(bid(b));
  const removeMember = (g) => () => ctx.handleRemoveMember(bid(b), g);
  return html`
    <${Split} pad="large" gap="small">
      <${Label} block>${c('members')}<//>
      <${Hint}>${c('membersHint')}<//>
      ${members.length ? html`<${Marks}>${members.map(g => html`<${Mark} key=${g} removeLabel=${c('remove')} onRemove=${removeMember(g)}>${who(g).label}<//>`)}<//>` : null}
      <${TextField} value=${ctx.memberInput} onInput=${(v) => ctx.setMemberInput(v)} placeholder=${c('memberPlaceholder')} ariaLabel=${c('memberPlaceholder')} onEnter=${add}
        actions=${html`<${Action} small disabled=${!ctx.memberInput.trim()} onClick=${add}>${c('addMember')}<//>`} />
    <//>`;
}

export { standingWords };
