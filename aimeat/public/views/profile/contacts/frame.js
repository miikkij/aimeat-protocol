/**
 * @file public/views/profile/contacts/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Contacts cover and a person's page share: the words (a kind, a relation,
 *   "saved" and "messaged", a state of the message gate), the name to show and the initials, the
 *   parts of an id, the rows of the three tables (people, people without an account, agents and
 *   apps), the crumb and the page frame with its rail. Every machine word (ghii, gaii, accepted,
 *   origin) is turned into the reader's language here and nowhere else.
 * @structure c · rel · day · parts · nameOf · initials · kindWord · stateWord · sortPeople · peopleRows · noAccountRows · agentRows · crumb · pageLinks · renderPage
 * @usage import { c, renderPage, peopleRows } from './frame.js';
 * @version-history
 *   v1.10.0 -- 2026-09-26 -- Every part is a kit component (List with its Lead, Name, Cell, Desc, Who, When and Doors; Mark; Action; SettingsPage with the crumb and the rail as data): the page passes data and writes no class. The people table's heading row is the List's head, as main drew it over the rows (page group G8).
 *   v1.9.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.8.0 -- 2026-09-26 -- The mark of a sender that is not a person is the avatar's agent tone (.poster-box--agent, css/poster.css), a unification: the look Contacts, Notifications, Email and MCP drew alike.
 *   v1.7.0 -- 2026-09-25 -- The three tables are the Listing (listing, listing-row and its name, words, who and doors cells, the mark in a cell of its own; the people table's heading row inside it), a unification: the look most tabs use.
 *   v1.6.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.5.0 -- 2026-09-25 -- Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v1.4.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.3.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-13 -- Compose the shared initials-box role and its measured size cut.
 *   v1.2.0 -- 2026-09-13 -- Compose existing top rules from poster.css.
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-08-30 — Initial (design canvas "AIMEAT Kontaktien sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { date as fmtDate, compare as fmtCompare } from '/js/format.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';
import { PresenceDot } from '/components/PresenceDot.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { List, Row, Lead, Name, Desc, Who, When, Cell, Doors } from '/components/List.js';
import { Mark, Marks } from '/components/Mark.js';
import { Action } from '/components/Action.js';

export const c = (key, vars) => t('contacts.cover.' + key, vars);
// The locale() helper here derived the FORMAT from the LANGUAGE. They are different settings:
// /js/format.js reads the reader's own, from their profile, falling back to their browser.
export const day = (iso) => (iso ? fmtDate(iso) : '');
export const rel = (iso) => { if (!iso) return ''; const d = new Date(iso); return Date.now() - d.getTime() > 30 * 864e5 ? day(iso) : formatRelativeTime(iso); };

/** The parts of an id: `claude#jevgeni@node` → { agent: 'claude', owner: 'jevgeni', node }. */
export function parts(id) {
  const s = String(id || '').replace(/^eco:/, '');
  const at = s.lastIndexOf('@');
  const hash = s.indexOf('#');
  return {
    agent: hash >= 0 ? s.slice(0, hash) : '',
    owner: hash >= 0 ? s.slice(hash + 1, at < 0 ? undefined : at) : s.slice(0, at < 0 ? undefined : at),
    node: at >= 0 ? s.slice(at + 1) : '',
  };
}
export const nameOf = (r) => r?.display_name || r?.saved_name || (r?.kind === 'gaii' || r?.kind === 'geai' ? parts(r.contact_id).agent : parts(r?.contact_id).owner) || r?.email || '';
export const initials = (r) => nameOf(r).split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '·';
export const isPerson = (r) => r.kind === 'ghii';
export const isAgentLike = (r) => r.kind === 'gaii' || r.kind === 'geai';

/** "a person here", "an agent", "an app", "no account yet". */
export const kindWord = (kind) => c('kind.' + (kind === 'gaii' ? 'agent' : kind === 'geai' ? 'app' : kind === 'mail' ? 'mail' : 'person'));
/** The message gate, as a sentence. */
export const stateWord = (r) => (r.state === 'accepted' ? c('state.accepted') : r.state === 'pending' ? c('state.pending') : r.state === 'blocked' ? c('state.blocked') : c('state.none'));
/** "saved 26.8." or "messaged 41 times". */
export const originWords = (r) => (r.origin === 'saved' && r.created_at ? c('savedOn', { when: day(r.created_at) }) : r.message_count ? c('messagedTimes', { n: r.message_count }) : c('savedWord'));

/** Last message first; then the ones with a name; then by name. */
export function sortPeople(rows) {
  return [...rows].sort((a, b) => {
    const ta = a.last_message_at || '', tb = b.last_message_at || '';
    if (ta !== tb) return tb.localeCompare(ta);
    return fmtCompare(nameOf(a), nameOf(b));
  });
}

/** The relation (yours: the ink tag) and the tags a person carries. */
const tags = (r) => html`<${Marks}>${r.relation ? html`<${Mark} tone="ink">${r.relation}<//>` : null}${(r.tags || []).map(x => html`<${Mark} key=${x}>${x}<//>`)}<//>`;
/** The last message: when, and its first words cut to one line; or that there is none yet. */
const lastMsg = (r) => (r.last_message_at
  ? html`<${When} clip at=${`${r.last_sender === r.contact_id ? '' : c('youWrote') + ' '}${r.last_message || ''}`}>${rel(r.last_message_at)}<//>`
  : html`<${When}>${c('noMessagesYet')}<//>`);

