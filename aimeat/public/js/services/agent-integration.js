/**
 * @file agent-integration.js
 * @description API service for agent integration endpoints: onboarding, webhook,
 *   telemetry, skill bundle, and delivery log.
 * @version-history
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 *   v1.1.0 -- 2026-05-24 -- Add updateSkillBundle function
 */

import { apiGet, apiPost, apiPut, apiDelete } from '/js/api.js';

export async function getOnboarding(agentName) {
  return apiGet(`/v1/agents/${encodeURIComponent(agentName)}/onboarding`);
}

export async function startOnboarding(agentName) {
  return apiPost(`/v1/agents/${encodeURIComponent(agentName)}/onboarding/start`);
}

export async function confirmOnboardingStep(agentName, stepId, payload) {
  return apiPost(`/v1/agents/${encodeURIComponent(agentName)}/onboarding/step/${encodeURIComponent(stepId)}`, payload);
}

export async function cancelOnboarding(agentName) {
  return apiDelete(`/v1/agents/${encodeURIComponent(agentName)}/onboarding`);
}

export async function getWebhookConfig(agentName) {
  return apiGet(`/v1/agents/${encodeURIComponent(agentName)}/webhook`);
}

export async function updateWebhook(agentName, config) {
  return apiPut(`/v1/agents/${encodeURIComponent(agentName)}/webhook`, config);
}

export async function deleteWebhook(agentName) {
  return apiDelete(`/v1/agents/${encodeURIComponent(agentName)}/webhook`);
}

export async function testWebhook(agentName) {
  return apiPost(`/v1/agents/${encodeURIComponent(agentName)}/webhook/test`);
}

export async function getTelemetry(agentName, opts = {}) {
  const params = new URLSearchParams();
  if (opts.since) params.set('since', opts.since);
  if (opts.type) params.set('type', opts.type);
  if (opts.limit) params.set('per_page', String(opts.limit));
  const qs = params.toString();
  return apiGet(`/v1/agents/${encodeURIComponent(agentName)}/telemetry${qs ? `?${qs}` : ''}`);
}

export async function getSkillBundleVersion(agentName, runtime) {
  const qs = runtime ? `?runtime=${encodeURIComponent(runtime)}` : '';
  return apiGet(`/v1/agents/${encodeURIComponent(agentName)}/skill-bundle/version${qs}`);
}

export function getSkillBundleUrl(agentName, runtime) {
  const qs = runtime ? `?runtime=${encodeURIComponent(runtime)}` : '';
  return `/v1/agents/${encodeURIComponent(agentName)}/skill-bundle${qs}`;
}

export async function updateSkillBundle(agentName) {
  return apiPost(`/v1/agents/${encodeURIComponent(agentName)}/skill-bundle/update`);
}

export async function getDeliveryLog(agentName, limit = 20) {
  return apiGet(`/v1/agents/${encodeURIComponent(agentName)}/webhook/log?limit=${limit}`);
}

export async function getAgentCommands(agentName, agentGaii) {
  if (agentGaii) {
    const resp = await apiGet(`/v1/memory?agent=${encodeURIComponent(agentGaii)}&prefix=agents.${encodeURIComponent(agentName)}.commands`);
    const items = resp?.data?.items || resp?.data || [];
    const cmdItem = Array.isArray(items) ? items.find(i => i.key === `agents.${agentName}.commands`) : null;
    if (cmdItem) return { ok: true, data: { key: cmdItem.key, value: cmdItem.value } };
    return { ok: true, data: { value: [] } };
  }
  return apiGet(`/v1/memory/agents.${encodeURIComponent(agentName)}.commands`);
}
