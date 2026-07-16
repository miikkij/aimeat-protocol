/**
 * @file ledger.js
 * @description Owner-scoped reads of the agent LLM usage ledger (LEDGER / TARGET-016):
 *   priced per-call usage aggregated by a chosen dimension, plus per-run drill-down. Backs
 *   the agent detail "Usage" tab. Read-only; every call is gated server-side to the owner.
 * @structure
 *   - getLedgerUsage(agentName, opts)  -> GET /v1/ledger/usage  (grouped aggregates + totals)
 *   - getLedgerRuns(agentName, opts)   -> GET /v1/ledger/usage/runs  (per run_id)
 *   - getLedgerUsageOverview(agentName) -> GET /v1/ledger/usage/overview (Usage tab mount: model groups + totals + runs)
 * @usage
 *   import { getLedgerUsage, getLedgerRuns } from '/js/services/ledger.js';
 * @version-history
 *   v1.0.0 -- 2026-07-11 -- Initial: back the agent Usage tab (first consumer of the ledger).
 *   v1.1.0 -- 2026-07-16 -- Add getLedgerUsageOverview folding the Usage tab's two mount reads into one.
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

/**
 * Composite mount for the Usage tab: model-grouped aggregates + grand totals + per-run rollups in ONE
 * call (folds getLedgerUsage({groupBy:'model'}) + getLedgerRuns). Returns null on error so the caller can
 * fall back to the individual two-request fan-out.
 * @param {string} [agentName]
 */
export async function getLedgerUsageOverview(agentName, { runsLimit = 50 } = {}) {
  const p = new URLSearchParams();
  if (agentName) p.set('agent', agentName);
  if (runsLimit) p.set('runs_limit', String(runsLimit));
  try {
    const resp = await apiGet(`/v1/ledger/usage/overview?${p.toString()}`);
    return resp?.data ?? null;
  } catch { return null; }
}
