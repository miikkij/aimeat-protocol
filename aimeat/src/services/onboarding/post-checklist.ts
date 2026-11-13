/**
 * @file src/services/onboarding/post-checklist.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The post-onboarding checklist GET /v1/agents/:name/onboarding returns, and the agent
 *   integration overview reads: whether the agent registered its commands, published its config, uses
 *   its shared tags and published a knowledge package.
 * @structure buildPostOnboardingChecklist(agentGaii, agentName, storage)
 * @usage const checklist = await buildPostOnboardingChecklist(agentGaii, agentName, storage);
 * @version-history
 *   v1.0.0 — 2026-11-13 — Moved unchanged from routes/agent-onboarding.ts (its v1.2.0 of 2026-05-28
 *     holds the history), so the agent integration overview service no longer imports a route file
 *     (structure programme 2026-11, unit 4).
 */
import type { Storage } from '../../storage/interface.js';

/**
 * Build the post-onboarding checklist surfaced via GET /onboarding. Mirrors the
 * SKILL.md "After Onboarding" items as a machine-readable signal:
 *   - commands_registered: agents.{name}.commands memory exists with non-empty array
 *   - config_published:    any agents.config.{name}.* memory entry exists
 *   - shared_tags_in_use:  null if owner has assigned no shared tag areas (n/a);
 *                          otherwise true if at least one agents.tag.{tag}.* entry exists
 *   - knowledge_packages_published: count of packages authored by this agent (>0 = true)
 */
export async function buildPostOnboardingChecklist(
  agentGaii: string,
  agentName: string,
  storage: Storage,
): Promise<{
  commands_registered: boolean;
  config_published: boolean;
  shared_tags_in_use: boolean | null;
  knowledge_packages_published: boolean;
}> {
  const commandsRecord = await storage.getMemory(agentGaii, `agents.${agentName}.commands`);
  const commands_registered = !!commandsRecord
    && Array.isArray(commandsRecord.value)
    && commandsRecord.value.length > 0;

  const configRecords = await storage.listMemory(agentGaii, { prefix: `agents.config.${agentName}.` });
  const config_published = configRecords.length > 0;

  // Shared tags: only applicable when owner has assigned shared memory areas with tags.
  const directives = await storage.getAgentDirectives(agentGaii);
  const assignedTags = (directives?.memoryAreas ?? [])
    .flatMap(a => Array.isArray((a as { tags?: unknown }).tags) ? (a as { tags?: string[] }).tags! : [])
    .filter(Boolean);
  let shared_tags_in_use: boolean | null = null;
  if (assignedTags.length > 0) {
    const tagRecords = await storage.listMemory(agentGaii, { prefix: 'agents.tag.' });
    shared_tags_in_use = tagRecords.length > 0;
  }

  // Knowledge packages authored by this agent.
  const pkg = await storage.listPackages({ author: agentGaii, limit: 1 });
  const knowledge_packages_published = pkg.total > 0;

  return { commands_registered, config_published, shared_tags_in_use, knowledge_packages_published };
}
