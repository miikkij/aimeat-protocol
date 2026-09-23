/**
 * @file public/views/profile/email/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Email cover shares: the words (a provider's name, a connection's state, a
 *   mail log kind, an outbound channel), relative time, the switch, the crumb and the rail.
 * @structure c · rel · day · providerWord · kindWord · channelWord · Switch · crumb · pageLinks
 * @usage import { c, rel, Switch, crumb, pageLinks } from './frame.js';
 * @version-history
 *   2026-09-22 -- Composed from the shared set: the switch is a switch Action (a locked one is on
 *     and disabled), the crumb is Masthead crumbs and the rail links are text actions; no class of
 *     its own, so email-poster.css can go.
 *   v1.0.0 — 2026-08-30 — Initial (design canvas "AIMEAT Sähköpostin sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { date as fmtDate, time as fmtTime } from '/js/format.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';
import { Action, Stack, Text } from '/components/poster-parts.js';

export const c = (key, vars) => t('emailpage.' + key, vars);
// The locale() helper here derived the FORMAT from the LANGUAGE. They are different settings:
// /js/format.js reads the reader's own, from their profile, falling back to their browser.
export const day = (iso) => (iso ? fmtDate(iso) : '');
export const clock = (iso) => (iso ? fmtTime(iso, { hour: '2-digit', minute: '2-digit' }) : '');
export const rel = (iso) => { if (!iso) return ''; const d = new Date(iso); return Date.now() - d.getTime() > 30 * 864e5 ? day(iso) : formatRelativeTime(iso); };

/** A provider as a person reads it: Gmail, Gmail (sending), Outlook. */
export const providerWord = (p) => { if (!p) return ''; const k = 'emailpage.provider.' + p.id; const s = t(k); return s && s !== k ? s : (p.label || p.id); };
export const isSender = (p) => (p?.capabilities || []).includes('send-mail');
export const stateWord = (conn) => (conn ? c('state.' + (conn.status === 'active' ? 'active' : conn.status === 'expired' || conn.status === 'needs-reauth' ? 'expired' : 'other')) : c('state.none'));
const MAIL_KINDS = ['verification', 'password_reset', 'username', 'magic_link', 'workflow_end', 'digest', 'nudge', 'invitation'];
export const kindWord = (kind) => (MAIL_KINDS.includes(kind) ? c('kind.' + kind) : kind);
/** Where it went: to an email address, or into a person's AIMEAT inbox. */
export const channelWord = (m) => c(m?.channel === 'inbox' ? 'via.inbox' : 'via.email');
export const statusWord = (s) => c('status.' + (['sent', 'failed', 'suppressed', 'skipped'].includes(s) ? s : 'other'));

/** An on/off setting: the shared tab action with switch semantics. A locked one is on and cannot be changed. */
export function Switch({ on, label, disabled, locked, onToggle }) {
  return html`<${Action} kind="tab" semantics="switch" selected=${!!(on || locked)} disabled=${disabled || locked} onClick=${onToggle}>${label}<//>`;
}

/** The trail as Masthead crumbs: Settings & Controls, Activity, Email. */
export function crumb() {
  return [{ label: t('nav.profile') }, { label: t('profile.landing.menuActivity') }, { label: c('title') }];
}
const openTab = (tabId) => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));
/** The doors to the pages next to this one, for the rail. */
export function pageLinks() {
  return html`<${Stack} density="compact">
    <${Text} kind="label">${c('pages')}<//>
    <${Action} kind="text" onClick=${() => openTab('notifications')}>→ ${t('profile.tabs.notifications')}<//>
    <${Action} kind="text" onClick=${() => openTab('contacts')}>→ ${t('contacts.title')}<//>
    <${Action} kind="text" onClick=${() => openTab('access')}>→ ${t('profile.tabs.access')}<//>
  <//>`;
}
