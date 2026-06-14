/**
 * @file ecosystem.js
 * @description AIMEAT Ecosystem Apps (GEAI) service — the owner-facing API layer for the profile
 *   "Ecosystem apps" tab. Wraps the /v1/ecosystem-apps + /v1/ecosystem endpoints (the GEAI
 *   onboarding handshake, the connected-app list, outbound event subscriptions, and revoke).
 * @structure listEcosystemApps · listPending · approve · revoke · listSubscriptions · subscribe · unsubscribe
 * @usage import { listEcosystemApps, approve } from '/js/services/ecosystem.js';
 * @version-history
 *   v1.0.0 — 2026-06-14 — Created for the Ecosystem apps profile tab (chunk 6).
 */
import { apiGet, apiPost, apiDelete } from '/js/api.js';

/** The owner's connected GEAIs. Returns an array. */
export async function listEcosystemApps() {
  const data = await apiGet('/v1/ecosystem-apps');
  return data?.data?.ecosystem_apps || [];
}

/** Pending "hello integration" requests awaiting the owner's approval. Returns an array. */
export async function listPending() {
  const data = await apiGet('/v1/ecosystem-apps/pending');
  return data?.data?.requests || [];
}

/** Approve or deny a pending request by its user code, selecting scopes (and optional data areas). */
export async function approve(userCode, { action, scopes, data_areas } = {}) {
  return apiPost(`/v1/ecosystem-apps/${encodeURIComponent(userCode)}/approve`, { action, scopes, data_areas });
}

/** Revoke a connected GEAI by its app name (status → revoked; the tunnel is torn down server-side). */
export async function revoke(app) {
  return apiDelete(`/v1/ecosystem-apps/${encodeURIComponent(app)}`);
}

/** Outbound event subscriptions for the owner (optionally filtered to one app). Returns an array. */
export async function listSubscriptions(app) {
  const q = app ? `?app=${encodeURIComponent(app)}` : '';
  const data = await apiGet(`/v1/ecosystem/subscriptions${q}`);
  return data?.data?.subscriptions || [];
}

/** Subscribe a GEAI (by app name) to an outbound event, with an optional glob match. */
export async function subscribe(app, event, match) {
  return apiPost('/v1/ecosystem/subscriptions', { app, event, ...(match ? { match } : {}) });
}

/** Remove a subscription (an app's, optionally just one event). */
export async function unsubscribe(app, event) {
  const q = `?app=${encodeURIComponent(app)}${event ? `&event=${encodeURIComponent(event)}` : ''}`;
  return apiDelete(`/v1/ecosystem/subscriptions${q}`);
}
