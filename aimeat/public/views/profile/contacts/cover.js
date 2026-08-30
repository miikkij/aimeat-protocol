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
 *   v1.0.0 — 2026-08-30 — Initial. Replaces the two flat lists whose "people you messaged" was mostly agents.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, Fold, scrollTo } from '/views/profile/organisms/poster-parts.js';
import { c, rel, nameOf, crumb, pageLinks, peopleRows, peopleHead, noAccountRows, agentRows, sortPeople } from './frame.js';
import { renderPerson } from './person.js';
import { addBody } from './add.js';

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
  const chip = (n, key, cls = '') => html`<span class=${`og-chip ${cls}`}>${c(key, { n })}</span>`;
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
          <h1 class="og-title">${t('contacts.title')}</h1>
          <div class="og-chips">
            ${chip(people.length, 'chipPeople')}${noAccount.length ? chip(noAccount.length, 'chipNoAccount') : null}${agents.length ? chip(agents.length, 'chipAgents') : null}${invitesOpen ? chip(invitesOpen, 'chipInvites', 'og-chip--coral') : null}${ctx.blockedCount ? chip(ctx.blockedCount, 'chipBlocked', 'og-chip--dim') : null}
          </div>
          <p class="og-desc">${c('desc')}</p>
        </div>
        <div class="og-mast-actions">
          <button type="button" class="og-slab" onClick=${() => ctx.openAdd('name')}>${c('add')}</button>
          <div class="og-doors"><button type="button" class="og-door" onClick=${() => ctx.copyPrompt()}>${c('promptToChat')}</button></div>
        </div>
      </div>
      ${strip}
      <div class="og-grid">
        <div class="og-main">
          ${secPeople(ctx)}
          ${secNoAccount(ctx)}
          ${secAgents(ctx)}
          <${Fold} id="ct-add" num="04" title=${c('add')} sub=${c('addSub')} open=${ctx.folds.add} onToggle=${() => ctx.setFold('add', !ctx.folds.add)}>${addBody(ctx)}<//>
          <${Fold} id="ct-where" num="05" title=${c('whereTitle')} sub=${c('whereSub')} open=${ctx.folds.where} onToggle=${() => ctx.setFold('where', !ctx.folds.where)}>${whereUsed()}<//>
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
  const door = (key, label) => html`<button type="button" key=${key} class=${`og-door og-door--quiet ${f === key ? 'on' : ''}`} onClick=${() => ctx.setPeopleFilter(key)}>${label}</button>`;
  const doors = html`${door('all', c('all'))}${door('saved', c('savedOnes'))}${relations.map(r => door(r, r))}<button type="button" class=${`og-door og-door--quiet ${ctx.searchOpen ? 'on' : ''}`} onClick=${() => ctx.setSearchOpen(!ctx.searchOpen)}>${c('search')}</button>`;
  return html`
    <${Section} id="ct-people" num="01" title=${c('secPeople')} count=${`${ctx.people.length} · ${c('secPeopleSub')}`} doors=${doors} first>
      ${ctx.searchOpen ? html`<input class="og-input ct-search" placeholder=${c('searchPlaceholder')} value=${ctx.q} onInput=${e => ctx.setQ(e.target.value)} autofocus />` : null}
      ${ctx.loading && !ctx.contacts.length ? html`<p class="og-empty ct-loading">${t('common.loading')}</p>`
        : !shown.length ? html`<p class="og-empty">${ctx.people.length ? c('emptyFiltered') : c('emptyPeople')}</p>`
        : html`${peopleHead()}${peopleRows(ctx, shown)}`}
      ${list.length > shown.length ? html`<div class="og-doors ct-more"><button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setShowAll(true)}>${c('showRest', { n: list.length - shown.length })}</button></div>` : null}
      ${ctx.truncated ? html`<p class="ct-hint ct-bad">${c('truncated')}</p>` : null}
      <p class="ct-hint">${c('peopleHint')}</p>
    <//>`;
}

function secNoAccount(ctx) {
  const doors = html`<button type="button" class="og-door" onClick=${() => ctx.openAdd('person')}>${c('writeDown')}</button>`;
  return html`
    <${Section} id="ct-noaccount" num="02" title=${c('secNoAccount')} count=${ctx.noAccount.length} doors=${doors}>
      ${!ctx.noAccount.length ? html`<p class="og-empty">${c('emptyNoAccount')}</p>` : noAccountRows(ctx, ctx.noAccount)}
      <p class="ct-hint">${c('noAccountHint')}</p>
    <//>`;
}

function secAgents(ctx) {
  const mine = ctx.agents.filter(r => r.owner === ctx.me), others = ctx.agents.filter(r => r.owner !== ctx.me);
  const list = ctx.agentsFilter === 'mine' ? mine : others;
  const doors = html`<button type="button" class=${`og-door og-door--quiet ${ctx.agentsFilter !== 'mine' ? 'on' : ''}`} onClick=${() => ctx.setAgentsFilter('others')}>${c('othersN', { n: others.length })}</button><button type="button" class=${`og-door og-door--quiet ${ctx.agentsFilter === 'mine' ? 'on' : ''}`} onClick=${() => ctx.setAgentsFilter('mine')}>${c('mineN', { n: mine.length })}</button>`;
  return html`
    <${Section} id="ct-agents" num="03" title=${c('secAgents')} count=${`${ctx.agents.length} · ${c('secAgentsSub')}`} doors=${doors}>
      ${!list.length ? html`<p class="og-empty">${ctx.agentsFilter === 'mine' ? c('emptyMine') : c('emptyOthers')}</p>` : agentRows(ctx, sortPeople(list))}
      <p class="ct-hint">${c('agentsHint')}</p>
    <//>`;
}

/** Where contacts are used: the six doors, once. */
function whereUsed() {
  const rows = ['organism', 'workspace', 'group', 'message', 'wallet', 'app'];
  return html`<div class="ct-where">${rows.map(k => html`<div key=${k}><b>${c('where.' + k + 'T')}</b><small>${c('where.' + k + 'D')}</small></div>`)}</div><p class="ct-hint">${c('whereHint')}</p>`;
}
