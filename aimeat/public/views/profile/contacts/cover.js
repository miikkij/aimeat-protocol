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
 *   2026-09-22 -- Composed from the shared set: Page with an index Rail, the strip is a plain
 *     NumeralBand, filters are tab actions, the search is a Field; no class of its own.
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-08-30 — Initial. Replaces the two flat lists whose "people you messaged" was mostly agents.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Page, Rail, Section, Fold, Stack, Chip, Action, Field, Text, NumeralBand, KeyValue } from '/components/poster-parts.js';
import { c, rel, nameOf, crumb, pageLinks, peopleRows, noAccountRows, agentRows, sortPeople } from './frame.js';
import { renderPerson } from './person.js';
import { addBody } from './add.js';

const PAGE = 12;
/** The search field takes the focus once, when it opens (the old input's autofocus). */
const focusOnce = (el) => { if (el && !el.dataset.focused) { el.dataset.focused = 'yes'; el.focus(); } };

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
  const chip = (n, key, tone = 'plain') => html`<${Chip} tone=${tone}>${c(key, { n })}<//>`;
  const strip = html`<${NumeralBand} tone="plain" size="small" items=${[
    { label: c('stripLast'), value: latest ? rel(latest.last_message_at) : '·', note: latest ? `${nameOf(latest)} · ${latest.last_message || ''}` : c('noMessagesYet') },
    { label: c('stripInvites'), value: invitesOpen, tone: invitesOpen ? 'coral' : undefined, note: invitesOpen ? noAccount.filter(r => r.invitation).map(r => `${nameOf(r)} · ${c('sentOn', { when: rel(r.invitation.created_at) })}`).join(' · ') : c('stripInvitesNone') },
    { label: c('stripShared'), value: sharedTotal, note: sharedNames || c('stripSharedNone') },
    { label: c('stripSaved'), value: savedByMe, note: c('stripSavedSub', { n: Math.max(0, ctx.contacts.length - savedByMe) }) },
  ]} />`;
  const entries = [['ct-people', c('secPeople'), people.length], ['ct-noaccount', c('secNoAccount'), noAccount.length], ['ct-agents', c('secAgents'), agents.length], ['ct-add', c('add')], ['ct-where', c('whereTitle')]]
    .map(([id, label, count]) => ({ id, href: '#' + id, label, count }));
  return html`<${Page} title=${t('contacts.title')} crumbs=${crumb(ctx, [])}
    identity=${html`<${Stack} direction="wrap" density="compact">
      ${chip(people.length, 'chipPeople')}${noAccount.length ? chip(noAccount.length, 'chipNoAccount') : null}${agents.length ? chip(agents.length, 'chipAgents') : null}${invitesOpen ? chip(invitesOpen, 'chipInvites', 'sun') : null}${ctx.blockedCount ? chip(ctx.blockedCount, 'chipBlocked', 'muted') : null}
    <//>`}
    actions=${html`<${Action} kind="primary" onClick=${() => ctx.openAdd('name')}>${c('add')}<//><${Action} onClick=${() => ctx.copyPrompt()}>${c('promptToChat')}<//>`}
    rail=${html`<${Rail} kind="index" title=${c('railTitle')} entries=${entries}>${pageLinks(ctx)}<//>`}>
    <${Text} kind="lead" tone="muted">${c('desc')}<//>
    ${strip}
    ${secPeople(ctx)}
    ${secNoAccount(ctx)}
    ${secAgents(ctx)}
    <${Fold} id="ct-add" number="04" title=${c('add')} sub=${c('addSub')} open=${ctx.folds.add} onToggle=${() => ctx.setFold('add', !ctx.folds.add)}>${addBody(ctx)}<//>
    <${Fold} id="ct-where" number="05" title=${c('whereTitle')} sub=${c('whereSub')} open=${ctx.folds.where} onToggle=${() => ctx.setFold('where', !ctx.folds.where)}>${whereUsed()}<//>
    <${ctx.ConfirmUI} />
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
  const shown = ctx.showAll ? list : list.slice(0, PAGE);
  const door = (key, label) => html`<${Action} key=${key} kind="tab" selected=${f === key} onClick=${() => ctx.setPeopleFilter(key)}>${label}<//>`;
  const doors = html`${door('all', c('all'))}${door('saved', c('savedOnes'))}${relations.map(r => door(r, r))}<${Action} kind="tab" selected=${ctx.searchOpen} onClick=${() => ctx.setSearchOpen(!ctx.searchOpen)}>${c('search')}<//>`;
  return html`
    <${Section} id="ct-people" title=${c('secPeople')} count=${`${ctx.people.length} · ${c('secPeopleSub')}`} actions=${doors} density="compact">
      <${Stack}>
        ${ctx.searchOpen ? html`<${Field} type="search" label=${c('search')} placeholder=${c('searchPlaceholder')} value=${ctx.q} onInput=${e => ctx.setQ(e.target.value)} inputRef=${focusOnce} />` : null}
        ${ctx.loading && !ctx.contacts.length ? html`<${Text} tone="muted">${t('common.loading')}<//>`
          : !shown.length ? html`<${Text} tone="muted">${ctx.people.length ? c('emptyFiltered') : c('emptyPeople')}<//>`
          : peopleRows(ctx, shown)}
        ${list.length > shown.length ? html`<${Stack} direction="wrap"><${Action} onClick=${() => ctx.setShowAll(true)}>${c('showRest', { n: list.length - shown.length })}<//><//>` : null}
        ${ctx.truncated ? html`<${Text} kind="caption" tone="danger">${c('truncated')}<//>` : null}
        <${Text} kind="caption" tone="muted">${c('peopleHint')}<//>
      <//>
    <//>`;
}

