/**
 * @file public/views/profile/contacts/cover.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Contacts page in the poster face (design canvas "AIMEAT Kontaktien sivu",
 *   direction A). The COVER reads the address book through people: the people with an account
 *   (relation, tags, shared organisms, last message; a message door and their page), the people
 *   without one (with an invitation), the agents and apps under the person they belong to, and
 *   two folds: the three roads to add someone, and where contacts are used. A person opens as
 *   their own page (person.js). Pure render functions over the ctx bag.
 * @structure renderContactsView · renderCover · secPeople · secNoAccount · secAgents · whereUsed
 * @usage import { renderContactsView } from './contacts/cover.js';
 * @version-history
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
import { scrollTo } from '/views/profile/organisms/poster-parts.js';
import { c, rel, nameOf, crumb, pageLinks, peopleRows, noAccountRows, agentRows, sortPeople } from './frame.js';
import { renderPerson } from './person.js';
import { addBody } from './add.js';
import { Hint } from '/components/Hint.js';

const PAGE = 12;

export function renderContactsView(ctx) {
  if (ctx.view.kind === 'person') {
    const row = ctx.rowOf(ctx.view.id);
    if (row) return renderPerson(ctx, row);
  }
  return renderCover(ctx);
}

function renderCover(ctx) {
  const people = ctx.people, noAccount = ctx.noAccount, agents = ctx.agents;
  const invitesOpen = noAccount.filter(r => r.invitation).length;
  const latest = sortPeople(people.filter(r => r.last_message_at))[0];
  const savedByMe = ctx.contacts.filter(r => r.origin === 'saved').length;
  const sharedTotal = people.reduce((n, r) => n + (r.shared_organisms || []).length, 0);
  const sharedNames = (() => { const m = new Map(); for (const r of people) for (const o of r.shared_organisms || []) m.set(o.name, (m.get(o.name) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, k]) => `${n} ${k}`).join(' · '); })();
  const chip = (n, key, cls = '') => html`<span class=${`poster-chip ${cls}`}>${c(key, { n })}</span>`;
  const strip = html`
    <div class="og-strip">
      <div>${latest ? html`<b>${rel(latest.last_message_at)}</b><span>${c('stripLast')}</span><small>${nameOf(latest)} · ${latest.last_message || ''}</small>` : html`<b>·</b><span>${c('stripLast')}</span><small>${c('noMessagesYet')}</small>`}</div>
      <div><b class=${invitesOpen ? 'og-strip-coral' : ''}>${invitesOpen}</b><span>${c('stripInvites')}</span><small>${invitesOpen ? noAccount.filter(r => r.invitation).map(r => `${nameOf(r)} · ${c('sentOn', { when: rel(r.invitation.created_at) })}`).join(' · ') : c('stripInvitesNone')}</small></div>
      <div><b>${sharedTotal}</b><span>${c('stripShared')}</span><small>${sharedNames || c('stripSharedNone')}</small></div>
      <div><b>${savedByMe}</b><span>${c('stripSaved')}</span><small>${c('stripSavedSub', { n: Math.max(0, ctx.contacts.length - savedByMe) })}</small></div>
    </div>`;
  return html`
    <div class="og og-ct">
      ${crumb(ctx, [])}
      <div class="og-mast">
        <div class="og-mast-words">
          <h1 class="og-title poster-page-title">${t('contacts.title')}</h1>
          <div class="poster-chips">
            ${chip(people.length, 'chipPeople')}${noAccount.length ? chip(noAccount.length, 'chipNoAccount') : null}${agents.length ? chip(agents.length, 'chipAgents') : null}${invitesOpen ? chip(invitesOpen, 'chipInvites', 'poster-chip--coral') : null}${ctx.blockedCount ? chip(ctx.blockedCount, 'chipBlocked') : null}
          </div>
          <p class="og-desc">${c('desc')}</p>
        </div>
        <div class="og-mast-actions">
          <button type="button" class="poster-slab" onClick=${() => ctx.openAdd('name')}>${c('add')}</button>
          <div class="og-doors"><button type="button" class="poster-action poster-action--small" onClick=${() => ctx.copyPrompt()}>${c('promptToChat')}</button></div>
        </div>
      </div>
      ${strip}
      <div class="og-grid">
        <div class="og-main">
          ${secPeople(ctx)}
          ${secNoAccount(ctx)}
          ${secAgents(ctx)}
          <${FoldSection} id="ct-add" num="04" title=${c('add')} sub=${c('addSub')} open=${ctx.folds.add} onToggle=${() => ctx.setFold('add', !ctx.folds.add)}>${addBody(ctx)}<//>
          <${FoldSection} id="ct-where" num="05" title=${c('whereTitle')} sub=${c('whereSub')} open=${ctx.folds.where} onToggle=${() => ctx.setFold('where', !ctx.folds.where)}>${whereUsed()}<//>
        </div>
        <nav class="og-rail" aria-label=${c('railTitle')}>
          <span class="og-rail-label">${c('railTitle')}</span>
          ${[['01', 'ct-people', c('secPeople'), people.length], ['02', 'ct-noaccount', c('secNoAccount'), noAccount.length], ['03', 'ct-agents', c('secAgents'), agents.length], ['04', 'ct-add', c('add'), ''], ['05', 'ct-where', c('whereTitle'), '']]
            .map(([n, id, label, count]) => html`<button type="button" class="og-rail-link" key=${id} onClick=${() => scrollTo(id)}><i>${n}</i>${label}<em>${count}</em></button>`)}
          <hr />
          <span class="og-rail-label">${c('pages')}</span>
          ${pageLinks(ctx)}
        </nav>
      </div>
      <${ctx.ConfirmUI} />
    </div>`;
}

function secPeople(ctx) {
  const relations = (() => { const m = new Map(); for (const r of ctx.people) if (r.relation) m.set(r.relation, (m.get(r.relation) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k); })();
  const f = ctx.peopleFilter;
  const q = ctx.q.trim().toLowerCase();
  let list = sortPeople(ctx.people);
  if (f === 'saved') list = list.filter(r => r.origin === 'saved');
  else if (f && f !== 'all') list = list.filter(r => r.relation === f);
  if (q) list = list.filter(r => nameOf(r).toLowerCase().includes(q) || r.contact_id.toLowerCase().includes(q) || (r.email || '').toLowerCase().includes(q) || (r.tags || []).some(x => x.toLowerCase().includes(q)));
  const shown = ctx.showAll ? list : list.slice(0, PAGE);
  const door = (key, label) => html`<button type="button" key=${key} class=${`poster-tab poster-tab--fold ${f === key ? 'is-on' : ''}`} onClick=${() => ctx.setPeopleFilter(key)}>${label}</button>`;
  const doors = html`${door('all', c('all'))}${door('saved', c('savedOnes'))}${relations.map(r => door(r, r))}<button type="button" class=${`poster-tab poster-tab--fold ${ctx.searchOpen ? 'is-on' : ''}`} aria-pressed=${ctx.searchOpen ? 'true' : 'false'} onClick=${() => ctx.setSearchOpen(!ctx.searchOpen)}>${c('search')}</button>`;
  return html`
    <${PageSection} id="ct-people" num="01" title=${c('secPeople')} count=${`${ctx.people.length} · ${c('secPeopleSub')}`} doors=${doors} first>
      ${ctx.searchOpen ? html`<input class="og-input ct-search" placeholder=${c('searchPlaceholder')} value=${ctx.q} onInput=${e => ctx.setQ(e.target.value)} autofocus />` : null}
      ${ctx.loading && !ctx.contacts.length ? html`<p class="poster-quiet ct-loading">${t('common.loading')}</p>`
        : !shown.length ? html`<p class="poster-quiet">${ctx.people.length ? c('emptyFiltered') : c('emptyPeople')}</p>`
        : peopleRows(ctx, shown)}
      ${list.length > shown.length ? html`<div class="og-doors ct-more"><button type="button" class="poster-action poster-action--more" onClick=${() => ctx.setShowAll(true)}>${c('showRest', { n: list.length - shown.length })}</button></div>` : null}
      ${ctx.truncated ? html`<p class="poster-hint ct-bad">${c('truncated')}</p>` : null}
      <${Hint}>${c('peopleHint')}<//>
    <//>`;
}

function secNoAccount(ctx) {
  const doors = html`<button type="button" class="poster-action poster-action--small" onClick=${() => ctx.openAdd('person')}>${c('writeDown')}</button>`;
  return html`
    <${PageSection} id="ct-noaccount" num="02" title=${c('secNoAccount')} count=${ctx.noAccount.length} doors=${doors}>
      ${!ctx.noAccount.length ? html`<p class="poster-quiet">${c('emptyNoAccount')}</p>` : noAccountRows(ctx, ctx.noAccount)}
      <${Hint}>${c('noAccountHint')}<//>
    <//>`;
}

function secAgents(ctx) {
  const mine = ctx.agents.filter(r => r.owner === ctx.me), others = ctx.agents.filter(r => r.owner !== ctx.me);
  const list = ctx.agentsFilter === 'mine' ? mine : others;
  const doors = html`<button type="button" class=${`poster-tab poster-tab--fold ${ctx.agentsFilter !== 'mine' ? 'is-on' : ''}`} onClick=${() => ctx.setAgentsFilter('others')}>${c('othersN', { n: others.length })}</button><button type="button" class=${`poster-tab poster-tab--fold ${ctx.agentsFilter === 'mine' ? 'is-on' : ''}`} onClick=${() => ctx.setAgentsFilter('mine')}>${c('mineN', { n: mine.length })}</button>`;
  return html`
    <${PageSection} id="ct-agents" num="03" title=${c('secAgents')} count=${`${ctx.agents.length} · ${c('secAgentsSub')}`} doors=${doors}>
      ${!list.length ? html`<p class="poster-quiet">${ctx.agentsFilter === 'mine' ? c('emptyMine') : c('emptyOthers')}</p>` : agentRows(ctx, sortPeople(list))}
      <${Hint}>${c('agentsHint')}<//>
    <//>`;
}

/** Where contacts are used: the six doors, once. */
function whereUsed() {
  const rows = ['organism', 'workspace', 'group', 'message', 'wallet', 'app'];
  return html`<div class="listing listing--name-name ct-where">${rows.map(k => html`<div class="listing-row" key=${k}><div class="listing-name">${c('where.' + k + 'T')}<small class="listing-meta">${c('where.' + k + 'D')}</small></div></div>`)}</div><${Hint}>${c('whereHint')}<//>`;
}
