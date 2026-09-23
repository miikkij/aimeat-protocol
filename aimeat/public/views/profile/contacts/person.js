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
 *   2026-09-22 -- Composed from the shared set: chips, a plain NumeralBand for the strip,
 *     KeyValue rows for what is known, ListRow for what we share and the messages; no class of its own.
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, Fold, Stack, Chip, Action, Text, KeyValue, ListRow, NumeralBand, Surface } from '/components/poster-parts.js';
import { PresenceDot } from '/components/PresenceDot.js';
import { c, rel, day, nameOf, parts, kindWord, stateWord, originWords, isPerson, renderPage, tagChips } from './frame.js';
import { personForm } from './add.js';

export function renderPerson(ctx, row) {
  const tg = ctx.personData?.together || null;
  const person = isPerson(row);
  const mail = row.kind === 'mail';
  const chips = html`
    ${row.relation ? html`<${Chip}>${row.relation}<//>` : null}
    ${(row.tags || []).map(x => html`<${Chip} key=${x}>${x}<//>`)}
    <${Chip} tone="muted">${originWords(row)}<//>
    ${row.origin === 'saved' && row.message_count ? html`<${Chip} tone="muted">${c('messagedTimes', { n: row.message_count })}<//>` : null}`;
  const doors = html`
    ${mail ? (row.invitation ? html`<${Chip} tone="muted">${c('inviteSent', { when: day(row.invitation.created_at) })}<//>` : html`<${Action} kind="primary" disabled=${ctx.busy} onClick=${() => ctx.invite(row)}>${c('invite')}<//>`)
      : html`<${Action} kind="primary" onClick=${() => ctx.message(row.contact_id)}>${c('message')}<//>`}
    ${person ? html`<${Action} kind="tab" selected=${ctx.orgChooser} onClick=${() => ctx.toggleOrgChooser()}>${c('inviteToOrganism')}<//><${Action} onClick=${() => ctx.openTab('organisms')}>${c('shareWorkspace')}<//>` : null}
    <${Action} kind="tab" selected=${ctx.editing} onClick=${() => ctx.startEdit(row)}>${c('edit')}<//>`;
  const strip = person ? html`<${NumeralBand} tone="plain" size="small" items=${[
    { label: c('stripLastOne'), value: row.last_message_at ? rel(row.last_message_at) : '·', note: row.last_message_at ? `${row.last_sender === row.contact_id ? '' : c('youWrote') + ' '}${row.last_message || ''}` : c('noMessagesYet') },
    { label: c('stripOrganisms'), value: tg ? tg.organisms.length : '·', note: tg ? (tg.organisms.map(o => o.name).join(' · ') || c('none')) : t('common.loading') },
    { label: c('stripAgents'), value: tg ? tg.agents.length : '·', note: tg ? (tg.agents.map(a => a.display_name || parts(a.gaii).agent).join(' · ') || c('none')) : t('common.loading') },
    { label: c('stripWorkspaces'), value: tg ? tg.workspaces.length : '·', note: tg ? (tg.workspaces.map(w => w.name).join(' · ') || c('none')) : t('common.loading') },
  ]} />` : null;
  const sameRelation = row.relation ? ctx.people.filter(r => r.contact_id !== row.contact_id && r.relation === row.relation).slice(0, 5) : [];
  const rail = html`
    ${tg?.agents?.length ? html`<${Stack} density="compact"><${Text} kind="label">${c('railTheirAgents')}<//>${tg.agents.map(a => html`<${Action} kind="text" key=${a.gaii} onClick=${() => ctx.message(a.gaii)}>→ ${a.display_name || parts(a.gaii).agent}${a.last_message_at ? ' · ' + rel(a.last_message_at) : ''}<//>`)}<//>` : null}
    ${sameRelation.length ? html`<${Stack} density="compact"><${Text} kind="label">${c('railSameRelation')}<//>${sameRelation.map(r => html`<${Action} kind="text" key=${r.contact_id} onClick=${() => ctx.openPerson(r.contact_id)}>→ ${nameOf(r)}<//>`)}<//>` : null}`;
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

const dim = (key) => html`<${Text} kind="label" tone="muted">${c(key)}<//>`;

function secKnow(ctx, row) {
  const doors = ctx.editing ? null : html`<${Action} onClick=${() => ctx.startEdit(row)}>${c('edit')}<//>`;
  const verified = isPerson(row) && row.email;
  return html`
    <${Section} id="ct-know" title=${c('secKnow')} actions=${doors} density="compact">
      ${ctx.editing ? personForm(ctx, { editing: true }) : html`<${Stack} density="compact">
        <${KeyValue} label=${c('fEmail')} value=${html`${row.email || dim('unknown')}${verified ? html` <${Text} kind="caption" tone="muted">${c('verifiedOnAccount')}<//>` : null}`} />
        <${KeyValue} label=${c('fRelation')} value=${row.relation || dim('unknown')} />
        <${KeyValue} label=${c('fTags')} value=${(row.tags || []).length ? tagChips({ tags: row.tags }) : dim('none')} />
        <${KeyValue} label=${c('fLinks')} value=${(row.links || []).length ? html`<${Stack} direction="wrap" density="compact">${row.links.map((l, i) => html`<${Action} key=${i} href=${l.url} target="_blank">${l.label || l.url}<//>`)}<//>` : dim('none')} />
        <${KeyValue} label=${c('fNote')} value=${row.note || dim('none')} />
        ${row.kind === 'mail' ? html`<${Text} kind="caption" tone="muted">${t('contacts.personHint')}<//>` : null}
      <//>`}
    <//>`;
}

function secTogether(ctx, row, tg) {
  const roleWord = (r) => c('role.' + (r === 'creator' ? 'creator' : r === 'admin' ? 'admin' : 'member'));
  return html`
    <${Section} id="ct-together" title=${c('secTogether')} count=${c('secTogetherSub')} density="compact">
      ${!tg ? html`<${Text} tone="muted">${t('common.loading')}<//>`
        : !tg.organisms.length && !tg.agents.length ? html`<${Text} tone="muted">${c('togetherNone')}<//>`
        : html`<${Stack} density="compact">
            ${tg.organisms.map(o => { const ws = tg.workspaces.filter(w => w.organism_id === o.id); return html`<${ListRow} key=${o.id} density="compact" detailKind="text" name=${o.name} detail=${`${roleWord(o.role)}${ws.length ? ' · ' + ws.map(w => w.name).join(', ') : ''}`} />`; })}
            ${tg.agents.map(a => html`<${ListRow} key=${a.gaii} density="compact" detailKind="text" name=${a.display_name || parts(a.gaii).agent} detail=${`${c('theirAgent')}${a.message_count ? ' · ' + c('messagedTimes', { n: a.message_count }) : ''}${a.last_seen ? ' · ' + c('seen', { when: rel(a.last_seen) }) : ''}`} />`)}
          <//>`}
    <//>`;
}

function secMessages(ctx, row) {
  const thread = ctx.personData?.thread;
  const doors = row.conversation_id ? html`<${Action} onClick=${() => ctx.openConversation(row.conversation_id)}>${c('openInMessages')}<//>` : null;
  return html`
    <${Section} id="ct-messages" title=${c('secMessages')} count=${row.message_count ? `${row.message_count} · ${c('secMessagesSub')}` : null} actions=${doors} density="compact">
      ${!row.conversation_id ? html`<${Stack} align="start"><${Text} tone="muted">${c('noMessagesYet')}<//><${Action} onClick=${() => ctx.message(row.contact_id)}>${c('writeFirst')}<//><//>`
        : !thread ? html`<${Text} tone="muted">${t('common.loading')}<//>`
        : !thread.length ? html`<${Text} tone="muted">${c('noMessagesYet')}<//>`
        : html`<${Stack} density="compact">${thread.slice(0, 3).map(m => html`<${ListRow} key=${m.id} density="compact" preview=${true}
            name=${`${m.senderGhii === row.contact_id ? nameOf(row) : c('you')} · ${rel(m.createdAt)}`} detail=${firstLines(m.body)} />`)}<//>`}
    <//>`;
}
const firstLines = (s) => String(s || '').split(/\r?\n/).filter(l => l.trim()).slice(0, 3).join(' ').slice(0, 240);

function foldPermissions(ctx, row) {
  return html`
    <${Fold} id="ct-perm" number="04" title=${c('permTitle')} sub=${c('permSub')} open=${ctx.folds.perm} onToggle=${() => ctx.setFold('perm', !ctx.folds.perm)}>
      ${row.kind !== 'mail' ? html`<${KeyValue} label=${c('permGate')} value=${html`<${Stack} align="start" density="compact">${stateWord(row)}<${Action} onClick=${() => ctx.openTab('messages')}>${c('manageInMessages')}<//><//>`} />` : null}
      <${KeyValue} label=${c('permRemove')} value=${html`<${Stack} align="start" density="compact">${row.has_messages ? c('removeKeepsHistory') : row.kind === 'mail' ? c('removeDeletesCard') : c('removePlain')}<${Action} tone="danger" disabled=${ctx.busy} onClick=${() => ctx.remove(row)}>${c('removeFromBook')}<//><//>`} />
    <//>`;
}

/** The organisms the owner manages that this person is not in yet, one door each. */
function orgChooser(ctx, row) {
  const list = ctx.myOrganisms;
  const inAlready = new Set((ctx.personData?.together?.organisms || []).map(o => o.id));
  const candidates = list ? list.filter(o => !inAlready.has(o.id)) : null;
  return html`
    <${Surface} kind="box">
      <${Stack}>
        <${Text} kind="label">${c('inviteToOrganism')}<//>
        ${!candidates ? html`<${Text} tone="muted">${t('common.loading')}<//>`
          : !candidates.length ? html`<${Text} tone="muted">${c('noOrganismsToInvite')}<//>`
          : html`<${Stack} direction="wrap">${candidates.map(o => html`<${Action} key=${o.id} disabled=${ctx.busy} onClick=${() => ctx.inviteToOrganism(o, row)}>${o.name}<//>`)}<//>`}
        <${Text} kind="caption" tone="muted">${c('inviteToOrganismHint', { name: nameOf(row) })}<//>
      <//>
    <//>`;
}
