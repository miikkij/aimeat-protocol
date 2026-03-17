/**
 * @file shared.js
 * @description Shared components and utilities for profile tab modules.
 *   Exports: Spinner, recipientBadge, isExpiringSoon, VisibilityPill, ToggleSwitch, GlassCard.
 * @version-history
 *   v1.0.0 — 2026-03-07 — Initial shared helpers (Spinner, recipientBadge, isExpiringSoon)
 *   v1.1.0 — 2026-03-17 — Add VisibilityPill, ToggleSwitch, GlassCard components; refactor recipientBadge to CSS classes
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

/** Loading spinner. */
export function Spinner({ text }) {
  return html`<span class="spinner"></span><span class="loading-text">${text || t('profile.loading')}</span>`;
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
  const diff = new Date(expiresAt) - Date.now();
  return diff > 0 && diff < 7 * 86400000;
}

/** Shared visibility toggle pill (memory-tab, knowledge-tab). */
export function VisibilityPill({ visibility, onClick }) {
  return html`<button class="vis-pill vis-${visibility}" onClick=${onClick}>
    ${t('profile.visibility.' + visibility)}
  </button>`;
}

/** Shared toggle switch (notifications-tab, email-tab). */
export function ToggleSwitch({ checked, onChange, label }) {
  return html`<label class="pf-toggle">
    <input type="checkbox" checked=${checked} onChange=${onChange} class="pf-toggle-input" />
    <span class="pf-toggle-slider"></span>
    ${label && html`<span class="pf-toggle-label">${label}</span>`}
  </label>`;
}

/** Glass-style card container (email-tab, notifications-tab). */
export function GlassCard({ children }) {
  return html`<div class="pf-glass-card">${children}</div>`;
}
