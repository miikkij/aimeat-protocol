/**
 * @file admin-agent-integration.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description API service for admin agent integration endpoints.
 * @version-history
 *   v1.3.0 -- 2026-09-12 -- registerPlatform, getSkillBundles, regenerateBundles and
 *     notifyOutdatedAgents removed: no caller. The page builds its bundle rows from the platform
 *     registry, and the three write doors answered success without acting (regenerate, notify) or
 *     wrote to a module array that no detection path reads (registerPlatform).
 *   v1.2.0 -- 2026-05-24 -- Add notifyOutdatedAgents
 *   v1.1.0 -- 2026-05-24 -- Add registerPlatform, sendReminder, skipOnboardingStep
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Governance Phase C
 */

export async function getPlatforms(session) {
  return session.fetch('/v1/admin/platforms');
}

export async function getOnboardingOverview(session) {
  return session.fetch('/v1/admin/agents/onboarding');
}

export async function getReadinessDistribution(session) {
  return session.fetch('/v1/admin/agents/readiness');
}

export async function sendReminder(session, agentGaii) {
  return session.fetch(`/v1/admin/agents/${encodeURIComponent(agentGaii)}/remind`, { method: 'POST' });
}

/** `stepId` is the step's own id, which is what the route looks it up by. Its title is not an id. */
export async function skipOnboardingStep(session, agentGaii, stepId) {
  return session.fetch(`/v1/admin/agents/${encodeURIComponent(agentGaii)}/onboarding/skip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step_id: stepId }),
  });
}
