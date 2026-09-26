/**
 * @file public/views/profile/notifications/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Notifications cover shares: the words (relative time, a device's browser
 *   family, the switch), the rows of the inbox table with their doors and actions, the sender rows
 *   with their decisions, the crumb and the rail. Every machine word (a group, a kind, an action id)
 *   is turned into the reader's language here.
 * @structure c · rel · Switch · inboxRows · inboxHead · senderRows · crumb · pageLinks
 * @usage import { c, inboxRows, senderRows, crumb, pageLinks } from './frame.js';
 * @version-history
 *   2026-09-26 -- A button that carries its own words is said in the reader's language (actionTextOf).
 *   v1.9.0 -- 2026-09-26 -- A notification's answers are the library's row of actions (og-doors: one gap, one line, wrapping on a phone): the main one the loud action, a refusal the action link's danger tone, Open the action link (Jouni: the answers were not aligned and touched each other).
 *   v1.8.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.7.0 -- 2026-09-26 -- The mark of a sender that is not a person is the avatar's agent tone (.poster-box--agent, css/poster.css), a unification: the look Contacts, Notifications, Email and MCP drew alike.
 *   v1.6.0 -- 2026-09-25 -- A prerequisite's state and a muted sender are the Status (a unification: Jouni's decision "Status").
 *   v1.5.0 -- 2026-09-25 -- The sender rows are the Listing (listing, listing-row and its name, words and doors cells, the mark in a cell of its own), a unification: the look most tabs use.
 *   v1.4.0 -- 2026-09-25 -- A setting that is on or off is the library's Switch (components/Switch.js), the look most Settings tabs draw (UI consolidation phase 5, a unification).
 *   v1.3.0 -- 2026-09-25 -- Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v1.2.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.1.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-13 -- Compose the shared initials-box role and its measured size cut.
 *   v1.0.0 — 2026-08-30 — Initial (design canvas "AIMEAT Ilmoitusten sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { date as fmtDate, time as fmtTime } from '/js/format.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';
import { titleOf, bodyOf, sourceName, kindWord, groupWord, actionTextOf } from '/js/services/notifications.js';
import { Switch } from '/components/Switch.js';

export const c = (key, vars) => t('notifpage.' + key, vars);
// The locale() helper here derived the FORMAT from the LANGUAGE. They are different settings:
// /js/format.js reads the reader's own, from their profile, falling back to their browser.
export const day = (iso) => (iso ? fmtDate(iso) : '');
export const clock = (iso) => (iso ? fmtTime(iso, { hour: '2-digit', minute: '2-digit' }) : '');
export const rel = (iso) => { if (!iso) return ''; const d = new Date(iso); return Date.now() - d.getTime() > 30 * 864e5 ? day(iso) : formatRelativeTime(iso); };
export const firstLine = (s) => String(s || '').split(/\r?\n/).map(l => l.trim()).find(Boolean) || '';

/** The switch is the library's: the word on the left, the box on the right, so a column of switches lines up on its boxes. */
export { Switch };

const ACTION_WORD = { reply: 'action.reply', approve: 'action.approve', deny: 'action.deny', accept: 'action.accept', decline: 'action.decline', reject: 'action.reject' };
export const actionWord = (a) => actionTextOf(a) || (ACTION_WORD[a.id] ? c(ACTION_WORD[a.id]) : a.label || a.id);

/** Rows of the inbox: when, who, what, and the door. An api action (approve, accept) is a coral door. */
export function inboxRows(ctx, rows) {
  return html`<div class="nt-rows">
    ${rows.map(n => { const acts = Array.isArray(n.actions) ? n.actions.filter(a => a.kind === 'api') : []; const busy = ctx.busyId === n.id; const res = ctx.results[n.id]; return html`
      <div class="nt-when poster-time" key=${'w' + n.id}><b>${rel(n.createdAt)}</b>${clock(n.createdAt)}</div>
      <div class="nt-src" key=${'s' + n.id}>${sourceName(n)}<small>${n.source?.kind === 'aimeat' ? groupWord(n.group) : kindWord(n.source?.kind)}</small></div>
      <div class=${`nt-what ${n.read ? '' : 'unread'}`} key=${'t' + n.id}><b>${titleOf(n)}</b><small>${firstLine(bodyOf(n))}</small>${res ? html`<em class=${res.ok ? 'ok' : 'bad'}>${res.msg}</em>` : null}</div>
      <div class="og-tbl-door nt-doors" key=${'d' + n.id}><div class="og-doors">
        ${acts.slice(0, 2).map(a => html`<button type="button" key=${a.id} class=${a.style === 'primary' ? 'poster-slab' : `poster-action poster-action--small${a.style === 'danger' ? ' poster-action--danger' : ''}`} disabled=${busy} onClick=${() => ctx.runAction(n, a)}>${busy ? '…' : actionWord(a)}</button>`)}
        <button type="button" class="poster-action poster-action--small" onClick=${() => ctx.open(n)}>${c('open')}</button>
      </div></div>`; })}
  </div>`;
}
export const inboxHead = () => html`<div class="nt-rows nt-rows--head"><div class="poster-label">${c('colWhen')}</div><div class="poster-label">${c('colWho')}</div><div class="poster-label">${c('colWhat')}</div><div class="poster-label"></div></div>`;

/** Rows of "who may notify you": a mark, the name and what it is, what it did, the decision. */
export function senderRows(ctx, rows) {
  return html`<div class="listing listing--cols listing--mark-name-desc-doors">
    ${rows.map(r => { const p = r.prefs || {}; return html`
      <div class="listing-row" key=${r.key}>
        <div><div class=${`ct-av nt-av poster-box poster-box--avatar ${r.kind === 'aimeat' ? '' : 'poster-box--agent'}`} aria-hidden="true">${(r.name || '?').slice(0, 1).toUpperCase()}</div></div>
        <div class="listing-name">${r.name}<small>${r.sub}</small></div>
        <div class="listing-desc">${r.what}</div>
        <div class="listing-doors">
          ${r.door}
          ${r.kind === 'aimeat' ? null : html`<button type="button" class="poster-action poster-action--small poster-action--row poster-action--lower" disabled=${ctx.busy} onClick=${() => ctx.setPref(r, { muted: !p.muted })}>${p.muted ? c('unmute') : c('mute')}</button>`}
          ${p.muted ? html`<span class="nt-muted"><span class="poster-status poster-status--off">${c('mutedWord')}</span></span>` : html`<${Switch} on=${p.push !== false} label=${c('push')} disabled=${ctx.busy} onToggle=${() => ctx.setPref(r, { push: p.push === false })} />`}
        </div>
      </div>`; })}
  </div>`;
}

/* ── The crumb and the rail ────────────────────────────────────────────────────────────────── */
export function crumb() {
  return html`<div class="og-crumb"><span>${t('nav.profile')}</span><span>/</span><span class="og-crumb-here">${c('title')}</span></div>`;
}
const openTab = (tabId) => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));
export function pageLinks() {
  return html`
    <button type="button" class="og-rail-link" onClick=${() => openTab('messages')}><i>→</i>${t('profile.tabs.inbox')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('apps')}><i>→</i>${t('profile.tabs.apps')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('workflows')}><i>→</i>${t('profile.workflows.title')}<em>→</em></button>`;
}
