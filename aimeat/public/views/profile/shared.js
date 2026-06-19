/**
 * @file shared.js
 * @description Shared components and utilities for profile tab modules.
 *   Exports: Spinner, recipientBadge, isExpiringSoon, VisibilityPill, ToggleSwitch, GlassCard.
 * @version-history
 *   v1.0.0 — 2026-03-07 — Initial shared helpers (Spinner, recipientBadge, isExpiringSoon)
 *   v1.1.0 — 2026-03-17 — Add VisibilityPill, ToggleSwitch, GlassCard components; refactor recipientBadge to CSS classes
 *   v1.2.0 — 2026-06-02 — Component unification (§2): Spinner now delegates to the
 *     canonical /components/Spinner.js (single source of the .spinner markup).
 *   v1.3.0 — 2026-06-02 — Component unification (#22): GlassCard now delegates to the
 *     canonical /components/Card.js via variant="glass" (.card-glass); call sites unchanged.
 *   v1.3.1 — 2026-06-19 — JSDoc type annotations for frontend type-checking
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Spinner as BaseSpinner } from '/components/Spinner.js';
import { Card } from '/components/Card.js';

/** Loading spinner — delegates to the canonical /components/Spinner.js (single
 *  source of the .spinner markup); keeps the profile default loading label so the
 *  23 profile call sites that rely on it are unchanged. */
export function Spinner({ text }) {
  return html`<${BaseSpinner} text=${text || t('profile.loading')} />`;
}

/** Render a colored recipient-type badge. */
export function recipientBadge(recipient) {
  const r = recipient || '';
  let label, cls;
  if (r === '*')                        { label = t('permissions.badgeWildcard'); cls = 'badge-wildcard'; }
  else if (r.startsWith('ghii:'))       { label = t('permissions.badgeGhii');     cls = 'badge-ghii'; }
  else if (r.startsWith('organism.'))   { label = t('permissions.badgeOrganism'); cls = 'badge-organism'; }
  else if (r.startsWith('domain:'))     { label = t('permissions.badgeDomain');   cls = 'badge-domain'; }
  else if (r.startsWith('node:'))       { label = t('permissions.badgeNode');     cls = 'badge-node'; }
  else                                  { label = t('permissions.badgeGaii');     cls = 'badge-gaii'; }
  return html`<span class="badge-label ${cls}">${label}</span>`;
}

/** Check if a consent is expiring within 7 days. */
export function isExpiringSoon(expiresAt) {
  if (!expiresAt) return false;
  const diff = +new Date(expiresAt) - Date.now();
  return diff > 0 && diff < 7 * 86400000;
}

/** Shared visibility toggle pill (memory-tab, knowledge-tab). */
export function VisibilityPill({ visibility, onClick }) {
  return html`<button class="vis-pill vis-${visibility}" onClick=${onClick}>
    ${t('profile.visibility.' + visibility)}
  </button>`;
}

/** Shared toggle switch — relocated to the canonical /components/ToggleSwitch.js (#14);
 *  re-exported here so notifications-tab/email-tab imports are unchanged. */
export { ToggleSwitch } from '/components/ToggleSwitch.js';

/** Glass-style card container (email-tab, notifications-tab) — delegates to the
 *  canonical /components/Card.js (variant="glass" → .card-glass); call sites unchanged. */
export function GlassCard({ children }) {
  return html`<${Card} variant="glass" hoverable=${false}>${children}<//>`;
}
