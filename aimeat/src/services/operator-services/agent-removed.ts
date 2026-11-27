/**
 * @file src/services/operator-services/agent-removed.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An agent is being removed the ordinary way (removeAgent(): DELETE /v1/agents/:name and
 *   the aimeat_agent_delete MCP tool). When it is the agent an operator service made for that person
 *   (the line's proof matches the agent, ./proof.ts), the person's line becomes `removed`, as if they
 *   had turned the service off: removing it is their choice, and the service gets no agent for them
 *   again until they turn it back on. A person's own agent that shares a service's name does not match
 *   any line's proof, so nothing is marked for it.
 *
 *   Called BEFORE the agent is deleted, and it does not swallow a failure: when the ledger cannot be
 *   written, the removal fails and the agent stays, so a removal never leaves the ledger saying the
 *   service still holds a name it does not. The sweep, a rolled-back approval and the person's own off
 *   switch remove the agent without this (they write the line themselves).
 * @structure noteAgentRemoved
 * @usage await noteAgentRemoved(storage, config, agentRecord);
 * @version-history
 *   v1.1.0 — 2026-11-26 — The proof decides, every ledger is asked, it runs before the delete and a
 *     ledger failure fails the removal (security review of the operator services, D2).
 *   v1.0.0 — 2026-11-26 — Initial (wish-situatedai-koko-henkil-st-lle-ilman-henkil-kohtaisia-hyv-ksy).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, AgentRecord } from '../../storage/interface.js';
import { ledgerIds, markRemovedIfServices } from './ledger.js';
import { isServicesAgent } from './proof.js';
import { announceOperatorServices } from './events.js';

/** Mark `removed` when the agent about to be removed is an operator service's. Throws when the ledger cannot be written. */
export async function noteAgentRemoved(
  storage: Storage, config: AimeatConfig, agent: Pick<AgentRecord, 'name' | 'owner' | 'gaii' | 'createdAt' | 'publicKey' | 'registeredBy'>,
): Promise<void> {
  if (!(await ledgerIds(storage, config.nodeId)).includes(agent.name)) return;
  const c = await markRemovedIfServices(storage, config.nodeId, agent.name, agent.owner, (line) => isServicesAgent(line, agent));
  if (c.changed) await announceOperatorServices(storage, config);
}
