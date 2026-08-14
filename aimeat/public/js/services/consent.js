/**
 * @file public/js/services/consent.js
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

/** Load permissions summary. */
export async function getPermissionSummary() {
  const data = await apiGet('/v1/permissions/summary');
  return data?.data || null;
}

/**
 * Composite mount for the Data Wallet tab: consents + audit + permission summary in ONE call. Returns
 * { consents, audit, permSummary } or null on error so the caller can fall back to the individual reads.
 */
export async function getDataWalletOverview(days) {
  try {
    const data = await apiGet('/v1/data-wallet' + (days ? '?days=' + days : ''));
    const d = data?.data;
    if (!d) return null;
    return {
      consents: d.consents?.consents || [],
      audit: d.audit?.entries || [],
      permSummary: d.permSummary || null,
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
