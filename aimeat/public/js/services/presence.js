/**
 * @file presence.js
 * @description AIMEAT Presence Service — thin API layer over /v1/presence/*. Read
 *   your own config + status, update it, and read viewer-scoped status for one or
 *   many identities. List/dot rendering should go through /js/presence-store.js
 *   (cache + batch coalescing) rather than calling getPresence per row.
 * @structure getMyPresence / setMyPresence / getPresence / getPresenceBatch
 * @usage import { getPresenceBatch } from '/js/services/presence.js';
 * @version-history
 *   v1.0.0 — 2026-06-19 — Initial presence service.
 */
import { apiGet, apiPut } from '/js/api.js';

/** Read the caller's own presence config + computed status. Returns the envelope. */
export async function getMyPresence() {
  return apiGet('/v1/presence/me');
}

/** Update the caller's presence config (partial: { mode, status, visibility }). */
export async function setMyPresence(config) {
  return apiPut('/v1/presence/me', config);
}

/** Viewer-scoped status of a single identity. Returns the envelope ({ data: { ghii, status, since } }). */
export async function getPresence(ghii) {
  return apiGet(`/v1/presence/${encodeURIComponent(ghii)}`);
}

/** Batch viewer-scoped status. Returns a map of ghii → { status, since }. */
export async function getPresenceBatch(ghiis) {
  const ids = (ghiis || []).map(encodeURIComponent).join(',');
  if (!ids) return {};
  const r = await apiGet(`/v1/presence?ids=${ids}`);
  return r?.data?.presence || {};
}
