/**
 * @file public/views/profile/contacts/cover.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Contacts page in the poster face (design canvas "AIMEAT Kontaktien sivu",
 *   direction A). The COVER reads the address book through people: the people with an account
 *   (relation, tags, shared organisms, last message; a message door and their page), the people
 *   without one (with an invitation), the agents and apps under the person they belong to, and
 *   the fold with the three roads to add someone. The page's start (PageStart: what the address
 *   book is for, the prompt that adds a person, the add fold as its button) and the title's
 *   question mark (concept.contact: what an entry is and the six places the book is used). A
 *   person opens as their own page (person.js). Pure render functions over the ctx bag. How the
 *   page explains itself: .claude/rules/page-guidance.md.
 * @structure renderContactsView · renderCover · secPeople · secNoAccount · secAgents
 * @usage import { renderContactsView } from './contacts/cover.js';
 * @version-history
 *   v1.16.1 -- 2026-11-28 -- The head's prompt copy reads common.copyForAi ("Copy the prompt for your
 *     AI"), the one name of a prompt copy.
 *   v1.16.0 -- 2026-11-27 -- Where the book stands is a figure strip with hideZeros (everyone in it, first messages that
 *     wait for the person's answer in the notice tone, open invitations, who was messaged last), from the list the page
 *     already reads; the head keeps only the blocked mark. A pending first message comes first among the people and the
 *     agents, and its row says so. "No account yet" and "Agents and apps" are drawn once they hold someone, numbered
 *     after the filter; the add row is always drawn. With nobody in the book the page is People with one line that says
 *     how someone gets in. The head's Add is drawn quiet while the add row is open, so its own button is the one loud
 *     action. No control was removed.
 *   v1.15.1 -- 2026-11-14 -- The contact search is a TextField `search`: a find field the browser's
 *     autofill cannot fill with the sign-in name (js/find-field-guard.js).
 *   v1.15.0 -- 2026-11-08 -- The page explains itself the designed way (.claude/rules/page-guidance.md):
 *     PageStart and the title's question mark concept.contact; the fold "Where contacts are used"
 *     (ct-where) is gone, its six places are in the concept.
 *   v1.14.0 -- 2026-10-26 -- The saved card's "the other N came from messages" counts the rows of origin 'message'; it took everything not saved, colleagues included.
 *   v1.13.0 -- 2026-10-16 -- A failed first load shows the could-not-load note with Retry under People and
 *     no "nobody yet" line in the other sections (ctx.contactsFailed) (QA audit F6-05).
 *   v1.12.0 -- 2026-09-26 -- Every part is a kit component (SettingsPage with its head, strip and rail as data; FigureStrip; Tabs and Tab in their fold tone; TextField; List; More; Note; Tinted; Action): the page passes data and writes no class. Put back from main: the blocked people are a dim tag (page group G8).
 *   v1.11.0 -- 2026-09-26 -- "Where" is the Listing (listing, listing-row, the name with its line; cut name-name, two to a line), a unification: the look most tabs use.
 *   v1.10.0 -- 2026-09-26 -- The line under each place in "Where" is the Listing's typewriter line (.listing-meta), a unification: Jouni's decision "Meta line".
 *   v1.9.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.8.0 -- 2026-09-25 -- The search button, which shows the search line and stays pressed while it is shown, is the Tab's fold tone (.poster-tab--fold, is-on and aria-pressed while shown), a unification: Jouni's decision "Tabs and filters".
 *   v1.7.0 -- 2026-09-25 -- The people table carries its own heading row (the Listing, css/components/listing.css), a unification: the look most tabs use.
 *   v1.6.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.5.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
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
 *   v1.0.0 — 2026-08-30 — Initial. Replaces the two flat lists whose "people you messaged" was mostly agents.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { PageSection } from '/components/PageSection.js';
import { FoldSection } from '/components/FoldSection.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { More } from '/components/List.js';
import { PageStart } from '/components/PageStart.js';
import { Tabs, Tab } from '/components/Tabs.js';
import { Tinted } from '/components/Figure.js';
import { TextField } from '/components/TextField.js';
import { Note } from '/components/Note.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Space } from '/components/Layout.js';
import { c, rel, nameOf, crumb, pageLinks, peopleRows, noAccountRows, agentRows, sortPeople } from './frame.js';
import { renderPerson } from './person.js';
import { addBody } from './add.js';
import { Hint } from '/components/Hint.js';
import { LoadFailed } from '/js/load-state.js';

const PAGE = 12;

export function renderContactsView(ctx) {
  if (ctx.view.kind === 'person') {
    const row = ctx.rowOf(ctx.view.id);
    if (row) return renderPerson(ctx, row);
  }
  return renderCover(ctx);
}

/** A first message from them waits for the owner's answer (the message gate's pending state). */
const waitsForYou = (r) => r.state === 'pending';
/** The rows that need the person first, then the order they came in (stable). */
const waitingFirst =(rows) => [...rows.filter(waitsForYou), ...rows.filter(r => !waitsForYou(r))];

