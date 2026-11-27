/**
 * @file src/services/operator-services/person-switch.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A person's own switch for one operator service: DELETE /v1/operator-services/{id}/me
 *   turns it off for them, POST turns it back on. Off always wins and is remembered.
 *
 *   THE ORDER. The line becomes `removed` first, in one compare-and-set that answers the line it
 *   replaced, and the decision is taken from that replaced line, never from an earlier read: when it
 *   was `active` or `pending` (an approval that landed between a read and this write, or one still in
 *   progress), the agent the service made is removed through removeAgent(). An approval that completes
 *   after this write finds its reservation gone and rolls itself back
 *   (routes/agents/device-auth-operator-service.ts), so either order ends with no service agent.
 *
 *   ONLY THE SERVICE'S AGENT. The agent is removed only when the replaced line's proof matches it
 *   (./proof.ts); a person's own agent that shares the service's name is never touched.
 *
 *   A REQUIRED SERVICE (`required: true`, read from the present entry) is not the person's to turn
 *   off: 403 OPERATOR_SERVICE_REQUIRED (./required.ts). Turning it on stays open.
 *
 *   The routes take the person in person (requireOwnerPrincipal()); this file trusts that.
 * @structure SwitchDeps · serviceOffForMe · serviceOnForMe
 * @usage const out = await serviceOffForMe(deps, 'alice', 'desk-helper');
 * @version-history
 *   v1.2.0 — 2026-11-26 — A required service refuses the off switch (operator services phase 2).
 *   v1.1.0 — 2026-11-26 — The decision from the replaced line, the proof, and removal for a pending
 *     line too (security review of the operator services, D2, D3).
 *   v1.0.0 — 2026-11-26 — Initial (wish-situatedai-koko-henkil-st-lle-ilman-henkil-kohtaisia-hyv-ksy).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { buildGAII } from '../../utils/gaii.js';
import { emitChange } from '../event-bus.js';
import { removeAgent } from '../agents/remove-agent.js';
import { entryById, isRequired } from './entries.js';
import { requiredRefusalFor } from './required.js';
import { markRemoved, clearRemoved } from './ledger.js';
import { isServicesAgent } from './proof.js';
import { announceOperatorServices } from './events.js';

export interface SwitchDeps {
  storage: Storage;
  config: AimeatConfig;
  /** Closes the agent's open MCP sessions (mcp/session-registry.ts). */
  closeMcpSessions: (gaii: string) => number;
}

const NO_SERVICE = (id: string) => ({ ok: false as const, status: 404, code: 'NOT_FOUND', message: `No operator service ${id} on this node.` });

/** The person `account` turns service `id` off for themselves. */
export async function serviceOffForMe(deps: SwitchDeps, account: string, id: string) {
  const { storage, config } = deps;
  const entry = entryById(config, id);
  if (!entry) return NO_SERVICE(id);
  // A required service is the operator's to turn off (./required.ts), read from the present entry.
  if (entry.enabled && isRequired(entry)) return requiredRefusalFor(entry, 'turning it off');
  const gaii = buildGAII(entry.id, account, config.nodeId);
  // The mark first: from this moment the service is refused this person's agent.
  const { before } = await markRemoved(storage, config.nodeId, entry.id, account, gaii);
  let agentRemoved = false;
  if (before && (before.state === 'active' || before.state === 'pending')) {
    const agent = await storage.getAgent(gaii);
    if (agent && isServicesAgent(before, agent)) {
      const out = await removeAgent({ storage, config, closeMcpSessions: deps.closeMcpSessions },
        { owner: account, principal: account, ownerInPerson: true }, entry.id, { operatorServiceLine: 'leave' });
      if (!out.ok) return { ok: false as const, status: out.status, code: out.code, message: out.message };
      agentRemoved = true;
    }
  }
  emitChange('agents', `${account}@${config.nodeId}`);
  await announceOperatorServices(storage, config);
  return { ok: true as const, data: { service: entry.id, state: 'removed' as const, agent_removed: agentRemoved } };
}

/** The person `account` turns service `id` back on: the service may ask for their agent again. */
export async function serviceOnForMe(deps: Pick<SwitchDeps, 'storage' | 'config'>, account: string, id: string) {
  const { storage, config } = deps;
  const entry = entryById(config, id);
  if (!entry) return NO_SERVICE(id);
  const { changed } = await clearRemoved(storage, config.nodeId, entry.id, account);
  if (changed) await announceOperatorServices(storage, config);
  return { ok: true as const, data: { service: entry.id, state: 'pending' as const, was_off: changed } };
}
