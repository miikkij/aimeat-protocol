/**
 * @file ecosystem.js
 * @description AIMEAT Ecosystem Apps (GEAI) service — the owner-facing API layer for the profile
 *   "Ecosystem apps" tab. Wraps the /v1/ecosystem-apps + /v1/ecosystem endpoints (the GEAI
 *   onboarding handshake, the connected-app list, outbound event subscriptions, and revoke).
 * @structure listEcosystemApps · listAppData · listPending · approve · revoke · listSubscriptions · subscribe · unsubscribe · getAutomationRecipe · putAutomationRecipe · deleteAutomationRecipe · listPendingAdvisories · approveAdvisory · rejectAdvisory
 * @usage import { listEcosystemApps, approve } from '/js/services/ecosystem.js';
 * @version-history
 *   v1.0.0 — 2026-06-14 — Created for the Ecosystem apps profile tab (chunk 6).
 *   v1.1.0 — 2026-06-15 — Add listAppData() — the memory an app wrote (GET /v1/ecosystem-apps/:app/data).
 *   v1.2.0 — 2026-06-15 — Add the per-(owner,app) automation RECIPE (B4): getAutomationRecipe / putAutomationRecipe /
 *     deleteAutomationRecipe wrap GET/PUT/DELETE /v1/ecosystem-apps/:app/automation/recipe.
 *   v1.3.0 — 2026-06-15 — Add the advisory approval surface (B7/B8): listPendingAdvisories (GET .../advisories/pending),
 *     approveAdvisory (POST .../advisories/:id/approve — returns the envelope incl. `delivery`, even the 202
 *     offline-retry which arrives as ok:true so it does NOT throw), rejectAdvisory (POST .../advisories/:id/reject).
 *   v1.4.0 — 2026-06-16 — revoke() is now a HARD DELETE: the server removes the binding entirely (card
 *     disappears — no 'revoked' ghost) and cleans up the app's automation config; deposited data is kept.
 */
import { apiGet, apiPost, apiPut, apiDelete } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

/** The owner's connected GEAIs. Returns an array. */
export async function listEcosystemApps() {
  const data = await apiGet('/v1/ecosystem-apps');
  return data?.data?.ecosystem_apps || [];
}

/** The memory entries a connected app wrote into its own eco: namespace. Returns an array. */
export async function listAppData(app, opts = {}) {
  const params = new URLSearchParams();
  if (opts.prefix) params.set('prefix', opts.prefix);
  if (opts.visibility) params.set('visibility', opts.visibility);
  const q = params.toString() ? `?${params.toString()}` : '';
  const data = await apiGet(`/v1/ecosystem-apps/${encodeURIComponent(app)}/data${q}`);
  return data?.data?.items || [];
}

/** Pending "hello integration" requests awaiting the owner's approval. Returns an array. */
export async function listPending() {
  const data = await apiGet('/v1/ecosystem-apps/pending');
  return data?.data?.requests || [];
}

/** Approve or deny a pending request by its user code, selecting scopes (and optional data areas). */
export async function approve(userCode, { action, scopes, data_areas } = /** @type {{ action?: string, scopes?: any, data_areas?: any }} */ ({})) {
  return apiPost(`/v1/ecosystem-apps/${encodeURIComponent(userCode)}/approve`, { action, scopes, data_areas });
}

/**
 * Disconnect (HARD-DELETE) a connected GEAI by its app name. The server emits binding.revoked, then
 * removes the principal row entirely (the card disappears — no 'revoked' ghost) and cleans up the
 * app's automation recipe / eco-capability schedules / pending advisories. The owner's deposited
 * data is preserved. Reconnecting later starts over from scratch. Returns { deleted, app, geai }.
 */
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

// ── Automation recipe (B4): the per-(owner,app) "when this app publishes data" recipe ──

/** The owner's automation recipe for one app, or null if none is configured yet. */
export async function getAutomationRecipe(app) {
  const data = await apiGet(`/v1/ecosystem-apps/${encodeURIComponent(app)}/automation/recipe`);
  return data?.data?.recipe ?? null;
}

/**
 * Composite mount for the automation card: this app's schedules + recipe + organisms + pending advisories
 * in ONE call. Returns { schedules, recipe, organisms, advisories } or null on error so the caller can fall
 * back to the individual reads. The agent list stays a separate GET /v1/agents.
 */
export async function getAutomationOverview(app) {
  try {
    const data = await apiGet(`/v1/ecosystem-apps/${encodeURIComponent(app)}/automation`);
    const d = data?.data;
    if (!d) return null;
    return { schedules: d.schedules || [], recipe: d.recipe ?? null, organisms: d.organisms || [], advisories: d.advisories || [] };
  } catch (err) { swallowed('ecosystem: getAutomationOverview', err); return null; }
}

/** Upsert the automation recipe for an app. body: { agents, organism?, email?, requireApproval?, enabled, trigger? }. */
export async function putAutomationRecipe(app, body) {
  return apiPut(`/v1/ecosystem-apps/${encodeURIComponent(app)}/automation/recipe`, body);
}

/** Delete the automation recipe for an app. */
export async function deleteAutomationRecipe(app) {
  return apiDelete(`/v1/ecosystem-apps/${encodeURIComponent(app)}/automation/recipe`);
}

// ── Advisory approval gate (B7) + delivery (B8) ──
// When a recipe gates delivery (requireApproval:true), each agent-produced `support-advisory@1`
// payload is parked awaiting the owner's approve/reject decision. These three methods are the
// owner's surface to that pending list.

/** The advisories awaiting this owner's approval for one app. Returns an array (default []). */
export async function listPendingAdvisories(app) {
  const data = await apiGet(`/v1/ecosystem-apps/${encodeURIComponent(app)}/advisories/pending`);
  return data?.data?.pending || [];
}

/**
 * Approve a pending advisory → the server invokes the app's deliver-advisory capability over the
 * tunnel. Returns the parsed envelope's `data`. On success: { status:'approved', delivery:'delivered',
 * delivered_id }. If the app is offline the server replies 202 with ok:true (so this does NOT throw):
 * { status:'pending', delivery:'offline-retry'|'failed', reason } — the item STAYS pending for retry.
 */
export async function approveAdvisory(app, id) {
  const resp = await apiPost(`/v1/ecosystem-apps/${encodeURIComponent(app)}/advisories/${encodeURIComponent(id)}/approve`, {});
  return resp?.data || {};
}

/** Reject a pending advisory → it is dropped, no delivery. Returns the parsed envelope's `data`. */
export async function rejectAdvisory(app, id) {
  const resp = await apiPost(`/v1/ecosystem-apps/${encodeURIComponent(app)}/advisories/${encodeURIComponent(id)}/reject`, {});
  return resp?.data || {};
}
