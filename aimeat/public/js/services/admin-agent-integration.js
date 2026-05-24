/**
 * @file admin-agent-integration.js
 * @description API service for admin agent integration endpoints.
 * @version-history
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Governance Phase C
 *   v1.1.0 -- 2026-05-24 -- Add registerPlatform, sendReminder, skipOnboardingStep
 *   v1.2.0 -- 2026-05-24 -- Add notifyOutdatedAgents
 */

export async function getPlatforms(session) {
  return session.fetch('/v1/admin/platforms');
}

export async function registerPlatform(session, platform) {
  return session.fetch('/v1/admin/platforms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(platform),
  });
}

export async function getOnboardingOverview(session) {
  return session.fetch('/v1/admin/agents/onboarding');
}

export async function getReadinessDistribution(session) {
  return session.fetch('/v1/admin/agents/readiness');
}

export async function getSkillBundles(session) {
  return session.fetch('/v1/admin/skill-bundles');
}

export async function regenerateBundles(session) {
  return session.fetch('/v1/admin/skill-bundles/regenerate', { method: 'POST' });
}

export async function sendReminder(session, agentGaii) {
  return session.fetch(`/v1/admin/agents/${encodeURIComponent(agentGaii)}/remind`, { method: 'POST' });
}

export async function skipOnboardingStep(session, agentGaii, stepId) {
  return session.fetch(`/v1/admin/agents/${encodeURIComponent(agentGaii)}/onboarding/skip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step_id: stepId }),
  });
}

export async function notifyOutdatedAgents(session, platform) {
  return session.fetch(`/v1/admin/skill-bundles/${encodeURIComponent(platform)}/notify`, { method: 'POST' });
}
