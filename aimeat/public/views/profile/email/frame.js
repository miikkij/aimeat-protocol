/**
 * @file public/views/profile/email/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Email cover shares: the words (a provider's name, a connection's state, a
 *   mail log kind, an outbound channel), relative time, the switch, the crumb and the rail.
 * @structure c · rel · day · providerWord · kindWord · channelWord · Switch · crumb · pageLinks
 * @usage import { c, rel, Switch, crumb, pageLinks } from './frame.js';
 * @version-history
 *   v1.0.0 — 2026-08-30 — Initial (design canvas "AIMEAT Sähköpostin sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';

export const c = (key, vars) => t('emailpage.' + key, vars);
export const locale = () => (getLocale() === 'fi' ? 'fi-FI' : getLocale() === 'es' ? 'es-CO' : 'en-GB');
export const day = (iso) => (iso ? new Date(iso).toLocaleDateString(locale()) : '');
export const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : '');
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

/** The poster switch: the word on the left, the box on the right. */
export function Switch({ on, label, disabled, locked, onToggle }) {
  return html`<button type="button" class=${`nt-sw ${locked ? 'lock on' : on ? 'on' : 'off'}`} disabled=${disabled || locked} aria-pressed=${on ? 'true' : 'false'} onClick=${onToggle}>${label}<i></i></button>`;
}

export function crumb() {
  return html`<div class="og-crumb"><span>${t('nav.profile')}</span><span>/</span><span class="og-crumb-here">${c('title')}</span></div>`;
}
const openTab = (tabId) => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));
export function pageLinks() {
  return html`
    <button type="button" class="og-rail-link" onClick=${() => openTab('notifications')}><i>→</i>${t('profile.tabs.notifications')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('contacts')}><i>→</i>${t('contacts.title')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('access')}><i>→</i>${t('profile.tabs.access')}<em>→</em></button>`;
}
