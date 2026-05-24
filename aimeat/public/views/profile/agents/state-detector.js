/**
 * @file state-detector.js
 * @description Determines agent state from onboarding record and agent data.
 *   States: 'new' | 'onboarding' | 'problem' | 'idle' | 'production'
 *   Also provides default tab selection and state color mapping.
 * @version-history
 *   v1.3.0 -- 2026-05-24 -- Remove unused getStateLabel() export (audit fix #7)
 *   v1.2.1 -- 2026-05-24 -- Document idle state in design spec, align with audit findings
 *   v1.2.0 -- 2026-05-24 -- Add idle state for inactive production agents
 *   v1.1.0 -- 2026-05-24 -- Fix: onboarding color to yellow, add readiness drop detection for problem state
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 */

/**
 * Detect agent state from onboarding record and agent data.
 * Checked in priority order: new > onboarding > problem > idle > production.
 */
export function detectAgentState(agent, onboarding) {
  if (!onboarding || onboarding.status === 'pending' || onboarding.status === 'not_started') return 'new';
  if (onboarding.status === 'in_progress') return 'onboarding';

  const webhookDown = (agent.webhookFailCount ?? 0) >= 5;
  const noTelemetry = !agent.last_seen || isStale(agent.last_seen, 24 * 60);
  const readinessDrop = onboarding.previousReadinessLevel && onboarding.readinessLevel
    && readinessRank(onboarding.readinessLevel) < readinessRank(onboarding.previousReadinessLevel);
  if (webhookDown || noTelemetry || readinessDrop) return 'problem';

  if (!agent.last_seen || isStale(agent.last_seen, 60)) return 'idle';
  return 'production';
}

export function getDefaultTab(state) {
  switch (state) {
    case 'new': return 'integration';
    case 'onboarding': return 'integration';
    case 'problem': return 'integration';
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
    case 'idle': return 'var(--text-muted)';
    case 'production': return 'var(--success)';
    default: return 'var(--text-muted)';
  }
}

const READINESS_RANKS = { none: 0, basic: 1, standard: 2, advanced: 3, full: 4 };
function readinessRank(level) {
  return READINESS_RANKS[level] ?? 0;
}

function isStale(isoDate, thresholdMinutes) {
  const diff = Date.now() - new Date(isoDate).getTime();
  return diff > thresholdMinutes * 60 * 1000;
}
