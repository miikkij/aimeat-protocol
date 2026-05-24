/**
 * @file admin-agent-integration.js
 * @description API service for admin agent integration endpoints.
 * @version-history
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

export async function getSkillBundles(session) {
  return session.fetch('/v1/admin/skill-bundles');
}

export async function regenerateBundles(session) {
  return session.fetch('/v1/admin/skill-bundles/regenerate', { method: 'POST' });
}
