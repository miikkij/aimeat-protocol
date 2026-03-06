/**
 * Shared components and utilities for profile tab modules.
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
  let label, color;
  if (r === '*')                        { label = t('permissions.badgeWildcard'); color = '#ef4444'; }
  else if (r.startsWith('ghii:'))       { label = t('permissions.badgeGhii'); color = '#8b5cf6'; }
  else if (r.startsWith('organism.'))   { label = t('permissions.badgeOrganism'); color = '#22c55e'; }
  else if (r.startsWith('domain:'))     { label = t('permissions.badgeDomain'); color = '#f97316'; }
  else if (r.startsWith('node:'))       { label = t('permissions.badgeNode'); color = '#6b7280'; }
  else                                  { label = t('permissions.badgeGaii'); color = '#3b82f6'; }
  return html`<span class="badge" style="background:${color};color:#fff;font-size:.7rem;padding:2px 6px;border-radius:4px">${label}</span>`;
}

/** Check if a consent is expiring within 7 days. */
export function isExpiringSoon(expiresAt) {
  if (!expiresAt) return false;
  const diff = new Date(expiresAt) - Date.now();
  return diff > 0 && diff < 7 * 86400000;
}
