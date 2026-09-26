/**
 * @file public/views/profile/contacts/person.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A person's page inside the Contacts tab (design canvas "AIMEAT Kontaktien sivu",
 *   direction A). It answers four questions: who this is (the mast and what the owner wrote
 *   down, editable in place), what we have done together (shared organisms with their
 *   workspaces, the person's agents), the last messages, and what I can do now (message, invite
 *   into an organism I manage, share a workspace, and behind a fold the message gate and the
 *   removal, which keeps the history). A person without an account gets the same page without
 *   the together and messages sections, and an invitation door.
 * @structure renderPerson · secKnow · secTogether · secMessages · foldPermissions · orgChooser
 * @usage import { renderPerson } from './person.js';
 * @version-history
 *   v1.14.0 -- 2026-09-26 -- What you share with a person is the Listing (listing, listing-row, the name with its line; cut name-name, two to a line), a unification: the look most tabs use.
 *   v1.13.0 -- 2026-09-26 -- The line under an organism or an agent you share is the Listing's typewriter line (.listing-meta), a unification: Jouni's decision "Meta line".
 *   v1.12.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.11.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.10.0 -- 2026-09-25 -- "Invite to an organism" and "Edit", which show a panel and stay pressed while it is shown, are the Tab's fold tone (.poster-tab--fold, is-on and aria-pressed while shown), a unification: Jouni's decision "Tabs and filters".
 *   v1.9.0 — 2026-09-25 — A person's links are the small link (.poster-action--more), a unification: Jouni's decision "Small link".
 *   v1.8.0 — 2026-09-25 — What the owner knows about a person and the permissions are the Facts (css/components/facts.css), a unification: the look most tabs use.
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
 *   v1.1.0 — 2026-09-25 — The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { PageSection } from '/components/PageSection.js';
import { FoldSection } from '/components/FoldSection.js';
import { PresenceDot } from '/components/PresenceDot.js';
import { c, rel, day, nameOf, parts, kindWord, stateWord, originWords, isPerson, renderPage } from './frame.js';
import { personForm } from './add.js';
import { Hint } from '/components/Hint.js';

export function renderPerson(ctx, row) {
  const tg = ctx.personData?.together || null;
  const person = isPerson(row);
  const mail = row.kind === 'mail';
  const chips = html`
    ${row.relation ? html`<span class="poster-chip poster-chip--ink">${row.relation}</span>` : null}
    ${(row.tags || []).map(x => html`<span class="poster-chip" key=${x}>${x}</span>`)}
    <span class="poster-chip">${originWords(row)}</span>
    ${row.origin === 'saved' && row.message_count ? html`<span class="poster-chip">${c('messagedTimes', { n: row.message_count })}</span>` : null}`;
  const doors = html`
    ${mail ? (row.invitation ? html`<span class="poster-chip">${c('inviteSent', { when: day(row.invitation.created_at) })}</span>` : html`<button type="button" class="poster-slab poster-slab--control" disabled=${ctx.busy} onClick=${() => ctx.invite(row)}>${c('invite')}</button>`)
      : html`<button type="button" class="poster-slab" onClick=${() => ctx.message(row.contact_id)}>${c('message')}</button>`}
    ${person ? html`<button type="button" class=${`poster-tab poster-tab--fold ${ctx.orgChooser ? 'is-on' : ''}`} aria-pressed=${ctx.orgChooser ? 'true' : 'false'} onClick=${() => ctx.toggleOrgChooser()}>${c('inviteToOrganism')}</button><button type="button" class="poster-action poster-action--small" onClick=${() => ctx.openTab('organisms')}>${c('shareWorkspace')}</button>` : null}
    <button type="button" class=${`poster-tab poster-tab--fold ${ctx.editing ? 'is-on' : ''}`} aria-pressed=${ctx.editing ? 'true' : 'false'} onClick=${() => ctx.startEdit(row)}>${c('edit')}</button>`;
  const strip = person ? html`
    <div class="og-strip">
      <div>${row.last_message_at ? html`<b>${rel(row.last_message_at)}</b><span>${c('stripLastOne')}</span><small>${row.last_sender === row.contact_id ? '' : c('youWrote') + ' '}${row.last_message || ''}</small>` : html`<b>·</b><span>${c('stripLastOne')}</span><small>${c('noMessagesYet')}</small>`}</div>
      <div><b>${tg ? tg.organisms.length : '·'}</b><span>${c('stripOrganisms')}</span><small>${tg ? (tg.organisms.map(o => o.name).join(' · ') || c('none')) : t('common.loading')}</small></div>
      <div><b>${tg ? tg.agents.length : '·'}</b><span>${c('stripAgents')}</span><small>${tg ? (tg.agents.map(a => a.display_name || parts(a.gaii).agent).join(' · ') || c('none')) : t('common.loading')}</small></div>
      <div><b>${tg ? tg.workspaces.length : '·'}</b><span>${c('stripWorkspaces')}</span><small>${tg ? (tg.workspaces.map(w => w.name).join(' · ') || c('none')) : t('common.loading')}</small></div>
    </div>` : null;
  const sameRelation = row.relation ? ctx.people.filter(r => r.contact_id !== row.contact_id && r.relation === row.relation).slice(0, 5) : [];
  const rail = html`
    ${tg?.agents?.length ? html`<hr /><span class="og-rail-label">${c('railTheirAgents')}</span>${tg.agents.map(a => html`<button type="button" class="og-rail-link" key=${a.gaii} onClick=${() => ctx.message(a.gaii)}><i>→</i>${a.display_name || parts(a.gaii).agent}<em>${a.last_message_at ? rel(a.last_message_at) : ''}</em></button>`)}` : null}
    ${sameRelation.length ? html`<hr /><span class="og-rail-label">${c('railSameRelation')}</span>${sameRelation.map(r => html`<button type="button" class="og-rail-link" key=${r.contact_id} onClick=${() => ctx.openPerson(r.contact_id)}><i>→</i>${nameOf(r)}<em></em></button>`)}` : null}`;
  return renderPage(ctx, {
    crumbs: [nameOf(row)],
    label: html`${kindWord(row.kind)} · ${mail ? row.email : parts(row.contact_id).owner}${person ? html` · <${PresenceDot} ghii=${row.contact_id} />` : null}`,
    title: nameOf(row), chips, doors, strip, rail,
    children: html`
      ${ctx.orgChooser ? orgChooser(ctx, row) : null}
      ${secKnow(ctx, row)}
      ${person ? secTogether(ctx, row, tg) : null}
      ${person || row.kind !== 'mail' ? secMessages(ctx, row) : null}
      ${foldPermissions(ctx, row)}
      <${ctx.ConfirmUI} />`,
  });
}

function secKnow(ctx, row) {
  const doors = ctx.editing ? null : html`<button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.startEdit(row)}>${c('edit')}</button>`;
  const verified = isPerson(row) && row.email;
  return html`
    <${PageSection} id="ct-know" num="01" title=${c('secKnow')} doors=${doors} first>
      ${ctx.editing ? personForm(ctx, { editing: true }) : html`
        <div class="facts">
          <div class="facts-k poster-label">${c('fEmail')}</div><div class="facts-v">${row.email || html`<span class="ct-dim">${c('unknown')}</span>`}${verified ? html` <small class="poster-hint">${c('verifiedOnAccount')}</small>` : null}</div>
          <div class="facts-k poster-label">${c('fRelation')}</div><div class="facts-v">${row.relation || html`<span class="ct-dim">${c('unknown')}</span>`}</div>
          <div class="facts-k poster-label">${c('fTags')}</div><div class="facts-v">${(row.tags || []).length ? html`<span class="poster-chips">${row.tags.map(x => html`<span class="poster-chip" key=${x}>${x}</span>`)}</span>` : html`<span class="ct-dim">${c('none')}</span>`}</div>
          <div class="facts-k poster-label">${c('fLinks')}</div><div class="facts-v">${(row.links || []).length ? row.links.map((l, i) => html`<a key=${i} class="poster-action poster-action--more ct-link" href=${l.url} target="_blank" rel="noopener noreferrer">${l.label || l.url}</a>`) : html`<span class="ct-dim">${c('none')}</span>`}</div>
          <div class="facts-k poster-label">${c('fNote')}</div><div class="facts-v">${row.note || html`<span class="ct-dim">${c('none')}</span>`}</div>
        </div>
        ${row.kind === 'mail' ? html`<${Hint}>${t('contacts.personHint')}<//>` : null}`}
    <//>`;
}

function secTogether(ctx, row, tg) {
  const roleWord = (r) => c('role.' + (r === 'creator' ? 'creator' : r === 'admin' ? 'admin' : 'member'));
  return html`
    <${PageSection} id="ct-together" num="02" title=${c('secTogether')} count=${c('secTogetherSub')}>
      ${!tg ? html`<p class="poster-quiet ct-loading">${t('common.loading')}</p>`
        : !tg.organisms.length && !tg.agents.length ? html`<p class="poster-quiet">${c('togetherNone')}</p>`
        : html`<div class="listing listing--name-name ct-where">
            ${tg.organisms.map(o => { const ws = tg.workspaces.filter(w => w.organism_id === o.id); return html`<div class="listing-row" key=${o.id}><div class="listing-name">${o.name}<small class="listing-meta">${roleWord(o.role)}${ws.length ? ' · ' + ws.map(w => w.name).join(', ') : ''}</small></div></div>`; })}
            ${tg.agents.map(a => html`<div class="listing-row" key=${a.gaii}><div class="listing-name">${a.display_name || parts(a.gaii).agent}<small class="listing-meta">${c('theirAgent')}${a.message_count ? ' · ' + c('messagedTimes', { n: a.message_count }) : ''}${a.last_seen ? ' · ' + c('seen', { when: rel(a.last_seen) }) : ''}</small></div></div>`)}
          </div>`}
    <//>`;
}

function secMessages(ctx, row) {
  const thread = ctx.personData?.thread;
  const doors = row.conversation_id ? html`<button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.openConversation(row.conversation_id)}>${c('openInMessages')}</button>` : null;
  return html`
    <${PageSection} id="ct-messages" num="03" title=${c('secMessages')} count=${row.message_count ? `${row.message_count} · ${c('secMessagesSub')}` : null} doors=${doors}>
      ${!row.conversation_id ? html`<p class="poster-quiet">${c('noMessagesYet')}</p><div class="og-doors"><button type="button" class="poster-action poster-action--small" onClick=${() => ctx.message(row.contact_id)}>${c('writeFirst')}</button></div>`
        : !thread ? html`<p class="poster-quiet ct-loading">${t('common.loading')}</p>`
        : !thread.length ? html`<p class="poster-quiet">${c('noMessagesYet')}</p>`
        : thread.slice(0, 3).map(m => html`<div class="ct-msg" key=${m.id}>${firstLines(m.body)}<small>${m.senderGhii === row.contact_id ? nameOf(row) : c('you')} · ${rel(m.createdAt)}</small></div>`)}
    <//>`;
}
const firstLines = (s) => String(s || '').split(/\r?\n/).filter(l => l.trim()).slice(0, 3).join(' ').slice(0, 240);

function foldPermissions(ctx, row) {
  return html`
    <${FoldSection} id="ct-perm" num="04" title=${c('permTitle')} sub=${c('permSub')} open=${ctx.folds.perm} onToggle=${() => ctx.setFold('perm', !ctx.folds.perm)}>
      <div class="facts">
        ${row.kind !== 'mail' ? html`<div class="facts-k poster-label">${c('permGate')}</div><div class="facts-v">${stateWord(row)}<div class="og-doors"><button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.openTab('messages')}>${c('manageInMessages')}</button></div></div>` : null}
        <div class="facts-k poster-label">${c('permRemove')}</div><div class="facts-v">${row.has_messages ? c('removeKeepsHistory') : row.kind === 'mail' ? c('removeDeletesCard') : c('removePlain')}<div class="og-doors"><button type="button" class="poster-action poster-action--small poster-action--danger" disabled=${ctx.busy} onClick=${() => ctx.remove(row)}>${c('removeFromBook')}</button></div></div>
      </div>
    <//>`;
}

/** The organisms the owner manages that this person is not in yet, one door each. */
function orgChooser(ctx, row) {
  const list = ctx.myOrganisms;
  const inAlready = new Set((ctx.personData?.together?.organisms || []).map(o => o.id));
  const candidates = list ? list.filter(o => !inAlready.has(o.id)) : null;
  return html`
    <div class="ct-box poster-box">
      <span class="poster-label">${c('inviteToOrganism')}</span>
      ${!candidates ? html`<p class="poster-quiet ct-loading">${t('common.loading')}</p>`
        : !candidates.length ? html`<p class="poster-quiet">${c('noOrganismsToInvite')}</p>`
        : html`<div class="og-doors">${candidates.map(o => html`<button type="button" class="poster-action poster-action--small" key=${o.id} disabled=${ctx.busy} onClick=${() => ctx.inviteToOrganism(o, row)}>${o.name}</button>`)}</div>`}
      <${Hint}>${c('inviteToOrganismHint', { name: nameOf(row) })}<//>
    </div>`;
}
