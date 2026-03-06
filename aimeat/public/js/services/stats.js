/**
 * AIMEAT Stats Service
 * Node statistics.
 */
import { apiGet } from '/js/api.js';

/** Load node-level stats. Returns stats object or null. */
export async function getNodeStats() {
  const data = await apiGet('/v1/stats');
  return data?.data || null;
}
