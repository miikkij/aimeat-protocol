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
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';

/** Placement sentinel: "create a new organism/workspace" choice in the suggest dropdowns. */
export const NEW = '__new__';

/** Stages shown while the (slow) AI classify call runs, so the user sees what is happening. */
export const NB_STEPS = ['profile.notebook.step1', 'profile.notebook.step2'];

/** Memory key prefix for captured (unfiled) notebook notes. */
export const INBOX_PREFIX = 'notebook.inbox.';

/**
 * Relative-time label for an ISO timestamp: how long ago, or the date once that stops helping.
 *
 * This was a second copy of the memory tab's helper, down to the same keys and the same thirty-day
 * horizon, and the two had to be kept in step by hand. One of them is the rule now.
 */
export const relTime = formatRelativeTime;

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
