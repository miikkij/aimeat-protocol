/**
 * @file src/services/operator-services/required-restore.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a person set on a service's agent BEFORE its entry became required, put back as
 *   the approval set it (S10). The fences of ./required.ts stop the person from stopping the agent,
 *   lowering its clearance or capping its budget once the entry is required; a stop, a lowered
 *   clearance or budget limits set before then would otherwise go on binding a service the operator
 *   requires, with no way for the operator to undo them. So each approval of a required entry and the
 *   sweep (./sweep.ts) bring back:
 *     - started: `stoppedAt` cleared (and the live tunnel told);
 *     - clearance: the node's default for a new agent, bounded by the credential agent's own, as
 *       approveDeviceAuth sets it (services/agent/clearance.ts newAgentClearance, clearanceBoundByApprover);
 *     - budget limits: none, as the approval leaves them; the person's purpose, rules, memory areas and
 *       resources stay.
 *   The runtime-source mark (a local model) is fenced from the person instead
 *   (services/agent/profile-write.ts setAgentRuntimeSource), since only the runtime knows the truth of it.
 *
 *   NOT TOUCHED: classification labels, consents and organism rules. They are the data owner's and the
 *   organisation's rules and keep binding a service, required or not, private read or not.
 * @structure restoreRequiredControls
 * @usage await restoreRequiredControls(storage, config, agent, line);
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (operator services phase 2, S10).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, AgentRecord } from '../../storage/interface.js';
import { ownerGhiiOf, isValidGAII } from '../../utils/gaii.js';
import { newAgentClearance, clearanceBoundByApprover } from '../agent/clearance.js';
import { nodeContext } from '../node/context.js';
import { emitChange } from '../event-bus.js';
import { logger } from '../../utils/logger.js';
import type { LedgerLine } from './ledger.js';

/** Put back the start, the clearance and the budget limits of a required service's agent. Answers whether anything changed. Never throws. */
export async function restoreRequiredControls(
  storage: Storage, config: AimeatConfig, agent: AgentRecord, line: Pick<LedgerLine, 'by'>,
): Promise<boolean> {
  try {
    const approver = line.by && isValidGAII(line.by) ? (await storage.getAgent(line.by))?.clearance ?? null : null;
    const clearance = await clearanceBoundByApprover({ storage, config }, ownerGhiiOf(agent.gaii), newAgentClearance(config).clearance ?? null, approver);
    const updates: Partial<AgentRecord> = {};
    if (agent.stoppedAt) Object.assign(updates, { stoppedAt: null, stoppedBy: null });
    if ((agent.clearance ?? null) !== clearance) updates.clearance = clearance as AgentRecord['clearance'];
    let changed = false;
    if (Object.keys(updates).length) {
      await storage.updateAgent(agent.gaii, updates);
      if (agent.stoppedAt) nodeContext().tunnel?.setStopped(agent.gaii, false);
      changed = true;
    }
    const directives = await storage.getAgentDirectives(agent.gaii);
    if (directives?.budgetLimits) {
      await storage.upsertAgentDirectives({
        agentGaii: directives.agentGaii, purpose: directives.purpose, rules: directives.rules,
        memoryAreas: directives.memoryAreas, resources: directives.resources, updatedAt: new Date().toISOString(),
      });
      emitChange('agent-directives');
      changed = true;
    }
    if (changed) {
      emitChange('agents');
      logger.info('operator services: a required agent got back what its approval set', { gaii: agent.gaii });
    }
    return changed;
  } catch (err) {
    logger.warn('operator services: the controls of a required agent were not restored; the next sweep tries again', { gaii: agent.gaii, error: String(err) });
    return false;
  }
}