function renderCover(ctx) {
  const people = ctx.people, noAccount = ctx.noAccount, agents = ctx.agents;
  const invitesOpen = noAccount.filter(r => r.invitation).length;
  const latest = sortPeople(people.filter(r => r.last_message_at))[0];
  const waiting = ctx.contacts.filter(waitsForYou);
  const loadingFirst = ctx.loading && !ctx.contacts.length;
  const mark = (n, key, tone) => ({ label: c(key, { n }), tone });
  // Where the book stands, from the list the page already read: everyone in it, the first messages
  // that wait for the person's answer, the invitations still open, and who was messaged last. With
  // nobody in the book every figure is zero or "·" and the strip is not drawn (hideZeros).
  const strip = ctx.contactsFailed ? null : loadingFirst ? html`<${FigureStrip} loading=${4} />` : html`<${FigureStrip} hideZeros items=${[
    { key: 'all', n: ctx.contacts.length, label: c('stripAll'), sub: ctx.contacts.length ? c('stripAllSub', { p: people.length + noAccount.length, a: agents.length }) : undefined },
    { key: 'waiting', n: waiting.length, tone: waiting.length ? 'notice' : undefined, label: c('stripWaiting'),
      sub: waiting.length ? c('stripWaitingSub', { who: waiting.slice(0, 2).map(nameOf).join(' · ') }) : undefined },
    { key: 'invites', n: invitesOpen, label: c('stripInvites'),
      sub: invitesOpen ? noAccount.filter(r => r.invitation).map(r => `${nameOf(r)} · ${c('sentOn', { when: rel(r.invitation.created_at) })}`).join(' · ') : c('stripInvitesNone') },
    latest
      ? { key: 'last', n: rel(latest.last_message_at), label: c('stripLast'), sub: `${nameOf(latest)} · ${latest.last_message || ''}` }
      : { key: 'last', n: '·', label: c('stripLast'), sub: c('noMessagesYet') },
  ]} />`;
  const savedByMe = ctx.contacts.filter(r => r.origin === 'saved').length;
  // The start: folded once the person has saved someone; its button opens the add fold.
  const start = html`<${PageStart} id="contacts"
    done=${ctx.contactsFailed || loadingFirst ? null : savedByMe > 0}
    action=${{ onClick: () => ctx.openAdd('name') }} />`;
  // What is drawn: People always (with nobody its one line is the page's empty line), the people
  // without an account and the agents once they hold someone, and the add row always, since it is
  // how one begins. Numbered after the filter, so a hidden section leaves no gap.
  const shown = [
    { id: 'ct-people', label: c('secPeople'), count: people.length },
    noAccount.length ? { id: 'ct-noaccount', label: c('secNoAccount'), count: noAccount.length } : null,
    agents.length ? { id: 'ct-agents', label: c('secAgents'), count: agents.length } : null,
    { id: 'ct-add', label: c('add'), count: '' },
  ].filter(Boolean).map((s, i) => ({ ...s, num: String(i + 1).padStart(2, '0') }));
  const numOf = Object.fromEntries(shown.map((s) => [s.id, s.num]));
  return html`
    <${SettingsPage} name="ct"
      crumb=${crumb(ctx, [])}
      title=${t('contacts.title')}
      help="concept.contact"
      start=${start}
      marks=${[
        // The people you blocked count nothing here: main's dim tag. The other counts are in the strip.
        ctx.blockedCount ? mark(ctx.blockedCount, 'chipBlocked', 'dim') : null,
      ]}
      desc=${c('desc')}
      actions=${html`
        ${/* While the add row is open its own button is the loud one, so the head's is drawn quiet. */''}
        <${Loud} quiet=${ctx.folds.add} onClick=${() => ctx.openAdd('name')}>${c('add')}<//>
        <${Actions}><${Action} small onClick=${() => ctx.copyPrompt()}>${t('common.copyForAi')}<//><//>`}
      strip=${strip}
      railTitle=${c('railTitle')}
      sections=${shown}
      pagesLabel=${c('pages')}
      pages=${pageLinks(ctx)}
      after=${html`<${ctx.ConfirmUI} />`}>
      ${secPeople(ctx)}
      ${numOf['ct-noaccount'] ? secNoAccount(ctx, numOf['ct-noaccount']) : null}
      ${numOf['ct-agents'] ? secAgents(ctx, numOf['ct-agents']) : null}
      <${FoldSection} id="ct-add" num=${numOf['ct-add']} title=${c('add')} sub=${c('addSub')} open=${ctx.folds.add} onToggle=${() => ctx.setFold('add', !ctx.folds.add)}>${addBody(ctx)}<//>
    <//>`;
}

