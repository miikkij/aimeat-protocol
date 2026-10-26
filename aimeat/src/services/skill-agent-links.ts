/**
 * @file src/services/skill-agent-links.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agent attachment for the skills registry: linking a skill ref to an agent (validated
 *   through resolveSkillRef), unlinking it, and resolving every link an agent holds, which is the read
 *   crewaimeat's run_crew consumes. The link record itself is skill-agent-link-records.ts. Moved out of
 *   services/skills.ts (max-file-lines).
 * @structure AgentSkillLink · getAgentSkillLinks (re-exported) · linkSkillToAgent ·
 *   unlinkSkillFromAgent · resolveAgentSkills
 * @usage import { getAgentSkillLinks, linkSkillToAgent } from '../services/skill-agent-links.js';
 * @version-history
 *   v1.0.0 — 2026-10-26 — Extracted from skills.ts (pure extraction; no behaviour change).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { recordAccountEvent } from './account-events.js';
import { resolveSkillRef } from './skills.js';
import type { ResolvedSkill, SkillAccessor } from './skill-types.js';
import { getAgentSkillLinks, writeAgentSkillLinks, type AgentSkillLink } from './skill-agent-link-records.js';

export { getAgentSkillLinks, type AgentSkillLink } from './skill-agent-link-records.js';

// ── Agent attachment (links are refs, never copies) ──

/**
 * Link a skill to an agent: validates the ref resolves for this owner, then appends to the
 * owner-GHII-owned `agents.{name}.skills` record (idempotent per ref).
 */
export async function linkSkillToAgent(
  storage: Storage, config: AimeatConfig,
  ownerName: string, agentName: string, refStr: string, linkedBy: string,
  accessor?: SkillAccessor,
): Promise<AgentSkillLink[]> {
  const resolved = await resolveSkillRef(storage, config, refStr, accessor ?? { ownerName }, { manifestOnly: true });
  const links = await getAgentSkillLinks(storage, config, ownerName, agentName);
  if (!links.some(l => l.ref === resolved.ref)) {
    links.push({
      ref: resolved.ref,
      name: resolved.name,
      description: resolved.description,
      linkedAt: new Date().toISOString(),
      linkedBy,
    });
    await writeAgentSkillLinks(storage, config, ownerName, agentName, links);
    // Inside the `if`, so re-linking a skill an agent already has says nothing. The event is the
    // agent gaining a capability it did not have, not the request having been made.
    void recordAccountEvent(storage, {
      ownerGhii: `${ownerName}@${config.nodeId}`,
      kind: 'skill_installed',
      actorGaii: linkedBy,
      subject: resolved.ref,
      link: '/v1/profile?tab=skills',
      data: { name: resolved.name || resolved.ref, agent: agentName },
    }, config);
  }
  return links;
}

export async function unlinkSkillFromAgent(
  storage: Storage, config: AimeatConfig, ownerName: string, agentName: string, refStr: string,
): Promise<AgentSkillLink[]> {
  const links = await getAgentSkillLinks(storage, config, ownerName, agentName);
  const next = links.filter(l => l.ref !== refStr);
  if (next.length !== links.length) {
    await writeAgentSkillLinks(storage, config, ownerName, agentName, next);
  }
  return next;
}

/**
 * Resolve everything linked to an agent — the read crewaimeat's run_crew consumes. Unresolvable
 * links (deleted skill, revoked visibility) are reported, never silently dropped.
 */
export async function resolveAgentSkills(
  storage: Storage, config: AimeatConfig, ownerName: string, agentName: string,
  opts: { manifestOnly?: boolean; accessor?: SkillAccessor } = {},
): Promise<{ skills: ResolvedSkill[]; unresolved: Array<{ ref: string; error: string }> }> {
  const links = await getAgentSkillLinks(storage, config, ownerName, agentName);
  const skills: ResolvedSkill[] = [];
  const unresolved: Array<{ ref: string; error: string }> = [];
  for (const link of links) {
    try {
      skills.push(await resolveSkillRef(storage, config, link.ref, opts.accessor ?? { ownerName }, opts));
    } catch (err) {
      unresolved.push({ ref: link.ref, error: (err as Error).message });
    }
  }
  return { skills, unresolved };
}
