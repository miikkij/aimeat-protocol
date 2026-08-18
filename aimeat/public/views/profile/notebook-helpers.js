/**
 * @file notebook-helpers.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Small pure helpers + constants shared by the Notebook tab (notebook-tab.js) and the
 *   per-note organizer card (notebook-card.js): relative-time formatting, the collapsed one-line view,
 *   best-effort note-value-to-text, and the placement "new" sentinel / classify progress-step keys /
 *   inbox key prefix. Kept dependency-light (only i18n) so both modules can import without cycles.
 * @version-history
 *   v1.0.0 — 2026-06-21 — Extracted from notebook-tab.js when the tab was split into tab + card.
 */
import { t } from '/js/i18n.js';

/** Placement sentinel: "create a new organism/workspace" choice in the suggest dropdowns. */
export const NEW = '__new__';

/** Stages shown while the (slow) AI classify call runs, so the user sees what is happening. */
export const NB_STEPS = ['profile.notebook.step1', 'profile.notebook.step2'];

/** Memory key prefix for captured (unfiled) notebook notes. */
export const INBOX_PREFIX = 'notebook.inbox.';

/** Relative-time label for an ISO timestamp (just now / Nm / Nh / Nd / locale date). */
export function relTime(iso) {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return t('profile.memory.timeJustNow') || 'just now';
  if (mins < 60) return (t('profile.memory.timeMinsAgo') || '{n}m ago').replace('{n}', String(mins));
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return (t('profile.memory.timeHoursAgo') || '{n}h ago').replace('{n}', String(hrs));
  const days = Math.floor(hrs / 24);
  if (days < 30) return (t('profile.memory.timeDaysAgo') || '{n}d ago').replace('{n}', String(days));
  return new Date(iso).toLocaleDateString();
}

/** First non-empty line of a note (markdown heading marks stripped), for the collapsed one-line view. */
export function firstLine(text) {
  const line = (text || '').split('\n').map(l => l.trim()).find(Boolean) || '';
  return line.replace(/^#{1,6}\s+/, '').replace(/[*_`>#]/g, '').slice(0, 160);
}

/** Best-effort plain text of a note value for the inbox preview. */
export function noteText(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    return JSON.stringify(value);
  }
  return String(value ?? '');
}
