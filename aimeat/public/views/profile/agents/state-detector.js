/**
 * @file state-detector.js
 * @description Determines agent state from onboarding record and agent data.
 *   States: 'new' | 'onboarding' | 'production' | 'problem'
 *   Also provides default tab selection and state color mapping.
 * @version-history
 *   v1.1.0 -- 2026-05-24 -- Fix: onboarding color to yellow, add readiness drop detection for problem state
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 */

/**
 * Detect agent state from onboarding record and agent data.
 * Checked in priority order: new > onboarding > problem > production.
 */
export function detectAgentState(agent, onboarding) {
  if (!onboarding || onboarding.status === 'pending' || onboarding.status === 'not_started') return 'new';
  if (onboarding.status === 'in_progress') return 'onboarding';

  const webhookDown = (agent.webhookFailCount ?? 0) >= 5;
  const noTelemetry = !agent.last_seen || isStale(agent.last_seen, 24 * 60);
  const readinessDrop = onboarding.previousReadinessLevel && onboarding.readinessLevel
    && readinessRank(onboarding.readinessLevel) < readinessRank(onboarding.previousReadinessLevel);
  if (webhookDown || noTelemetry || readinessDrop) return 'problem';

  return 'production';
}

export function getDefaultTab(state) {
  switch (state) {
    case 'new': return 'integration';
    case 'onboarding': return 'integration';
    case 'problem': return 'integration';
    case 'production': return 'tasks';
    default: return 'tasks';
  }
}

export function getStateColor(state) {
  switch (state) {
    case 'new': return 'var(--warning)';
    case 'onboarding': return 'var(--warning)';
    case 'problem': return 'var(--danger)';
    case 'production': return 'var(--success)';
    default: return 'var(--text-muted)';
  }
}

export function getStateLabel(state) {
  const map = {
    new: 'profile.agents.detail.state.new',
    onboarding: 'profile.agents.detail.state.onboarding',
    production: 'profile.agents.detail.state.production',
    problem: 'profile.agents.detail.state.problem',
  };
  return map[state] || 'profile.agents.detail.state.production';
}

const READINESS_RANKS = { none: 0, basic: 1, standard: 2, advanced: 3, full: 4 };
function readinessRank(level) {
  return READINESS_RANKS[level] ?? 0;
}

function isStale(isoDate, thresholdMinutes) {
  const diff = Date.now() - new Date(isoDate).getTime();
  return diff > thresholdMinutes * 60 * 1000;
}
