/**
 * @file state-detector.js
 * @description Determines agent state from onboarding record and agent data.
 *   States: 'new' | 'onboarding' | 'production' | 'problem'
 *   Also provides default tab selection and state color mapping.
 * @version-history
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
  if (webhookDown || noTelemetry) return 'problem';

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
    case 'onboarding': return 'var(--info)';
    case 'problem': return 'var(--danger)';
    case 'production': return 'var(--success)';
    default: return 'var(--text-muted)';
  }
}

export function getStateLabel(state) {
  const map = {
    new: 'agents.detail.state.new',
    onboarding: 'agents.detail.state.onboarding',
    production: 'agents.detail.state.production',
    problem: 'agents.detail.state.problem',
  };
  return map[state] || 'agents.detail.state.production';
}

function isStale(isoDate, thresholdMinutes) {
  const diff = Date.now() - new Date(isoDate).getTime();
  return diff > thresholdMinutes * 60 * 1000;
}
