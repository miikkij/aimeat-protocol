/**
 * @file src/services/goals/goals-agents.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's agents as a goal sees them: which may take a work (the goal's participants,
 *   the skills the work wants against the agent's tags, the agents a work excludes), which of them is
 *   free right now, and what an agent has spent on the node's model calls today, so a goal can count
 *   what one work cost. A stopped agent takes nothing.
 * @structure ownerAgents() · mayTake() · isFree() · agentSpendToday() · agentGaiiOf()
 * @usage const candidates = (await ownerAgents(deps, ownerName)).filter(a => mayTake(goal, work, a));
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (session cc-jouni-goals).
 */
import type { AgentRecord } from '../../storage/interface.js';
import { buildGAII, parseGAII } from '../../utils/gaii.js';
import { getTodayUsage } from '../ai-usage-record.js';
import { loadOwnerAgents } from '../db/owner-identity.js';
import { LIVE_TASK_STATUSES } from '../../storage/types/agents-messaging.js';
import { logger } from '../../utils/logger.js';
import type { GoalDeps } from './goals-store.js';
import type { GoalRecord, GoalWork } from './goals-types.js';

export interface GoalAgent { name: string; gaii: string; tags: string[]; mode: string; stopped: boolean }

export function agentGaiiOf(deps: GoalDeps, name: string, ownerName: string): string {
  return buildGAII(name, ownerName, deps.config.nodeId);
}

/** Every agent of one owner, as the goal reads it. */
export async function ownerAgents(deps: GoalDeps, ownerName: string): Promise<GoalAgent[]> {
  const own = await loadOwnerAgents(deps.storage, ownerName);
  return own
    .map((a: AgentRecord) => ({
      name: parseGAII(a.gaii)?.agent ?? a.gaii,
      gaii: a.gaii,
      tags: (a.tags ?? []).map(t => t.toLowerCase()),
      mode: a.mode ?? 'interactive',
      stopped: !!a.stoppedAt,
    }));
}

const norm = (s: string) => s.trim().toLowerCase();

/** May this agent take this work in this goal? */
export function mayTake(goal: GoalRecord, work: GoalWork, agent: GoalAgent): boolean {
  if (agent.stopped || work.kind !== 'agent' || work.runner === 'model') return false;
  if (work.exclude?.includes(agent.name)) return false;
  if (work.agent) return work.agent === agent.name;
  const p = goal.participants;
  const listed = p.agents.includes(agent.name) || p.skills.some(s => agent.tags.includes(norm(s)));
  if (!p.anyAgent && !listed && goal.coordinator !== agent.name) return false;
  const wants = (work.wants ?? []).map(norm);
  return wants.length === 0 || wants.some(w => agent.tags.includes(w));
}

/** True when the agent has no live task: the first free one may take open work nobody took. */
export async function isFree(deps: GoalDeps, gaii: string): Promise<boolean> {
  const { tasks } = await deps.storage.listAgentTasks(gaii, { perPage: 50 });
  return !tasks.some(t => (LIVE_TASK_STATUSES as readonly string[]).includes(t.status) && t.status !== 'draft');
}

/** What the agent has spent today on model calls that went through the node (US dollars). */
export async function agentSpendToday(deps: GoalDeps, ownerGhii: string, agentName: string): Promise<number> {
  try {
    const usage = await getTodayUsage(deps.storage, ownerGhii);
    return usage.per_agent?.[agentName]?.cost_usd ?? 0;
  } catch (err) {
    // A goal still works when the usage record cannot be read; its spend then stays where it was.
    logger.warn('goal: reading the agent spend failed', { agent: agentName, error: String(err) });
    return 0;
  }
}
