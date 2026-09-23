/**
 * @file public/views/profile/contacts/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Contacts cover and a person's page share: the words (a kind, a relation,
 *   "saved" and "messaged", a state of the message gate), the name to show and the initials, the
 *   parts of an id, the rows of the three lists (people, people without an account, agents and
 *   apps), the crumb and the page frame with its rail. Every machine word (ghii, gaii, accepted,
 *   origin) is turned into the reader's language here and nowhere else.
 * @structure c · rel · day · parts · nameOf · initials · kindWord · stateWord · sortPeople · tagChips · peopleRows · noAccountRows · agentRows · crumb · pageLinks · renderPage
 * @usage import { c, renderPage, peopleRows } from './frame.js';
 * @version-history
 *   2026-09-22 -- Composed from the shared set (Page, Rail, ListRow, Chip, Action): the three
 *     lists are roster rows, the page frame is Page, and no class of its own is left, so the
 *     contacts sheet can go.
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
import { Page, Rail, ListRow, Chip, Action, Stack, Text } from '/components/poster-parts.js';

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

/** The initials mark of a row: a square mono chip. */
const av = (r, agent) => html`<${Chip} tone=${agent ? 'muted' : 'plain'}>${initials(r)}<//>`;
/** The relation (on the sun, the one to see) and the tags, as chips. */
export const tagChips = (r) => (r.relation || (r.tags || []).length ? html`<${Stack} direction="wrap" density="compact">
  ${r.relation ? html`<${Chip} tone="sun">${r.relation}<//>` : null}${(r.tags || []).map(x => html`<${Chip} key=${x}>${x}<//>`)}<//>` : null);
const lastMsg = (r) => (r.last_message_at
  ? html`<${Text} kind="caption">${rel(r.last_message_at)} · ${r.last_sender === r.contact_id ? '' : c('youWrote') + ' '}${r.last_message || ''}<//>`
  : html`<${Text} kind="caption" tone="muted">${c('noMessagesYet')}<//>`);

/** Rows of the people list: who, relation and tags, shared organisms, last message, the doors. */
export function peopleRows(ctx, rows) {
  return html`<${Stack} density="compact">${rows.map(r => html`
    <${ListRow} key=${r.contact_id} density="compact" mark=${av(r)}
      name=${html`${nameOf(r)}${isPerson(r) ? html` <${PresenceDot} ghii=${r.contact_id} />` : null}`}
      onOpen=${() => ctx.openPerson(r.contact_id)}
      detail=${`${parts(r.contact_id).owner} · ${originWords(r)}`}
      actions=${html`<${Action} kind="text" onClick=${() => ctx.message(r.contact_id)}>${c('message')}<//><${Action} onClick=${() => ctx.openPerson(r.contact_id)}>${c('open')}<//>`}>
      <${Stack} density="compact">
        ${tagChips(r)}
        ${(r.shared_organisms || []).length ? html`<${Text} kind="mono" tone="muted">${c('colShared')}: ${r.shared_organisms.map(o => o.name).join(' · ')}<//>` : null}
        ${lastMsg(r)}
      <//>
    <//>`)}<//>`;
}

/** Rows of the people without an account: who, tags, the note, the invitation, the doors. */
export function noAccountRows(ctx, rows) {
  return html`<${Stack} density="compact">${rows.map(r => html`
    <${ListRow} key=${r.contact_id} density="compact" mark=${av(r)} name=${nameOf(r)} onOpen=${() => ctx.openPerson(r.contact_id)}
      detail=${r.email || ''}
      value=${r.invitation ? c('inviteSent', { when: day(r.invitation.created_at) }) : c('notInvited')}
      actions=${html`${r.invitation ? null : html`<${Action} disabled=${ctx.busy} onClick=${() => ctx.invite(r)}>${c('invite')}<//>`}<${Action} kind="text" onClick=${() => ctx.openPerson(r.contact_id)}>${c('open')}<//>`}>
      ${tagChips(r) || r.note ? html`<${Stack} density="compact">${tagChips(r)}${r.note ? html`<${Text} kind="caption">${r.note}<//>` : null}<//>` : null}
    <//>`)}<//>`;
}

/** Rows of the agents and apps: who, whose, last message, the doors. */
export function agentRows(ctx, rows) {
  return html`<${Stack} density="compact">${rows.map(r => { const owner = ctx.personOf(r.owner); return html`
    <${ListRow} key=${r.contact_id} density="compact" mark=${av(r, true)} name=${nameOf(r)} detail=${r.contact_id}
      value=${html`${r.owner === ctx.me ? c('yours') : owner ? html`<${Action} kind="text" onClick=${() => ctx.openPerson(owner.contact_id)}>${nameOf(owner)}<//>` : parts(r.contact_id).owner} · ${kindWord(r.kind)}`}
      actions=${html`<${Action} kind="text" onClick=${() => ctx.message(r.contact_id)}>${c('message')}<//>${r.owner === ctx.me ? html`<${Action} onClick=${() => ctx.openTab('agents')}>${c('open')}<//>` : owner ? html`<${Action} onClick=${() => ctx.openPerson(owner.contact_id)}>${c('open')}<//>` : null}`}>
      ${lastMsg(r)}
    <//>`; })}<//>`;
}

/* ── The crumb and the page frame ──────────────────────────────────────────────────────────── */
/** The trail as Masthead crumbs: Settings & Controls, Contacts, then the parts. */
export function crumb(ctx, parts) {
  return [
    { label: t('nav.profile') },
    { label: t('profile.landing.menuActivity') },
    { label: t('contacts.title'), onClick: parts.length ? () => ctx.pickView({ kind: 'cover' }) : undefined },
    ...parts.map(p => ({ label: p })),
  ];
}

/** The doors to the pages next to this one, for the rail. */
export function pageLinks(ctx) {
  return html`<${Stack} density="compact">
    <${Text} kind="label">${c('pages')}<//>
    <${Action} kind="text" onClick=${() => ctx.openTab('messages')}>→ ${t('profile.tabs.inbox')}<//>
    <${Action} kind="text" onClick=${() => ctx.openTab('organisms')}>→ ${t('profile.tabs.organisms')}<//>
    <${Action} kind="text" onClick=${() => ctx.openTab('agents')}>→ ${t('profile.tabs.agents')}<//>
  <//>`;
}

/** A person's page frame: the trail, the mast, the band, the body and the rail with the doors back. */
export function renderPage(ctx, { crumbs, label = null, title, chips = null, doors = null, strip = null, rail = null, children }) {
  return html`<${Page} title=${title} crumbs=${crumb(ctx, crumbs)}
    identity=${html`<${Stack} density="compact">${label ? html`<${Text} kind="label">${label}<//>` : null}${chips ? html`<${Stack} direction="wrap" density="compact">${chips}<//>` : null}<//>`}
    actions=${doors}
    rail=${html`<${Rail} kind="index" title=${t('contacts.title')} label=${c('railTitle')}><${Stack}>
      <${Action} kind="text" onClick=${() => ctx.pickView({ kind: 'cover' })}>← ${c('backTo')}<//>
      ${rail}
      ${pageLinks(ctx)}
    <//><//>`}>
    ${strip}
    <${Stack}>${children}<//>
  <//>`;
}
