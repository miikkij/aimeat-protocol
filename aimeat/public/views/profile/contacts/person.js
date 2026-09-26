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
 *   v1.15.0 -- 2026-09-26 -- Every part is a kit component (the page frame as data, FigureStrip, Facts with what is not written down grey, List, Box, Tab in its fold tone, Mark, Note, Action): the page passes data and writes no class. Put back from main: how a person came into the book, how often you wrote and a sent invitation are dim tags (page group G8).
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
import { FigureStrip } from '/components/FigureStrip.js';
import { Facts } from '/components/Facts.js';
import { List, Row, Name, Desc } from '/components/List.js';
import { Box } from '/components/Box.js';
import { Tab } from '/components/Tabs.js';
import { Mark, Marks, Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { c, rel, day, nameOf, parts, kindWord, stateWord, originWords, isPerson, renderPage } from './frame.js';
import { personForm } from './add.js';
import { Hint } from '/components/Hint.js';

export function renderPerson(ctx, row) {
  const tg = ctx.personData?.together || null;
  const person = isPerson(row);
  const mail = row.kind === 'mail';
  const marks = [
    row.relation ? { label: row.relation, tone: 'ink' } : null,
    ...(row.tags || []).map(x => ({ label: x })),
    // How the person came into the book and how often you wrote count nothing to do: main's dim tags.
    { label: originWords(row), tone: 'dim' },
    row.origin === 'saved' && row.message_count ? { label: c('messagedTimes', { n: row.message_count }), tone: 'dim' } : null,
  ];
  const doors = html`
    ${mail ? (row.invitation ? html`<${Mark} tone="dim">${c('inviteSent', { when: day(row.invitation.created_at) })}<//>` : html`<${Loud} control disabled=${ctx.busy} onClick=${() => ctx.invite(row)}>${c('invite')}<//>`)
      : html`<${Loud} onClick=${() => ctx.message(row.contact_id)}>${c('message')}<//>`}
    <${Actions}>
      ${person ? html`<${Tab} tone="fold" on=${ctx.orgChooser} pressed=${!!ctx.orgChooser} onClick=${() => ctx.toggleOrgChooser()}>${c('inviteToOrganism')}<//><${Action} small onClick=${() => ctx.openTab('organisms')}>${c('shareWorkspace')}<//>` : null}
      <${Tab} tone="fold" on=${ctx.editing} pressed=${!!ctx.editing} onClick=${() => ctx.startEdit(row)}>${c('edit')}<//>
    <//>`;
  const loadingWord = t('common.loading');
  const strip = person ? html`<${FigureStrip} items=${[
    row.last_message_at
      ? { key: 'last', n: rel(row.last_message_at), label: c('stripLastOne'), sub: `${row.last_sender === row.contact_id ? '' : c('youWrote') + ' '}${row.last_message || ''}` }
      : { key: 'last', n: '·', label: c('stripLastOne'), sub: c('noMessagesYet') },
    { key: 'orgs', n: tg ? tg.organisms.length : '·', label: c('stripOrganisms'), sub: tg ? (tg.organisms.map(o => o.name).join(' · ') || c('none')) : loadingWord },
    { key: 'agents', n: tg ? tg.agents.length : '·', label: c('stripAgents'), sub: tg ? (tg.agents.map(a => a.display_name || parts(a.gaii).agent).join(' · ') || c('none')) : loadingWord },
    { key: 'ws', n: tg ? tg.workspaces.length : '·', label: c('stripWorkspaces'), sub: tg ? (tg.workspaces.map(w => w.name).join(' · ') || c('none')) : loadingWord },
  ]} />` : null;
  const sameRelation = row.relation ? ctx.people.filter(r => r.contact_id !== row.contact_id && r.relation === row.relation).slice(0, 5) : [];
  const railGroups = [
    tg?.agents?.length ? { label: c('railTheirAgents'), items: tg.agents.map(a => ({ key: a.gaii, mark: '→', label: a.display_name || parts(a.gaii).agent, count: a.last_message_at ? rel(a.last_message_at) : '', onClick: () => ctx.message(a.gaii) })) } : null,
    sameRelation.length ? { label: c('railSameRelation'), items: sameRelation.map(r => ({ key: r.contact_id, mark: '→', label: nameOf(r), count: '', onClick: () => ctx.openPerson(r.contact_id) })) } : null,
  ];
  return renderPage(ctx, {
    crumbs: [nameOf(row)],
    label: html`${kindWord(row.kind)} · ${mail ? row.email : parts(row.contact_id).owner}${person ? html` · <${PresenceDot} ghii=${row.contact_id} />` : null}`,
    title: nameOf(row), marks, doors, strip, railGroups,
    after: html`<${ctx.ConfirmUI} />`,
    children: html`
      ${ctx.orgChooser ? orgChooser(ctx, row) : null}
      ${secKnow(ctx, row)}
      ${person ? secTogether(ctx, row, tg) : null}
      ${person || row.kind !== 'mail' ? secMessages(ctx, row) : null}
      ${foldPermissions(ctx, row)}`,
  });
}

