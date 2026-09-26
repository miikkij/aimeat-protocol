/**
 * @file shared.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared components and utilities for profile tab modules. Every part here is a kit
 *   component with the words and the data a profile tab gives it; this file writes no class.
 *   Exports: LoadingLine, recipientBadge, isExpiringSoon, VisibilityPill, ToggleSwitch, GlassCard,
 *   KebabMenu, TagInput.
 * @version-history
 *   v1.9.0 -- 2026-09-26 -- Every part is a kit component (page group G8): LoadingLine is the Note's loading kind, recipientBadge and VisibilityPill the Mark (the visibility tag stays a button: Mark onClick), GlassCard the section Card, KebabMenu the ⋯ CardMenu at the end of a line (its divider kept: CardMenu `divider`), TagInput the field kit's TagInput (components/TagInput.js). Exports unchanged.
 *   v1.8.0 -- 2026-09-26 -- TagInput's × is the Tag's remove mark (.poster-chip-x, poster.css): grey, coral under the pointer, where it turned red (a unification: Jouni's decision "Remove mark").
 *   v1.7.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.6.0 -- 2026-09-25 -- The visibility pill is the Tag (.poster-chip), on the sun when public, as the memory cover draws visibility; it stays a button (a unification: Jouni's decision "Tag").
 *   v1.5.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.1.0 — 2026-09-25 — A button that is a mark, not a word (a delete or close mark, a menu's dots,
 *     an arrow), is the library's small icon button, .poster-icon.poster-icon--small (Jouni's decision
 *     "Icon button").
 *   2026-09-25 -- KebabMenu's delete row keeps its danger colour, as the menu row's danger tone.
 *   2026-09-25 -- KebabMenu's rows are the menu row (.poster-menu-row), a unification: Jouni's decision "Menu row"; a danger item reads like the others, as the notification's Approve does.
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
 *   v1.0.0 — 2026-03-07 — Initial shared helpers (Spinner, recipientBadge, isExpiringSoon)
 *   v1.1.0 — 2026-03-17 — Add VisibilityPill, ToggleSwitch, GlassCard components; refactor recipientBadge to CSS classes
 *   v1.2.0 — 2026-06-02 — Component unification (§2): Spinner now delegates to the
 *     canonical /components/Spinner.js (single source of the .spinner markup).
 *   v1.3.0 — 2026-06-02 — Component unification (#22): GlassCard now delegates to the
 *     canonical /components/Card.js via variant="glass" (.card-glass); call sites unchanged.
 *   v1.3.1 — 2026-06-19 — JSDoc type annotations for frontend type-checking
 *   v1.4.0 — 2026-06-19 — Promote KebabMenu (generic "…" actions menu) and TagInput (tag-chip
 *     input) out of organisms-tab.js into the profile shared layer so any profile view can reuse
 *     them; markup/CSS classes unchanged (.pj-menu* / .pj-taginput*), so the look is identical.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Card } from '/components/Card.js';
import { Note } from '/components/Note.js';
import { Mark } from '/components/Mark.js';
import { CardMenu } from '/components/CardMenu.js';

/** The loading line: the quiet sentence with the blinking Loading mark, the look most Settings
 *  tabs use for "this is loading". Without a text it says the profile's default "Loading…". */
export function LoadingLine({ text }) {
  return html`<${Note} kind="loading">${text || t('profile.loading')}<//>`;
}

/** The recipient's kind as a Tag; "anyone" is the one to notice. */
export function recipientBadge(recipient) {
  const r = recipient || '';
  let label, tone;
  if (r === '*')                        { label = t('permissions.badgeWildcard'); tone = 'coral'; }
  else if (r.startsWith('ghii:'))       { label = t('permissions.badgeGhii'); }
  else if (r.startsWith('organism.'))   { label = t('permissions.badgeOrganism'); }
  else if (r.startsWith('domain:'))     { label = t('permissions.badgeDomain'); }
  else if (r.startsWith('node:'))       { label = t('permissions.badgeNode'); }
  else                                  { label = t('permissions.badgeGaii'); }
  return html`<${Mark} tone=${tone}>${label}<//>`;
}

/** Check if a consent is expiring within 7 days. */
export function isExpiringSoon(expiresAt) {
  if (!expiresAt) return false;
  const diff = +new Date(expiresAt) - Date.now();
  return diff > 0 && diff < 7 * 86400000;
}

/** Shared visibility tag (memory-tab, organisms): the Tag, on the sun when public, and a button. */
export function VisibilityPill({ visibility, onClick }) {
  return html`<${Mark} tone=${visibility === 'public' ? 'sun' : undefined} onClick=${onClick || (() => {})}>
    ${t('profile.visibility.' + visibility)}
  <//>`;
}

/** Shared toggle switch — relocated to the canonical /components/ToggleSwitch.js (#14);
 *  re-exported here so notifications-tab/email-tab imports are unchanged. */
export { ToggleSwitch } from '/components/ToggleSwitch.js';

/** A group of settings as a section card (no caller in Settings today; kept for its importers). */
export function GlassCard({ children }) {
  return html`<${Card} tone="section">${children}<//>`;
}

/**
 * @typedef {{ label?: string, icon?: string, danger?: boolean, divider?: boolean,
 *   onClick?: () => void }} KebabItem
 */

/** "…" actions menu — items: { label, icon?, danger?, divider?, onClick } (falsy items are
 *  skipped). It is the ⋯ CardMenu at the end of a line (the List's row menu): Escape and a press
 *  elsewhere close it. `trigger` and `btnClass` are accepted for the old callers and not drawn.
 * @param {{ items: Array<KebabItem|false|null|undefined>, label?: string, trigger?: any, btnClass?: string }} props */
export function KebabMenu({ items, label }) {
  const actions = /** @type {KebabItem[]} */ ((items || []).filter(Boolean)).map((it) => (it.divider
    ? { divider: true, label: '' }
    : { label: it.icon ? `${it.icon} ${it.label}` : it.label, run: it.onClick || (() => {}), danger: it.danger }));
  if (!actions.some((a) => !a.divider)) return null;
  return html`<${CardMenu} inline="end" actions=${actions} label=${label} />`;
}

/** Tag chips + inline input: the field kit's TagInput (Enter/comma adds, the ✗ or Backspace in an
 *  empty field removes, leaving the field adds what is typed). */
export { TagInput } from '/components/TagInput.js';
