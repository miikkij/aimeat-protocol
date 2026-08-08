/**
 * @file state-detector.js
 * @description Presentation for an agent's state — the default tab and the colour. It does NOT
 *   decide the state any more: the server does, in src/services/agent-health.ts, and every agent in
 *   /v1/agents carries a `health` object.
 *
 *   It used to decide it here, and could not do so correctly. Two of its three "problem" conditions
 *   read fields the response has never contained — `webhookFailCount` was not projected at all, and
 *   `previousReadinessLevel` is not a field on any record in the system — so a broken push channel
 *   showed as healthy and "problem" silently meant only "not seen in 24 h". Its readiness ladder
 *   named a level the node never produces (`advanced`) and omitted the one it does (`expert`),
 *   which inverted the comparison at the top. None of that was visible from this file.
 *
 *   States: 'system' | 'new' | 'onboarding' | 'problem' | 'idle' | 'production' — unchanged, which
 *   is why every locale key and colour below still applies.
 * @structure agentState(agent) · getDefaultTab(state) · getStateColor(state)
 * @usage
 *   import { agentState, getDefaultTab } from './state-detector.js';
 *   const state = agentState(agent);
 * @version-history
 *   v2.0.0 -- 2026-08-09 -- Renders the server's verdict instead of computing its own (V1). Removed
 *     detectAgentState(), READINESS_RANKS, readinessRank() and isStale(); the three dead conditions
 *     went with them.
 *   v1.3.0 -- 2026-05-24 -- Remove unused getStateLabel() export (audit fix #7)
 *   v1.2.1 -- 2026-05-24 -- Document idle state in design spec, align with audit findings
 *   v1.2.0 -- 2026-05-24 -- Add idle state for inactive production agents
 *   v1.1.0 -- 2026-05-24 -- Fix: onboarding color to yellow, add readiness drop detection for problem state
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 */

/**
 * The agent's state as the server computed it.
 *
 * `health` is always present on /v1/agents. The fallback exists for the one case where it is not —
 * an object assembled locally before a refresh — and says 'new' rather than guessing 'production',
 * because claiming an agent is fine is the failure that matters.
 */
export function agentState(agent) {
  return agent?.health?.state ?? 'new';
}

/** The fleet-board bucket ('issue' | 'onboarding' | 'online' | 'quiet' | 'internal'). */
export function agentBucket(agent) {
  return agent?.health?.bucket ?? 'onboarding';
}

/** Sort key: lower is more urgent. An issue must never drown in a long list. */
export function agentRank(agent) {
  return agent?.health?.rank ?? 1;
}

export function getDefaultTab(state) {
  switch (state) {
    case 'new': return 'integration';
    case 'onboarding': return 'integration';
    case 'problem': return 'integration';
    case 'system': return 'directives'; // internal agents: brain, not onboarding
    case 'idle': return 'tasks';
    case 'production': return 'tasks';
    default: return 'tasks';
  }
}

export function getStateColor(state) {
  switch (state) {
    case 'new': return 'var(--warning)';
    case 'onboarding': return 'var(--warning)';
    case 'problem': return 'var(--danger)';
    case 'system': return 'var(--success)';
    case 'idle': return 'var(--text-muted)';
    case 'production': return 'var(--success)';
    default: return 'var(--text-muted)';
  }
}