function secKnow(ctx, row) {
  const doors = ctx.editing ? null : html`<${Action} small soft onClick=${() => ctx.startEdit(row)}>${c('edit')}<//>`;
  const verified = isPerson(row) && row.email;
  // A thing the owner has not written down says so in grey (main's .ct-dim): the Facts' missing value.
  return html`
    <${PageSection} id="ct-know" num="01" title=${c('secKnow')} doors=${doors} first>
      ${ctx.editing ? personForm(ctx, { editing: true }) : html`
        <${Facts} rows=${[
          { k: c('fEmail'), v: row.email || c('unknown'), missing: !row.email, sub: verified ? c('verifiedOnAccount') : undefined },
          { k: c('fRelation'), v: row.relation || c('unknown'), missing: !row.relation },
          { k: c('fTags'), v: (row.tags || []).length ? html`<${Marks}>${row.tags.map(x => html`<${Mark} key=${x}>${x}<//>`)}<//>` : c('none'), missing: !(row.tags || []).length },
          { k: c('fLinks'), v: (row.links || []).length ? html`<${Actions}>${row.links.map((l, i) => html`<${Action} tone="more" key=${i} href=${l.url} newTab noReferrer>${l.label || l.url}<//>`)}<//>` : c('none'), missing: !(row.links || []).length },
          { k: c('fNote'), v: row.note || c('none'), missing: !row.note },
        ]} />
        ${row.kind === 'mail' ? html`<${Hint}>${t('contacts.personHint')}<//>` : null}`}
    <//>`;
}

function secTogether(ctx, row, tg) {
  const roleWord = (r) => c('role.' + (r === 'creator' ? 'creator' : r === 'admin' ? 'admin' : 'member'));
  return html`
    <${PageSection} id="ct-together" num="02" title=${c('secTogether')} count=${c('secTogetherSub')}>
      ${!tg ? html`<${Note} kind="loading">${t('common.loading')}<//>`
        : !tg.organisms.length && !tg.agents.length ? html`<${Note} kind="quiet">${c('togetherNone')}<//>`
        : html`<${List} cols="name-name">
            ${tg.organisms.map(o => { const ws = tg.workspaces.filter(w => w.organism_id === o.id); return html`<${Row} key=${o.id}><${Name} meta=${`${roleWord(o.role)}${ws.length ? ' · ' + ws.map(w => w.name).join(', ') : ''}`}>${o.name}<//><//>`; })}
            ${tg.agents.map(a => html`<${Row} key=${a.gaii}><${Name} meta=${`${c('theirAgent')}${a.message_count ? ' · ' + c('messagedTimes', { n: a.message_count }) : ''}${a.last_seen ? ' · ' + c('seen', { when: rel(a.last_seen) }) : ''}`}>${a.display_name || parts(a.gaii).agent}<//><//>`)}
          <//>`}
    <//>`;
}

function secMessages(ctx, row) {
  const thread = ctx.personData?.thread;
  const doors = row.conversation_id ? html`<${Action} small soft onClick=${() => ctx.openConversation(row.conversation_id)}>${c('openInMessages')}<//>` : null;
  return html`
    <${PageSection} id="ct-messages" num="03" title=${c('secMessages')} count=${row.message_count ? `${row.message_count} · ${c('secMessagesSub')}` : null} doors=${doors}>
      ${!row.conversation_id ? html`<${Note} kind="quiet">${c('noMessagesYet')}<//><${Actions}><${Action} small onClick=${() => ctx.message(row.contact_id)}>${c('writeFirst')}<//><//>`
        : !thread ? html`<${Note} kind="loading">${t('common.loading')}<//>`
        : !thread.length ? html`<${Note} kind="quiet">${c('noMessagesYet')}<//>`
        : html`<${List} cols="name">${thread.slice(0, 3).map(m => html`<${Row} key=${m.id}><${Desc} sub=${`${m.senderGhii === row.contact_id ? nameOf(row) : c('you')} · ${rel(m.createdAt)}`}>${firstLines(m.body)}<//><//>`)}<//>`}
    <//>`;
}
const firstLines = (s) => String(s || '').split(/\r?\n/).filter(l => l.trim()).slice(0, 3).join(' ').slice(0, 240);

function foldPermissions(ctx, row) {
  return html`
    <${FoldSection} id="ct-perm" num="04" title=${c('permTitle')} sub=${c('permSub')} open=${ctx.folds.perm} onToggle=${() => ctx.setFold('perm', !ctx.folds.perm)}>
      <${Facts} rows=${[
        row.kind !== 'mail' && { k: c('permGate'), v: stateWord(row),
          actions: html`<${Action} small soft onClick=${() => ctx.openTab('messages')}>${c('manageInMessages')}<//>` },
        { k: c('permRemove'), v: row.has_messages ? c('removeKeepsHistory') : row.kind === 'mail' ? c('removeDeletesCard') : c('removePlain'),
          actions: html`<${Action} small tone="danger" disabled=${ctx.busy} onClick=${() => ctx.remove(row)}>${c('removeFromBook')}<//>` },
      ]} />
    <//>`;
}

/** The organisms the owner manages that this person is not in yet, one door each. */
function orgChooser(ctx, row) {
  const list = ctx.myOrganisms;
  const inAlready = new Set((ctx.personData?.together?.organisms || []).map(o => o.id));
  const candidates = list ? list.filter(o => !inAlready.has(o.id)) : null;
  return html`
    <${Box}>
      <${Label} block>${c('inviteToOrganism')}<//>
      ${!candidates ? html`<${Note} kind="loading">${t('common.loading')}<//>`
        : !candidates.length ? html`<${Note} kind="quiet">${c('noOrganismsToInvite')}<//>`
        : html`<${Actions}>${candidates.map(o => html`<${Action} small key=${o.id} disabled=${ctx.busy} onClick=${() => ctx.inviteToOrganism(o, row)}>${o.name}<//>`)}<//>`}
      <${Hint}>${c('inviteToOrganismHint', { name: nameOf(row) })}<//>
    <//>`;
}