function secNoAccount(ctx) {
  const doors = html`<${Action} onClick=${() => ctx.openAdd('person')}>${c('writeDown')}<//>`;
  return html`
    <${Section} id="ct-noaccount" title=${c('secNoAccount')} count=${ctx.noAccount.length} actions=${doors} density="compact">
      <${Stack}>
        ${!ctx.noAccount.length ? html`<${Text} tone="muted">${c('emptyNoAccount')}<//>` : noAccountRows(ctx, ctx.noAccount)}
        <${Text} kind="caption" tone="muted">${c('noAccountHint')}<//>
      <//>
    <//>`;
}

function secAgents(ctx) {
  const mine = ctx.agents.filter(r => r.owner === ctx.me), others = ctx.agents.filter(r => r.owner !== ctx.me);
  const list = ctx.agentsFilter === 'mine' ? mine : others;
  const doors = html`<${Action} kind="tab" selected=${ctx.agentsFilter !== 'mine'} onClick=${() => ctx.setAgentsFilter('others')}>${c('othersN', { n: others.length })}<//><${Action} kind="tab" selected=${ctx.agentsFilter === 'mine'} onClick=${() => ctx.setAgentsFilter('mine')}>${c('mineN', { n: mine.length })}<//>`;
  return html`
    <${Section} id="ct-agents" title=${c('secAgents')} count=${`${ctx.agents.length} · ${c('secAgentsSub')}`} actions=${doors} density="compact">
      <${Stack}>
        ${!list.length ? html`<${Text} tone="muted">${ctx.agentsFilter === 'mine' ? c('emptyMine') : c('emptyOthers')}<//>` : agentRows(ctx, sortPeople(list))}
        <${Text} kind="caption" tone="muted">${c('agentsHint')}<//>
      <//>
    <//>`;
}

/** Where contacts are used: the six doors, once. */
function whereUsed() {
  const rows = ['organism', 'workspace', 'group', 'message', 'wallet', 'app'];
  return html`<${Stack}>${rows.map(k => html`<${KeyValue} key=${k} label=${c('where.' + k + 'T')} value=${c('where.' + k + 'D')} />`)}
    <${Text} kind="caption" tone="muted">${c('whereHint')}<//><//>`;
}
