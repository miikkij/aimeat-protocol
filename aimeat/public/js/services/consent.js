/**
 * @file public/js/services/consent.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Frontend API-service wrapper for the consent, permissions, audit, and GDPR-export
 *   endpoints — thin fetch helpers that unwrap the response envelope for SPA views.
 *
 * @structure
 *   - listConsents / grantConsent / revokeConsent / bulkRevoke: manage active consent grants
 *   - listAuditEntries: fetch consent audit-log entries for a day range
 *   - getPermissionSummary / getKeyPermissions: effective permission rules & visibility per key
 *   - exportGdpr: full owner data export
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { apiGet, api } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

/** List all active consents. Returns array. */
export async function listConsents() {
  const data = await apiGet('/v1/consent');
  return data?.data?.consents || (Array.isArray(data?.data) ? data.data : []);
}

/** Grant a new consent. */
export async function grantConsent(body) {
  return api('/v1/consent', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Revoke a single consent by ID. */
export async function revokeConsent(consentId) {
  return api('/v1/consent/' + encodeURIComponent(consentId), { method: 'DELETE' });
}

/** Revoke multiple consents by IDs. Throws on first failure. */
export async function bulkRevoke(consentIds) {
  for (const id of consentIds) {
    await api('/v1/consent/' + encodeURIComponent(id), { method: 'DELETE' });
  }
}

/** Load audit log entries for a given number of days. Returns array. */
export async function listAuditEntries(days) {
  const data = await apiGet('/v1/consent/audit?days=' + (days || 30));
  return data?.data?.entries || (Array.isArray(data?.data) ? data.data : []);
}

/**
 * The rows of one group of the trail: the window, the accessor, the key prefix and a page.
 * @param {{ days?: number, accessor?: string, keyPrefix?: string, limit?: number, offset?: number }} [opts]
 * @returns {Promise<{ entries: Array, total: number }>}
 */
export async function listAuditRows(opts) {
  const o = opts || {};
  const q = new URLSearchParams();
  q.set('days', String(o.days || 30));
  if (o.accessor) q.set('accessor_gaii', o.accessor);
  if (o.keyPrefix) q.set('key_prefix', o.keyPrefix);
  if (o.limit) q.set('limit', String(o.limit));
  if (o.offset) q.set('offset', String(o.offset));
  const data = await apiGet('/v1/consent/audit?' + q.toString());
  return { entries: data?.data?.entries || [], total: data?.data?.total ?? 0 };
}

/** Load permissions summary. */
export async function getPermissionSummary() {
  const data = await apiGet('/v1/permissions/summary');
  return data?.data || null;
}

/**
 * Composite mount for the Data Wallet tab: consents + audit + permission summary in ONE call. Returns
 * { consents, audit, permSummary } or null on error so the caller can fall back to the individual reads.
 */
export async function getDataWalletOverview(days, entryLimit) {
  try {
    const q = new URLSearchParams();
    if (days) q.set('days', String(days));
    if (entryLimit !== undefined) q.set('entry_limit', String(entryLimit));
    const qs = q.toString();
    const data = await apiGet('/v1/data-wallet' + (qs ? '?' + qs : ''));
    const d = data?.data;
    if (!d) return null;
    return {
      consents: { consents: d.consents?.consents || [], total: d.consents?.total ?? (d.consents?.consents || []).length },
      audit: { entries: d.audit?.entries || [], total: d.audit?.total ?? 0, period_days: d.audit?.period_days ?? days ?? 30, entry_limit: d.audit?.entry_limit ?? 0, groups: d.audit?.groups || [] },
      permSummary: d.permSummary || null,
      names: { organisms: d.names?.organisms || {}, workspaces: d.names?.workspaces || {} },
    };
  } catch (err) { swallowed('consent: getDataWalletOverview', err); return null; }
}

/** Load effective permission rules for a specific memory key. */
export async function getKeyPermissions(key) {
  const data = await apiGet('/v1/permissions/memory/' + encodeURIComponent(key));
  return {
    rules: data?.data?.effective_rules || [],
    visibility: data?.data?.visibility || 'private',
  };
}

/** Export all owner data (GDPR). Returns the full export object. */
export async function exportGdpr(ownerName) {
  return apiGet('/v1/owners/' + encodeURIComponent(ownerName) + '/export');
}
