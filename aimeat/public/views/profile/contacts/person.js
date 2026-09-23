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
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, Fold } from '/views/profile/organisms/poster-parts.js';
import { PresenceDot } from '/components/PresenceDot.js';
import { c, rel, day, nameOf, parts, kindWord, stateWord, originWords, isPerson, renderPage } from './frame.js';
import { personForm } from './add.js';

export function renderPerson(ctx, row) {
  const tg = ctx.personData?.together || null;
  const person = isPerson(row);
  const mail = row.kind === 'mail';
  const chips = html`
    ${row.relation ? html`<span class="og-chip">${row.relation}</span>` : null}
    ${(row.tags || []).map(x => html`<span class="og-chip ct-chip--case" key=${x}>${x}</span>`)}
    <span class="og-chip og-chip--dim">${originWords(row)}</span>
    ${row.origin === 'saved' && row.message_count ? html`<span class="og-chip og-chip--dim">${c('messagedTimes', { n: row.message_count })}</span>` : null}`;
  const doors = html`
    ${mail ? (row.invitation ? html`<span class="og-chip og-chip--dim">${c('inviteSent', { when: day(row.invitation.created_at) })}</span>` : html`<button type="button" class="og-slab" disabled=${ctx.busy} onClick=${() => ctx.invite(row)}>${c('invite')}</button>`)
      : html`<button type="button" class="og-slab" onClick=${() => ctx.message(row.contact_id)}>${c('message')}</button>`}
    ${person ? html`<button type="button" class=${`og-door ${ctx.orgChooser ? 'on' : ''}`} onClick=${() => ctx.toggleOrgChooser()}>${c('inviteToOrganism')}</button><button type="button" class="og-door" onClick=${() => ctx.openTab('organisms')}>${c('shareWorkspace')}</button>` : null}
    <button type="button" class=${`og-door og-door--quiet ${ctx.editing ? 'on' : ''}`} onClick=${() => ctx.startEdit(row)}>${c('edit')}</button>`;
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
  const doors = ctx.editing ? null : html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.startEdit(row)}>${c('edit')}</button>`;
  const verified = isPerson(row) && row.email;
  return html`
    <${Section} id="ct-know" num="01" title=${c('secKnow')} doors=${doors} first>
      ${ctx.editing ? personForm(ctx, { editing: true }) : html`
        <div class="ct-kv">
          <div class="k">${c('fEmail')}</div><div class="v">${row.email || html`<span class="ct-dim">${c('unknown')}</span>`}${verified ? html` <small class="ct-hint">${c('verifiedOnAccount')}</small>` : null}</div>
          <div class="k">${c('fRelation')}</div><div class="v">${row.relation || html`<span class="ct-dim">${c('unknown')}</span>`}</div>
          <div class="k">${c('fTags')}</div><div class="v">${(row.tags || []).length ? html`<span class="ct-tags">${row.tags.map(x => html`<span class="ct-tag" key=${x}>${x}</span>`)}</span>` : html`<span class="ct-dim">${c('none')}</span>`}</div>
          <div class="k">${c('fLinks')}</div><div class="v">${(row.links || []).length ? row.links.map((l, i) => html`<a key=${i} class="ct-link" href=${l.url} target="_blank" rel="noopener noreferrer">${l.label || l.url}</a>`) : html`<span class="ct-dim">${c('none')}</span>`}</div>
          <div class="k">${c('fNote')}</div><div class="v">${row.note || html`<span class="ct-dim">${c('none')}</span>`}</div>
        </div>
        ${row.kind === 'mail' ? html`<p class="ct-hint">${t('contacts.personHint')}</p>` : null}`}
    <//>`;
}

