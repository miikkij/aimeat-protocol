/**
 * @file public/views/profile/email/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Email cover shares: the words (a provider's name, a connection's state, a
 *   mail log kind, an outbound channel), relative time, the switch, the crumb and the rail.
 * @structure c · rel · day · providerWord · kindWord · channelWord · Switch · crumb · pageLinks
 * @usage import { c, rel, Switch, crumb, pageLinks } from './frame.js';
 * @version-history
 *   v1.2.0 — 2026-09-26 — The crumb and the rail's sibling pages are data for SettingsPage (component plan C9); this file writes no markup (page group G8).
 *   v1.1.0 — 2026-09-25 — A setting that is on or off is the library's Switch (components/Switch.js), the look most Settings tabs draw (UI consolidation phase 5, a unification).
 *   v1.0.0 — 2026-08-30 — Initial (design canvas "AIMEAT Sähköpostin sivu", direction A).
 */
import { t } from '/js/i18n.js';
import { date as fmtDate, time as fmtTime } from '/js/format.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';

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

/** The switch is the library's: the word on the left, the box on the right; `locked` is on for good. */
export { Switch } from '/components/Switch.js';

/** The crumb's steps (SettingsPage draws them). */
export function crumb() {
  return [t('nav.profile'), c('title')];
}
/** The sibling pages in the rail, as data (SettingsPage draws them → … →). */
export function pageLinks() {
  return [
    { tab: 'notifications', label: t('profile.tabs.notifications') },
    { tab: 'contacts', label: t('contacts.title') },
    { tab: 'access', label: t('profile.tabs.access') },
  ];
}
