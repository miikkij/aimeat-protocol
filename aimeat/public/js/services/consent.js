/**
 * AIMEAT Consent & Permissions Service
 * Consent management, audit trail, permissions, GDPR export.
 */
import { apiGet, api } from '/js/api.js';

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
