/**
 * @file src/services/delivery-crew.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description When an agent_task schedule says `deliver: "owner"` (services/schedule-write.ts, on create
 *   and on edit), the node hands each result to the owner itself (services/task-result-delivery.ts), so
 *   the target agent's own notify tool goes out of its live crew definition. With it, a model that calls
 *   notify either sends the result twice or, without notifications:send, has the call refused, and the
 *   runtime then fails the whole run, so the node's delivery, which comes on completion, never comes
 *   (crew64 on guestkoey3wfwk, 2.11: a morning digest made before the template dropped notify).
 *   Published as a new revision by the owner, so the Crew tab shows the change and can restore it.
 *   A module of its own: the crew store reaches the scheduler through memory-write, so the scheduler
 *   cannot import it.
 * @structure dropNotifyOfAgent(deps, agentGaii, ownerGhii) · dropNotifyForDelivery(deps, agent, ownerGhii)
 * @usage await dropNotifyForDelivery({ storage, config }, agent, ownerGhii);
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial.
 */
import type { Storage, AgentRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { readCrewState, publishCrewDef } from './crew-def-store.js';
import { logger } from '../utils/logger.js';

/** dropNotifyForDelivery for the agent a schedule targets, by its GAII; nothing when it is gone. */
export async function dropNotifyOfAgent(deps: { storage: Storage; config: AimeatConfig }, agentGaii: string | undefined, ownerGhii: string): Promise<boolean> {
  if (!agentGaii) return false;
  const agent = await deps.storage.getAgent(agentGaii).catch((err: Error) => {
    logger.warn(`[delivery] the schedule's agent ${agentGaii} could not be read: ${err.message}`);
    return null;
  });
  return agent ? dropNotifyForDelivery(deps, agent, ownerGhii) : false;
}

/** Take notify out of the agent's live definition. Answers whether it changed anything; never throws. */
export async function dropNotifyForDelivery(deps: { storage: Storage; config: AimeatConfig }, agent: AgentRecord, ownerGhii: string): Promise<boolean> {
  try {
    const state = await readCrewState(deps.storage, agent);
    const doc = state.published?.doc;
    const members = Array.isArray(doc?.agents) ? doc.agents as Array<Record<string, unknown>> : [];
    const hasNotify = (m: Record<string, unknown>) => Array.isArray(m?.tools) && (m.tools as unknown[]).includes('notify');
    if (!doc || !members.some(hasNotify)) return false;
    const next = { ...doc, agents: members.map((m) => (hasNotify(m) ? { ...m, tools: (m.tools as unknown[]).filter((t) => t !== 'notify') } : m)) };
    const out = await publishCrewDef(deps, { principal: ownerGhii, scopes: ['*'], roles: ['owner'], pipeline: 'schedule-deliver' }, agent, next);
    if (!out.ok) {
      logger.warn(`[delivery] notify could not be taken out of ${agent.name}'s definition: ${out.code}: ${out.message}`);
      return false;
    }
    logger.info(`[delivery] took notify out of ${agent.name}'s definition (revision ${out.revision}): the node delivers its results`);
    return true;
  } catch (err) {
    logger.warn(`[delivery] notify could not be taken out of ${agent.name}'s definition: ${(err as Error).message}`);
    return false;
  }
}
