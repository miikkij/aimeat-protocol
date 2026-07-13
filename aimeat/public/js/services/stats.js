/**
 * @file public/js/services/stats.js
 * @description Frontend service that fetches node-level statistics from GET /v1/stats
 *   for display in the SPA.
 *
 * @structure
 *   - getNodeStats(): GET /v1/stats → stats object or null
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { apiGet } from '/js/api.js';

/** Load node-level stats. Returns stats object or null. */
export async function getNodeStats() {
  const data = await apiGet('/v1/stats');
  return data?.data || null;
}
