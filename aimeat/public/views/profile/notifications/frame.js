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
 *   v1.0.0 — 2026-08-30 — Initial (design canvas "AIMEAT Ilmoitusten sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';
import { titleOf, bodyOf, sourceName, kindWord, groupWord } from '/js/services/notifications.js';

export const c = (key, vars) => t('notifpage.' + key, vars);
export const locale = () => (getLocale() === 'fi' ? 'fi-FI' : getLocale() === 'es' ? 'es-CO' : 'en-GB');
export const day = (iso) => (iso ? new Date(iso).toLocaleDateString(locale()) : '');
export const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : '');
export const rel = (iso) => { if (!iso) return ''; const d = new Date(iso); return Date.now() - d.getTime() > 30 * 864e5 ? day(iso) : formatRelativeTime(iso); };
export const firstLine = (s) => String(s || '').split(/\r?\n/).map(l => l.trim()).find(Boolean) || '';

/** The poster switch: a label and a two-state box. */
export function Switch({ on, label, disabled, onToggle }) {
  // The word on the left, the box on the right, so a column of switches lines up on its boxes.
  return html`<button type="button" class=${`nt-sw ${on ? 'on' : 'off'}`} disabled=${disabled} aria-pressed=${on ? 'true' : 'false'} onClick=${onToggle}>${label}<i></i></button>`;
}

const ACTION_WORD = { reply: 'action.reply', approve: 'action.approve', deny: 'action.deny', accept: 'action.accept', decline: 'action.decline', reject: 'action.reject' };
export const actionWord = (a) => (ACTION_WORD[a.id] ? c(ACTION_WORD[a.id]) : a.label || a.id);

/** Rows of the inbox: when, who, what, and the door. An api action (approve, accept) is a coral door. */
export function inboxRows(ctx, rows) {
  return html`<div class="nt-rows">
    ${rows.map(n => { const acts = Array.isArray(n.actions) ? n.actions.filter(a => a.kind === 'api') : []; const busy = ctx.busyId === n.id; const res = ctx.results[n.id]; return html`
      <div class="nt-when" key=${'w' + n.id}><b>${rel(n.createdAt)}</b>${clock(n.createdAt)}</div>
      <div class="nt-src" key=${'s' + n.id}>${sourceName(n)}<small>${n.source?.kind === 'aimeat' ? groupWord(n.group) : kindWord(n.source?.kind)}</small></div>
      <div class=${`nt-what ${n.read ? '' : 'unread'}`} key=${'t' + n.id}><b>${titleOf(n)}</b><small>${firstLine(bodyOf(n))}</small>${res ? html`<em class=${res.ok ? 'ok' : 'bad'}>${res.msg}</em>` : null}</div>
      <div class="og-tbl-door nt-doors" key=${'d' + n.id}>
        ${acts.slice(0, 2).map(a => html`<button type="button" key=${a.id} class=${`og-door ${a.style === 'danger' ? 'og-door--danger' : a.style === 'primary' ? 'og-door--coral' : 'og-door--quiet'}`} disabled=${busy} onClick=${() => ctx.runAction(n, a)}>${busy ? '…' : actionWord(a)}</button>`)}
        <button type="button" class="og-door" onClick=${() => ctx.open(n)}>${c('open')}</button>
      </div>`; })}
  </div>`;
}
export const inboxHead = () => html`<div class="nt-rows nt-rows--head"><div>${c('colWhen')}</div><div>${c('colWho')}</div><div>${c('colWhat')}</div><div></div></div>`;

/** Rows of "who may notify you": a mark, the name and what it is, what it did, the decision. */
export function senderRows(ctx, rows) {
  return html`<div class="nt-src-rows">
    ${rows.map(r => { const p = r.prefs || {}; return html`
      <div class=${`ct-av nt-av ${r.kind === 'aimeat' ? '' : 'ct-av--agent'}`} key=${'a' + r.key} aria-hidden="true">${(r.name || '?').slice(0, 1).toUpperCase()}</div>
      <div class="nt-nm" key=${'n' + r.key}>${r.name}<small>${r.sub}</small></div>
      <div class="nt-w" key=${'w' + r.key}>${r.what}</div>
      <div class="nt-ctl" key=${'c' + r.key}>
        ${r.door}
        ${r.kind === 'aimeat' ? null : html`<button type="button" class="og-door og-door--quiet" disabled=${ctx.busy} onClick=${() => ctx.setPref(r, { muted: !p.muted })}>${p.muted ? c('unmute') : c('mute')}</button>`}
        ${p.muted ? html`<span class="nt-muted">${c('mutedWord')}</span>` : html`<${Switch} on=${p.push !== false} label=${c('push')} disabled=${ctx.busy} onToggle=${() => ctx.setPref(r, { push: p.push === false })} />`}
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