function secTogether(ctx, row, tg) {
  const roleWord = (r) => c('role.' + (r === 'creator' ? 'creator' : r === 'admin' ? 'admin' : 'member'));
  return html`
    <${Section} id="ct-together" num="02" title=${c('secTogether')} count=${c('secTogetherSub')}>
      ${!tg ? html`<p class="og-empty ct-loading">${t('common.loading')}</p>`
        : !tg.organisms.length && !tg.agents.length ? html`<p class="og-empty">${c('togetherNone')}</p>`
        : html`<div class="ct-where">
            ${tg.organisms.map(o => { const ws = tg.workspaces.filter(w => w.organism_id === o.id); return html`<div key=${o.id}><b>${o.name}</b><small>${roleWord(o.role)}${ws.length ? ' · ' + ws.map(w => w.name).join(', ') : ''}</small></div>`; })}
            ${tg.agents.map(a => html`<div key=${a.gaii}><b>${a.display_name || parts(a.gaii).agent}</b><small>${c('theirAgent')}${a.message_count ? ' · ' + c('messagedTimes', { n: a.message_count }) : ''}${a.last_seen ? ' · ' + c('seen', { when: rel(a.last_seen) }) : ''}</small></div>`)}
          </div>`}
    <//>`;
}

function secMessages(ctx, row) {
  const thread = ctx.personData?.thread;
  const doors = row.conversation_id ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.openConversation(row.conversation_id)}>${c('openInMessages')}</button>` : null;
  return html`
    <${Section} id="ct-messages" num="03" title=${c('secMessages')} count=${row.message_count ? `${row.message_count} · ${c('secMessagesSub')}` : null} doors=${doors}>
      ${!row.conversation_id ? html`<p class="og-empty">${c('noMessagesYet')}</p><div class="og-doors"><button type="button" class="og-door" onClick=${() => ctx.message(row.contact_id)}>${c('writeFirst')}</button></div>`
        : !thread ? html`<p class="og-empty ct-loading">${t('common.loading')}</p>`
        : !thread.length ? html`<p class="og-empty">${c('noMessagesYet')}</p>`
        : thread.slice(0, 3).map(m => html`<div class="ct-msg" key=${m.id}>${firstLines(m.body)}<small>${m.senderGhii === row.contact_id ? nameOf(row) : c('you')} · ${rel(m.createdAt)}</small></div>`)}
    <//>`;
}
const firstLines = (s) => String(s || '').split(/\r?\n/).filter(l => l.trim()).slice(0, 3).join(' ').slice(0, 240);

function foldPermissions(ctx, row) {
  return html`
    <${Fold} id="ct-perm" num="04" title=${c('permTitle')} sub=${c('permSub')} open=${ctx.folds.perm} onToggle=${() => ctx.setFold('perm', !ctx.folds.perm)}>
      <div class="ct-kv">
        ${row.kind !== 'mail' ? html`<div class="k">${c('permGate')}</div><div class="v">${stateWord(row)}<div class="og-doors"><button type="button" class="og-door og-door--quiet" onClick=${() => ctx.openTab('messages')}>${c('manageInMessages')}</button></div></div>` : null}
        <div class="k">${c('permRemove')}</div><div class="v">${row.has_messages ? c('removeKeepsHistory') : row.kind === 'mail' ? c('removeDeletesCard') : c('removePlain')}<div class="og-doors"><button type="button" class="og-door og-door--danger" disabled=${ctx.busy} onClick=${() => ctx.remove(row)}>${c('removeFromBook')}</button></div></div>
      </div>
    <//>`;
}

/** The organisms the owner manages that this person is not in yet, one door each. */
function orgChooser(ctx, row) {
  const list = ctx.myOrganisms;
  const inAlready = new Set((ctx.personData?.together?.organisms || []).map(o => o.id));
  const candidates = list ? list.filter(o => !inAlready.has(o.id)) : null;
  return html`
    <div class="ct-box">
      <span class="og-box-label">${c('inviteToOrganism')}</span>
      ${!candidates ? html`<p class="og-empty ct-loading">${t('common.loading')}</p>`
        : !candidates.length ? html`<p class="og-empty">${c('noOrganismsToInvite')}</p>`
        : html`<div class="og-doors">${candidates.map(o => html`<button type="button" class="og-door" key=${o.id} disabled=${ctx.busy} onClick=${() => ctx.inviteToOrganism(o, row)}>${o.name}</button>`)}</div>`}
      <p class="ct-hint">${c('inviteToOrganismHint', { name: nameOf(row) })}</p>
    </div>`;
}