/** The people table, with its heading row: who, relation and tags, shared organisms, last message, the doors. */
export function peopleRows(ctx, rows) {
  return html`<${List} cols="mark-name-tags-shared-last-doors" keepCols
    head=${['', c('colName'), c('colRelation'), c('colShared'), c('colLast'), '']}>
    ${rows.map(r => html`
      <${Row} key=${r.contact_id}>
        <${Lead} text=${initials(r)} />
        <${Name} onOpen=${() => ctx.openPerson(r.contact_id)} after=${isPerson(r) ? html` <${PresenceDot} ghii=${r.contact_id} />` : null}
          meta=${`${parts(r.contact_id).owner} · ${originWords(r)}`}>${nameOf(r)}<//>
        <${Cell}>${tags(r)}<//>
        <${Cell} meta>${(r.shared_organisms || []).length ? r.shared_organisms.map(o => o.name).join(' · ') : '·'}<//>
        ${lastMsg(r)}
        <${Doors}>
          <${Action} small row soft onClick=${() => ctx.message(r.contact_id)}>${c('message')}<//>
          <${Action} small row onClick=${() => ctx.openPerson(r.contact_id)}>${c('open')}<//>
        <//>
      <//>`)}
  <//>`;
}

/** The people without an account: who, tags, the note, the invitation, the doors. */
export function noAccountRows(ctx, rows) {
  return html`<${List} cols="mark-name-tags-note-state-doors" keepCols>
    ${rows.map(r => html`
      <${Row} key=${r.contact_id}>
        <${Lead} text=${initials(r)} />
        <${Name} onOpen=${() => ctx.openPerson(r.contact_id)} meta=${r.email || ''}>${nameOf(r)}<//>
        <${Cell}>${tags(r)}<//>
        <${Desc}>${r.note || ''}<//>
        <${Cell} meta>${r.invitation ? c('inviteSent', { when: day(r.invitation.created_at) }) : c('notInvited')}<//>
        <${Doors}>
          ${r.invitation ? null : html`<${Action} small row disabled=${ctx.busy} onClick=${() => ctx.invite(r)}>${c('invite')}<//>`}
          <${Action} small row soft onClick=${() => ctx.openPerson(r.contact_id)}>${c('open')}<//>
        <//>
      <//>`)}
  <//>`;
}

/** The agents and apps: who, whose, last message, the doors. Their mark is the agent's, dashed. */
export function agentRows(ctx, rows) {
  return html`<${List} cols="mark-name-who-last-doors" keepCols>
    ${rows.map(r => {
      const owner = ctx.personOf(r.owner);
      const whose = r.owner === ctx.me ? c('yours')
        : owner ? html`<${Action} tone="text" onClick=${() => ctx.openPerson(owner.contact_id)}>${nameOf(owner)}<//>` : parts(r.contact_id).owner;
      const open = r.owner === ctx.me ? () => ctx.openTab('agents') : owner ? () => ctx.openPerson(owner.contact_id) : null;
      return html`
      <${Row} key=${r.contact_id}>
        <${Lead} text=${initials(r)} agent />
        <${Name} meta=${r.contact_id}>${nameOf(r)}<//>
        <${Who} sub=${kindWord(r.kind)}>${whose}<//>
        ${lastMsg(r)}
        <${Doors}>
          <${Action} small row soft onClick=${() => ctx.message(r.contact_id)}>${c('message')}<//>
          ${open ? html`<${Action} small row onClick=${open}>${c('open')}<//>` : null}
        <//>
      <//>`; })}
  <//>`;
}

/* ── The crumb and the page frame ──────────────────────────────────────────────────────────── */
/** The crumb's steps: Contacts opens the cover once a page stands after it; every part after it is ink. */
export function crumb(ctx, parts) {
  return [
    t('nav.profile'),
    parts.length ? { label: t('contacts.title'), onClick: () => ctx.pickView({ kind: 'cover' }) } : t('contacts.title'),
    ...parts.map((p) => ({ label: p, here: true })),
  ];
}

/** The sibling pages in the rail, as data (SettingsPage draws them → … →). */
export function pageLinks(ctx) {
  return [
    { onClick: () => ctx.openTab('messages'), label: t('profile.tabs.inbox') },
    { onClick: () => ctx.openTab('organisms'), label: t('profile.tabs.organisms') },
    { onClick: () => ctx.openTab('agents'), label: t('profile.tabs.agents') },
  ];
}

/**
 * A page of Contacts (a person, a form): the crumb, the head with its label, tags and doors, the
 * strip, and the rail that leads back to the cover, then `railGroups` (each { label, items }), then
 * the sibling pages.
 */
export function renderPage(ctx, { crumbs, label = null, title, marks = [], doors = null, strip = null, railGroups = [], after = null, children }) {
  return html`
    <${SettingsPage} name="ct" page
      crumb=${crumb(ctx, crumbs)}
      label=${label}
      title=${title}
      marks=${marks}
      actions=${doors}
      strip=${strip}
      rail=${{ title: c('railTitle'), groups: [
        { label: t('contacts.title'), items: [{ back: true, key: 'back', label: c('backTo'), onClick: () => ctx.pickView({ kind: 'cover' }) }] },
        ...railGroups.filter(Boolean),
        { label: c('pages'), items: pageLinks(ctx).map((p) => ({ mark: '→', count: '→', ...p })) },
      ] }}
      after=${after}>
      ${children}
    <//>`;
}
