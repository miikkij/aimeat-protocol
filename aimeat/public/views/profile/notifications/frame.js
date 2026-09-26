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
 *   v1.10.0 -- 2026-09-26 -- Every part is a kit component (the inbox and the senders are the List: When, Who, Name with its unread mark and the answer's note, Lead with the agent's mark, Doors with Loud and Action answers, Mark for a muted sender; the crumb and the rail are data): the page passes data and writes no class (page group G8).
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
import { List, Row, When, Who, Name, Lead, Desc, Doors } from '/components/List.js';
import { Mark } from '/components/Mark.js';
import { Action, Loud } from '/components/Action.js';

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

/** One api answer of a notification (approve, accept): the loud one for the primary answer, a danger link for a refusal. */
function answer(ctx, n, a, busy) {
  const words = busy ? '…' : actionWord(a);
  const run = () => ctx.runAction(n, a);
  if (a.style === 'primary') return html`<${Loud} key=${a.id} disabled=${busy} onClick=${run}>${words}<//>`;
  return html`<${Action} small key=${a.id} tone=${a.style === 'danger' ? 'danger' : undefined} disabled=${busy} onClick=${run}>${words}<//>`;
}

/** The inbox, with its heading row: when, who, what (unread marked), and the doors. */
export function inboxRows(ctx, rows) {
  return html`<${List} cols="when-who-name-doors" keepCols head=${[c('colWhen'), c('colWho'), c('colWhat'), '']}>
    ${rows.map(n => {
      const acts = Array.isArray(n.actions) ? n.actions.filter(a => a.kind === 'api') : [];
      const busy = ctx.busyId === n.id;
      const res = ctx.results[n.id];
      return html`
      <${Row} key=${n.id}>
        <${When} at=${clock(n.createdAt)}>${rel(n.createdAt)}<//>
        <${Who} sub=${n.source?.kind === 'aimeat' ? groupWord(n.group) : kindWord(n.source?.kind)}>${sourceName(n)}<//>
        <${Name} unread=${!n.read} meta=${firstLine(bodyOf(n))} note=${res ? res.msg : null} noteTone=${res?.ok ? 'fine' : undefined}>${titleOf(n)}<//>
        <${Doors}>
          ${acts.slice(0, 2).map(a => answer(ctx, n, a, busy))}
          <${Action} small onClick=${() => ctx.open(n)}>${c('open')}<//>
        <//>
      <//>`; })}
  <//>`;
}

/** "Who may notify you": a mark (a sender that is not AIMEAT is the agent's mark), the name and
 *  what it is, what it did, the decision (mute, or push on and off; a muted one says so). */
export function senderRows(ctx, rows, { under = false } = {}) {
  return html`<${List} cols="mark-name-desc-doors" keepCols under=${under}>
    ${rows.map(r => { const p = r.prefs || {}; return html`
      <${Row} key=${r.key}>
        <${Lead} text=${(r.name || '?').slice(0, 1).toUpperCase()} agent=${r.kind !== 'aimeat'} />
        <${Name} meta=${r.sub}>${r.name}<//>
        <${Desc}>${r.what}<//>
        <${Doors}>
          ${r.door}
          ${r.kind === 'aimeat' ? null : html`<${Action} small row soft disabled=${ctx.busy} onClick=${() => ctx.setPref(r, { muted: !p.muted })}>${p.muted ? c('unmute') : c('mute')}<//>`}
          ${p.muted
            ? html`<${Mark} kind="status" tone="off">${c('mutedWord')}<//>`
            : html`<${Switch} on=${p.push !== false} label=${c('push')} disabled=${ctx.busy} onToggle=${() => ctx.setPref(r, { push: p.push === false })} />`}
        <//>
      <//>`; })}
  <//>`;
}

/* ── The crumb and the rail ────────────────────────────────────────────────────────────────── */
/** The crumb's steps (SettingsPage draws them). */
export function crumb() {
  return [t('nav.profile'), c('title')];
}
/** The sibling pages in the rail, as data (SettingsPage draws them → … →). */
export function pageLinks() {
  return [
    { tab: 'messages', label: t('profile.tabs.inbox') },
    { tab: 'apps', label: t('profile.tabs.apps') },
    { tab: 'workflows', label: t('profile.workflows.title') },
  ];
}
