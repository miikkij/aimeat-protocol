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

const av = (r, agent) => html`<div><div class=${`ct-av poster-box poster-box--avatar ${agent ? 'poster-box--agent' : ''}`} aria-hidden="true">${initials(r)}</div></div>`;
const tags = (r) => html`<span class="poster-chips">${r.relation ? html`<span class="poster-chip poster-chip--ink">${r.relation}</span>` : null}${(r.tags || []).map(x => html`<span class="poster-chip" key=${x}>${x}</span>`)}</span>`;
const lastMsg = (r) => (r.last_message_at ? html`<b class="poster-time">${rel(r.last_message_at)}</b><small>${r.last_sender === r.contact_id ? '' : c('youWrote') + ' '}${r.last_message || ''}</small>` : html`<small>${c('noMessagesYet')}</small>`);

/** Rows of the people table, under its heading row: who, relation and tags, shared organisms, last message, the doors. */
export function peopleRows(ctx, rows) {
  return html`<div class="listing listing--cols listing--mark-name-tags-shared-last-doors">
    <div class="listing-row listing-row--head"><div class="poster-label"></div><div class="poster-label">${c('colName')}</div><div class="poster-label">${c('colRelation')}</div><div class="poster-label">${c('colShared')}</div><div class="poster-label">${c('colLast')}</div><div class="poster-label"></div></div>
    ${rows.map(r => html`
      <div class="listing-row" key=${r.contact_id}>
        ${av(r)}
        <div class="listing-name"><button type="button" class="og-tbl-name" onClick=${() => ctx.openPerson(r.contact_id)}>${nameOf(r)}</button>${isPerson(r) ? html` <${PresenceDot} ghii=${r.contact_id} />` : null}<small>${parts(r.contact_id).owner} · ${originWords(r)}</small></div>
        <div>${tags(r)}</div>
        <div><span class="ct-m">${(r.shared_organisms || []).length ? r.shared_organisms.map(o => o.name).join(' · ') : '·'}</span></div>
        <div class="ct-last">${lastMsg(r)}</div>
        <div class="listing-doors"><button type="button" class="poster-action poster-action--small poster-action--row poster-action--lower" onClick=${() => ctx.message(r.contact_id)}>${c('message')}</button><button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.openPerson(r.contact_id)}>${c('open')}</button></div>
      </div>`)}
  </div>`;
}

/** Rows of the people without an account: who, tags, the note, the invitation, the doors. */
export function noAccountRows(ctx, rows) {
  return html`<div class="listing listing--cols listing--mark-name-tags-note-state-doors">
    ${rows.map(r => html`
      <div class="listing-row" key=${r.contact_id}>
        ${av(r)}
        <div class="listing-name"><button type="button" class="og-tbl-name" onClick=${() => ctx.openPerson(r.contact_id)}>${nameOf(r)}</button><small>${r.email || ''}</small></div>
        <div>${tags(r)}</div>
        <div class="listing-desc">${r.note || ''}</div>
        <div><span class="ct-m">${r.invitation ? c('inviteSent', { when: day(r.invitation.created_at) }) : c('notInvited')}</span></div>
        <div class="listing-doors">${r.invitation ? null : html`<button type="button" class="poster-action poster-action--small poster-action--row" disabled=${ctx.busy} onClick=${() => ctx.invite(r)}>${c('invite')}</button>`}<button type="button" class="poster-action poster-action--small poster-action--row poster-action--lower" onClick=${() => ctx.openPerson(r.contact_id)}>${c('open')}</button></div>
      </div>`)}
  </div>`;
}

/** Rows of the agents and apps: who, whose, last message, the doors. */
export function agentRows(ctx, rows) {
  return html`<div class="listing listing--cols listing--mark-name-who-last-doors">
    ${rows.map(r => { const owner = ctx.personOf(r.owner); return html`
      <div class="listing-row" key=${r.contact_id}>
        ${av(r, true)}
        <div class="listing-name"><span>${nameOf(r)}</span><small>${r.contact_id}</small></div>
        <div class="listing-who">${r.owner === ctx.me ? c('yours') : owner ? html`<button type="button" class="og-tbl-go" onClick=${() => ctx.openPerson(owner.contact_id)}>${nameOf(owner)}</button>` : parts(r.contact_id).owner}<small>${kindWord(r.kind)}</small></div>
        <div class="ct-last">${lastMsg(r)}</div>
        <div class="listing-doors"><button type="button" class="poster-action poster-action--small poster-action--row poster-action--lower" onClick=${() => ctx.message(r.contact_id)}>${c('message')}</button>${r.owner === ctx.me ? html`<button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.openTab('agents')}>${c('open')}</button>` : owner ? html`<button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.openPerson(owner.contact_id)}>${c('open')}</button>` : null}</div>
      </div>`; })}
  </div>`;
}

/* ── The crumb and the page frame ──────────────────────────────────────────────────────────── */
export function crumb(ctx, parts) {
  return html`
    <div class="og-crumb">
      <span>${t('nav.profile')}</span><span>/</span>
      ${parts.length ? html`<button type="button" class="og-crumb-link" onClick=${() => ctx.pickView({ kind: 'cover' })}>${t('contacts.title')}</button>` : html`<span class="og-crumb-here">${t('contacts.title')}</span>`}
      ${parts.map((p, i) => html`<span key=${i}>/</span><span class="og-crumb-here">${p}</span>`)}
    </div>`;
}

export function pageLinks(ctx) {
  return html`
    <button type="button" class="og-rail-link" onClick=${() => ctx.openTab('messages')}><i>→</i>${t('profile.tabs.inbox')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => ctx.openTab('organisms')}><i>→</i>${t('profile.tabs.organisms')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => ctx.openTab('agents')}><i>→</i>${t('profile.tabs.agents')}<em>→</em></button>`;
}

export function renderPage(ctx, { crumbs, label = null, title, chips = null, doors = null, strip = null, rail = null, children }) {
  return html`
    <div class="og og-ct og-page">
      ${crumb(ctx, crumbs)}
      <div class="og-mast og-mast--page">
        <div class="og-mast-words">
          ${label ? html`<div class="poster-label">${label}</div>` : null}
          <h1 class="og-title poster-page-title ct-title--page">${title}</h1>
          ${chips ? html`<div class="poster-chips">${chips}</div>` : null}
        </div>
        ${doors ? html`<div class="og-mast-actions"><div class="og-doors">${doors}</div></div>` : null}
      </div>
      ${strip}
      <div class="og-grid">
        <div class="og-main poster-row--thing">${children}</div>
        <nav class="og-rail" aria-label=${c('railTitle')}>
          <span class="og-rail-label">${t('contacts.title')}</span>
          <button type="button" class="og-rail-link" onClick=${() => ctx.pickView({ kind: 'cover' })}><i>←</i>${c('backTo')}</button>
          ${rail}
          <hr />
          <span class="og-rail-label">${c('pages')}</span>
          ${pageLinks(ctx)}
        </nav>
      </div>
    </div>`;
}
