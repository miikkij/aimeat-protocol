/**
 * @file public/js/services/federation.js
 * @description Frontend service wrapper for the federation directory API; fetches the
 *   list of federated peer nodes for display in the SPA.
 *
 * @structure
 *   - listPeers(): GET /v1/federation/directory, returns the peers array (or [])
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { apiGet } from '/js/api.js';

/** List federated peers. Returns array. */
export async function listPeers() {
  const data = await apiGet('/v1/federation/directory');
  return data?.data?.peers || [];
}