function secPeople(ctx) {
  const relations = (() => { const m = new Map(); for (const r of ctx.people) if (r.relation) m.set(r.relation, (m.get(r.relation) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k); })();
  const f = ctx.peopleFilter;
  const q = ctx.q.trim().toLowerCase();
  let list = sortPeople(ctx.people);
  if (f === 'saved') list = list.filter(r => r.origin === 'saved');
  else if (f && f !== 'all') list = list.filter(r => r.relation === f);
  if (q) list = list.filter(r => nameOf(r).toLowerCase().includes(q) || r.contact_id.toLowerCase().includes(q) || (r.email || '').toLowerCase().includes(q) || (r.tags || []).some(x => x.toLowerCase().includes(q)));
  // A first message that waits for the person's answer comes first, so it is the first row they meet.
  list = waitingFirst(list);
  const shown = ctx.showAll ? list : list.slice(0, PAGE);
  // Nobody yet: the one line says what fills the book and how; with only people without an account
  // or agents in it, the line says that nobody with an account is saved yet.
  const empty = ctx.people.length ? c('emptyFiltered') : ctx.contacts.length ? c('emptyPeopleSome') : c('emptyPeople');
  // Which people show (all, the saved ones, one relation), and the search that stays pressed while it is shown.
  const doors = html`
    <${Tabs} tone="fold" value=${f} onSelect=${(v) => ctx.setPeopleFilter(v)}
      items=${[{ value: 'all', label: c('all') }, { value: 'saved', label: c('savedOnes') }, ...relations.map(r => ({ value: r, label: r }))]} />
    <${Tab} tone="fold" on=${ctx.searchOpen} pressed=${ctx.searchOpen} onClick=${() => ctx.setSearchOpen(!ctx.searchOpen)}>${c('search')}<//>`;
  return html`
    <${PageSection} id="ct-people" num="01" title=${c('secPeople')} count=${`${ctx.people.length} · ${c('secPeopleSub')}`} doors=${doors} first>
      ${ctx.searchOpen ? html`<${Space} below="medium"><${TextField} search size="medium" placeholder=${c('searchPlaceholder')} value=${ctx.q} onInput=${(v) => ctx.setQ(v)} autoFocus /><//>` : null}
      ${ctx.contactsFailed ? html`<${LoadFailed} onRetry=${ctx.reload} />`
        : ctx.loading && !ctx.contacts.length ? html`<${Note} kind="loading">${t('common.loading')}<//>`
        : !shown.length ? html`<${Note} kind="quiet">${empty}<//>`
        : peopleRows(ctx, shown)}
      ${list.length > shown.length ? html`<${More} onMore=${() => ctx.setShowAll(true)} label=${c('showRest', { n: list.length - shown.length })} />` : null}
      ${ctx.truncated ? html`<${Hint}><${Tinted} tone="notice">${c('truncated')}<//><//>` : null}
      ${ctx.people.length ? html`<${Hint}>${c('peopleHint')}<//>` : null}
    <//>`;
}

/** Drawn only once someone without an account is written down (renderCover); `n` is its number. */
function secNoAccount(ctx, n) {
  const doors = html`<${Action} small onClick=${() => ctx.openAdd('person')}>${c('writeDown')}<//>`;
  return html`
    <${PageSection} id="ct-noaccount" num=${n} title=${c('secNoAccount')} count=${ctx.noAccount.length} doors=${doors}>
      ${ctx.contactsFailed ? null : !ctx.noAccount.length ? html`<${Note} kind="quiet">${c('emptyNoAccount')}<//>` : noAccountRows(ctx, ctx.noAccount)}
      <${Hint}>${c('noAccountHint')}<//>
    <//>`;
}

/** Drawn only once an agent or an app is in the book (renderCover); `n` is its number. */
function secAgents(ctx, n) {
  const mine = ctx.agents.filter(r => r.owner === ctx.me), others = ctx.agents.filter(r => r.owner !== ctx.me);
  const list = ctx.agentsFilter === 'mine' ? mine : others;
  const doors = html`<${Tabs} tone="fold" value=${ctx.agentsFilter === 'mine' ? 'mine' : 'others'} onSelect=${(v) => ctx.setAgentsFilter(v)}
    items=${[{ value: 'others', label: c('othersN', { n: others.length }) }, { value: 'mine', label: c('mineN', { n: mine.length }) }]} />`;
  return html`
    <${PageSection} id="ct-agents" num=${n} title=${c('secAgents')} count=${`${ctx.agents.length} · ${c('secAgentsSub')}`} doors=${doors}>
      ${ctx.contactsFailed ? null : !list.length ? html`<${Note} kind="quiet">${ctx.agentsFilter === 'mine' ? c('emptyMine') : c('emptyOthers')}<//>` : agentRows(ctx, waitingFirst(sortPeople(list)))}
      <${Hint}>${c('agentsHint')}<//>
    <//>`;
}
