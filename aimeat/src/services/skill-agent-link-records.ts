/**
 * @file src/services/skill-agent-link-records.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The record behind an agent's skill links: `agents.{agentName}.skills`, an
 *   owner-GHII-owned array of link entries (refs, never copies). Read and written here only, so
 *   services/skills.ts (the library's `linkedBy`) and skill-agent-links.ts (link, unlink, resolve)
 *   share it without importing each other. Moved out of services/skills.ts (max-file-lines).
 * @structure AgentSkillLink · getAgentSkillLinks · writeAgentSkillLinks
 * @usage import { getAgentSkillLinks } from './skill-agent-link-records.js';
 * @version-history
 *   v1.0.0 — 2026-10-26 — Extracted from skills.ts (pure extraction; no behaviour change).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';

export interface AgentSkillLink {
  ref: string;
  name: string;
  description: string;
  linkedAt: string;
  linkedBy: string;
}

const agentSkillsKey = (agentName: string): string => `agents.${agentName}.skills`;

export async function getAgentSkillLinks(
  storage: Storage, config: AimeatConfig, ownerName: string, agentName: string,
): Promise<AgentSkillLink[]> {
  const ownerGhii = `${ownerName}@${config.nodeId}`;
  const record = await storage.getMemory(ownerGhii, agentSkillsKey(agentName));
  return Array.isArray(record?.value) ? record.value as AgentSkillLink[] : [];
}

export async function writeAgentSkillLinks(
  storage: Storage, config: AimeatConfig, ownerName: string, agentName: string, links: AgentSkillLink[],
): Promise<void> {
  const ownerGhii = `${ownerName}@${config.nodeId}`;
  const key = agentSkillsKey(agentName);
  const existing = await storage.getMemory(ownerGhii, key);
  const now = new Date().toISOString();
  await storage.setMemory({
    key,
    ownerGaii: ownerGhii,
    value: links,
    visibility: existing?.visibility ?? 'owner',
    tags: existing?.tags ?? ['skill-links'],
    ttlHours: null,
    version: (existing?.version ?? 0) + 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}
