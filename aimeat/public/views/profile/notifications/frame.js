/**
 * @file public/views/profile/notifications/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Notifications cover shares: the words (relative time, a device's browser
 *   family, the switch), the rows of the inbox table with their doors and actions, the sender rows
 *   with their decisions, the crumb and the rail. Every machine word (a group, a kind, an action id)
 *   is turned into the reader's language here.
 * @structure c · rel · Switch · inboxTable · senderRows · road · crumb · pageLinks
 * @usage import { c, inboxTable, senderRows, crumb, pageLinks } from './frame.js';
 * @version-history
 *   2026-09-22 -- Composed from the shared set: the inbox is a Table, a sender is a ListRow with a
 *     Chip mark, the switch is a switch Action, the crumb is Masthead crumbs and the rail links are
 *     text actions; no class of its own (notifications-poster.css keeps only the old switch,
 *     for the inbox's organize page).
 *   2026-09-13 -- Compose the shared initials-box role and its measured size cut.
 *   v1.0.0 — 2026-08-30 — Initial (design canvas "AIMEAT Ilmoitusten sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { date as fmtDate, time as fmtTime } from '/js/format.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';
import { titleOf, bodyOf, sourceName, kindWord, groupWord } from '/js/services/notifications.js';
import { Table, ListRow, Chip, Action, Stack, Text, Surface } from '/components/poster-parts.js';

export const c = (key, vars) => t('notifpage.' + key, vars);
// The locale() helper here derived the FORMAT from the LANGUAGE. They are different settings:
// /js/format.js reads the reader's own, from their profile, falling back to their browser.
export const day = (iso) => (iso ? fmtDate(iso) : '');
export const clock = (iso) => (iso ? fmtTime(iso, { hour: '2-digit', minute: '2-digit' }) : '');
export const rel = (iso) => { if (!iso) return ''; const d = new Date(iso); return Date.now() - d.getTime() > 30 * 864e5 ? day(iso) : formatRelativeTime(iso); };
export const firstLine = (s) => String(s || '').split(/\r?\n/).map(l => l.trim()).find(Boolean) || '';

/** An on/off setting: the shared tab action with switch semantics, on the sun while on. */
export function Switch({ on, label, disabled, onToggle }) {
  return html`<${Action} kind="tab" semantics="switch" selected=${!!on} disabled=${disabled} onClick=${onToggle}>${label}<//>`;
}

const ACTION_WORD = { reply: 'action.reply', approve: 'action.approve', deny: 'action.deny', accept: 'action.accept', decline: 'action.decline', reject: 'action.reject' };
export const actionWord = (a) => (ACTION_WORD[a.id] ? c(ACTION_WORD[a.id]) : a.label || a.id);

/** An api action (approve, accept) is an underlined word; a danger one is red; a quiet one a text word. */
const actionOf = (ctx, n, a, busy) => html`<${Action} key=${a.id}
  kind=${a.style === 'danger' || a.style === 'primary' ? 'secondary' : 'text'} tone=${a.style === 'danger' ? 'danger' : undefined}
  disabled=${busy} onClick=${() => ctx.runAction(n, a)}>${busy ? '…' : actionWord(a)}<//>`;

/** The inbox as a table: when, who, what, and the doors. An unread title is in ink, a read one quieter. */
export function inboxTable(ctx, rows) {
  return html`<${Table} collapse=${600} density="compact" label=${c('secInbox')}
    headers=${[c('colWhen'), c('colWho'), c('colWhat'), '']}
    rows=${rows.map(n => {
      const acts = Array.isArray(n.actions) ? n.actions.filter(a => a.kind === 'api') : [];
      const busy = ctx.busyId === n.id; const res = ctx.results[n.id];
      return [
        // Plain cell content, so the table sizes its columns on whole words (a Text part breaks
        // anywhere); one span per cell, so a stacked row on a phone keeps the two lines together.
        html`<span>${rel(n.createdAt)}<br />${clock(n.createdAt)}</span>`,
        html`<span><strong>${sourceName(n)}</strong><br />${n.source?.kind === 'aimeat' ? groupWord(n.group) : kindWord(n.source?.kind)}</span>`,
        html`<${Stack} density="compact">
          <${Text} tone=${n.read ? 'muted' : 'plain'}><strong>${titleOf(n)}</strong><//>
          ${firstLine(bodyOf(n)) ? html`<${Text} kind="caption" tone="muted">${firstLine(bodyOf(n))}<//>` : null}
          ${res ? html`<${Text} kind="mono" tone=${res.ok ? 'success' : 'danger'}>${res.msg}<//>` : null}
        <//>`,
        html`<${Stack} direction="wrap" density="compact">
          ${acts.slice(0, 2).map(a => actionOf(ctx, n, a, busy))}
          <${Action} onClick=${() => ctx.open(n)}>${c('open')}<//>
        <//>`,
      ];
    })} />`;
}

/** Rows of "who may notify you": a mark, the name and what it is, what it did, the decision. */
export function senderRows(ctx, rows) {
  return html`<${Stack} density="compact">${rows.map(r => { const p = r.prefs || {}; return html`
    <${ListRow} key=${r.key} density="compact"
      mark=${html`<${Chip} tone=${r.kind === 'aimeat' ? 'plain' : 'muted'}>${(r.name || '?').slice(0, 1).toUpperCase()}<//>`}
      name=${r.name} detail=${r.sub}
      actions=${html`
        ${r.door}
        ${r.kind === 'aimeat' ? null : html`<${Action} kind="text" disabled=${ctx.busy} onClick=${() => ctx.setPref(r, { muted: !p.muted })}>${p.muted ? c('unmute') : c('mute')}<//>`}
        ${p.muted ? html`<${Text} kind="mono" tone="coral">${c('mutedWord')}<//>` : html`<${Switch} on=${p.push !== false} label=${c('push')} disabled=${ctx.busy} onToggle=${() => ctx.setPref(r, { push: p.push === false })} />`}`}>
      <${Text} kind="caption" tone="muted">${r.what}<//>
    <//>`; })}<//>`;
}

/** A road in (an app, an extension, an agent): its kind, its name, what it is, and the call, in one box. */
export const road = (k, kind, title, body, code) => html`
  <${Surface} key=${k} kind="box" density="compact">
    <${Stack} density="compact">
      <${Text} kind="label">${kind}<//>
      <${Text}><strong>${title}</strong><//>
      <${Text} kind="caption" tone="muted">${body}<//>
      <${Surface} kind="code" density="compact">${code}<//>
    <//>
  <//>`;

/* ── The crumb and the rail ────────────────────────────────────────────────────────────────── */
/** The trail as Masthead crumbs: Settings & Controls, Activity, Notifications. */
export function crumb() {
  return [{ label: t('nav.profile') }, { label: t('profile.landing.menuActivity') }, { label: c('title') }];
}
const openTab = (tabId) => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));
/** The doors to the pages next to this one, for the rail. */
export function pageLinks() {
  return html`<${Stack} density="compact">
    <${Text} kind="label">${c('pages')}<//>
    <${Action} kind="text" onClick=${() => openTab('messages')}>→ ${t('profile.tabs.inbox')}<//>
    <${Action} kind="text" onClick=${() => openTab('apps')}>→ ${t('profile.tabs.apps')}<//>
    <${Action} kind="text" onClick=${() => openTab('workflows')}>→ ${t('profile.workflows.title')}<//>
  <//>`;
}
