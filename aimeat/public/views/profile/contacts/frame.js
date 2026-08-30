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
 *   v1.0.0 — 2026-08-30 — Initial (design canvas "AIMEAT Kontaktien sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';
import { PresenceDot } from '/components/PresenceDot.js';

export const c = (key, vars) => t('contacts.cover.' + key, vars);
export const locale = () => (getLocale() === 'fi' ? 'fi-FI' : getLocale() === 'es' ? 'es-CO' : 'en-GB');
export const day = (iso) => (iso ? new Date(iso).toLocaleDateString(locale()) : '');
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
    return nameOf(a).localeCompare(nameOf(b), locale());
  });
}

const av = (r, agent) => html`<div class=${`ct-av ${agent ? 'ct-av--agent' : ''}`} aria-hidden="true">${initials(r)}</div>`;
const tags = (r) => html`<span class="ct-tags">${r.relation ? html`<span class="ct-tag ct-tag--rel">${r.relation}</span>` : null}${(r.tags || []).map(x => html`<span class="ct-tag" key=${x}>${x}</span>`)}</span>`;
const lastMsg = (r) => (r.last_message_at ? html`<b>${rel(r.last_message_at)}</b><small>${r.last_sender === r.contact_id ? '' : c('youWrote') + ' '}${r.last_message || ''}</small>` : html`<small>${c('noMessagesYet')}</small>`);

/** Rows of the people table: who, relation and tags, shared organisms, last message, the doors. */
export function peopleRows(ctx, rows) {
  return html`<div class="ct-rows">
    ${rows.map(r => html`
      ${av(r)}
      <div class="ct-nm" key=${'n' + r.contact_id}><button type="button" class="og-tbl-name" onClick=${() => ctx.openPerson(r.contact_id)}>${nameOf(r)}</button>${isPerson(r) ? html` <${PresenceDot} ghii=${r.contact_id} />` : null}<small>${parts(r.contact_id).owner} · ${originWords(r)}</small></div>
      <div class="ct-w" key=${'t' + r.contact_id}>${tags(r)}</div>
      <div class="ct-w ct-m" key=${'o' + r.contact_id}>${(r.shared_organisms || []).length ? r.shared_organisms.map(o => o.name).join(' · ') : '·'}</div>
      <div class="ct-w ct-last" key=${'l' + r.contact_id}>${lastMsg(r)}</div>
      <div class="og-tbl-door ct-doors" key=${'d' + r.contact_id}><button type="button" class="og-door og-door--quiet" onClick=${() => ctx.message(r.contact_id)}>${c('message')}</button><button type="button" class="og-door" onClick=${() => ctx.openPerson(r.contact_id)}>${c('open')}</button></div>`)}
  </div>`;
}
export const peopleHead = () => html`<div class="ct-rows ct-rows--head"><div></div><div>${c('colName')}</div><div>${c('colRelation')}</div><div>${c('colShared')}</div><div>${c('colLast')}</div><div></div></div>`;

/** Rows of the people without an account: who, tags, the note, the invitation, the doors. */
export function noAccountRows(ctx, rows) {
  return html`<div class="ct-rows ct-rows--mail">
    ${rows.map(r => html`
      ${av(r)}
      <div class="ct-nm" key=${'n' + r.contact_id}><button type="button" class="og-tbl-name" onClick=${() => ctx.openPerson(r.contact_id)}>${nameOf(r)}</button><small>${r.email || ''}</small></div>
      <div class="ct-w" key=${'t' + r.contact_id}>${tags(r)}</div>
      <div class="ct-w ct-note" key=${'o' + r.contact_id}>${r.note || ''}</div>
      <div class="ct-w ct-m" key=${'i' + r.contact_id}>${r.invitation ? c('inviteSent', { when: day(r.invitation.created_at) }) : c('notInvited')}</div>
      <div class="og-tbl-door ct-doors" key=${'d' + r.contact_id}>${r.invitation ? null : html`<button type="button" class="og-door" disabled=${ctx.busy} onClick=${() => ctx.invite(r)}>${c('invite')}</button>`}<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.openPerson(r.contact_id)}>${c('open')}</button></div>`)}
  </div>`;
}

/** Rows of the agents and apps: who, whose, last message, the doors. */
export function agentRows(ctx, rows) {
  return html`<div class="ct-rows ct-rows--agents">
    ${rows.map(r => { const owner = ctx.personOf(r.owner); return html`
      ${av(r, true)}
      <div class="ct-nm" key=${'n' + r.contact_id}><span class="ct-nm-plain">${nameOf(r)}</span><small>${r.contact_id}</small></div>
      <div class="ct-w" key=${'w' + r.contact_id}>${r.owner === ctx.me ? c('yours') : owner ? html`<button type="button" class="og-tbl-go" onClick=${() => ctx.openPerson(owner.contact_id)}>${nameOf(owner)}</button>` : parts(r.contact_id).owner}<small class="ct-kind">${kindWord(r.kind)}</small></div>
      <div class="ct-w ct-last" key=${'l' + r.contact_id}>${lastMsg(r)}</div>
      <div class="og-tbl-door ct-doors" key=${'d' + r.contact_id}><button type="button" class="og-door og-door--quiet" onClick=${() => ctx.message(r.contact_id)}>${c('message')}</button>${r.owner === ctx.me ? html`<button type="button" class="og-door" onClick=${() => ctx.openTab('agents')}>${c('open')}</button>` : owner ? html`<button type="button" class="og-door" onClick=${() => ctx.openPerson(owner.contact_id)}>${c('open')}</button>` : null}</div>`; })}
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
          ${label ? html`<div class="og-label">${label}</div>` : null}
          <h1 class="og-title ct-title--page">${title}</h1>
          ${chips ? html`<div class="og-chips">${chips}</div>` : null}
        </div>
        ${doors ? html`<div class="og-mast-actions"><div class="og-doors">${doors}</div></div>` : null}
      </div>
      ${strip}
      <div class="og-grid">
        <div class="og-main">${children}</div>
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
