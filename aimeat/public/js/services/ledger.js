/**
 * @file ledger.js
 * @description Owner-scoped reads of the agent LLM usage ledger (LEDGER / TARGET-016):
 *   priced per-call usage aggregated by a chosen dimension, plus per-run drill-down. Backs
 *   the agent detail "Usage" tab. Read-only; every call is gated server-side to the owner.
 * @structure
 *   - getLedgerUsage(agentName, opts)  -> GET /v1/ledger/usage  (grouped aggregates + totals)
 *   - getLedgerRuns(agentName, opts)   -> GET /v1/ledger/usage/runs  (per run_id)
 * @usage
 *   import { getLedgerUsage, getLedgerRuns } from '/js/services/ledger.js';
 * @version-history
 *   v1.0.0 -- 2026-07-11 -- Initial: back the agent Usage tab (first consumer of the ledger).
 */
import { apiGet } from '/js/api.js';

/**
 * Daily usage aggregates for one agent (or all of the owner's agents when agentName is falsy),
 * grouped by `groupBy` (day|agent|model|provider|organism|workspace|scope). Defaults to the
 * node's own 30-day window. Returns the response envelope: data = { groups, totals, ... }.
 * @param {string} [agentName]
 * @param {{ groupBy?: string, from?: string, to?: string }} [opts]
 */
export async function getLedgerUsage(agentName, { groupBy = 'model', from, to } = {}) {
  const p = new URLSearchParams();
  if (agentName) p.set('agent', agentName);
  if (groupBy) p.set('group_by', groupBy);
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  return apiGet(`/v1/ledger/usage?${p.toString()}`);
}

/**
 * Per-run drill-down (newest first). Returns the envelope: data = { count, runs }.
 * @param {string} [agentName]
 * @param {{ limit?: number, runId?: string }} [opts]
 */
export async function getLedgerRuns(agentName, { limit = 50, runId } = {}) {
  const p = new URLSearchParams();
  if (agentName) p.set('agent', agentName);
  if (runId) p.set('run_id', runId);
  if (limit) p.set('limit', String(limit));
  return apiGet(`/v1/ledger/usage/runs?${p.toString()}`);
}
