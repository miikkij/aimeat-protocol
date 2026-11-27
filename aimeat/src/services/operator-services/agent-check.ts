/**
 * @file src/services/operator-services/agent-check.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Is this principal an agent an operator service made? Such an agent is never an
 *   approver: not the same-owner auto-approval of POST /v1/agents/device-authorize, not the operator-
 *   service branch itself, and not an agent adding permissions to a sibling (agent:permissions-add).
 *   Its request for a sibling stays pending for the person. Without this, an entry's words, or a word
 *   the person added to the service's agent, would let the service make sibling agents of the person
 *   that no ledger line names, which the person's off switch, the sweep and the setting never remove.
 *
 *   The answer is the ledger's: the person's line of a service whose id is the agent's name names this
 *   agent and its proof matches the live agent (./proof.ts matchesProof), WHATEVER the line's state
 *   (active, pending, removed, ended, switched off by the operator). So the write fence, the required
 *   refusal and the key refusal hold until the agent is gone, not until its line moves (S4). Every
 *   ledger the node keeps is asked, the ones whose entry left the setting included. No ledger, no read
 *   beyond the index.
 * @structure ServiceLine · serviceLineOf · isOperatorServiceAgent
 * @usage if (await isOperatorServiceAgent(storage, config, req.auth!.sub)) refuse();
 * @version-history
 *   v1.1.0 — 2026-11-26 — Any line state counts while the proof matches (S4); serviceLineOf answers the line.
 *   v1.0.0 — 2026-11-26 — Initial (security review of the operator services, D1b).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, AgentRecord } from '../../storage/interface.js';
import { parseGAII, localAccountOf, ownerGhiiOf } from '../../utils/gaii.js';
import { ledgerIds, readLine, type LedgerLine } from './ledger.js';
import { matchesProof } from './proof.js';

/** The service, the account and the line behind an agent an operator service made. */
export interface ServiceLine { id: string; account: string; line: LedgerLine }

/** The line naming `gaii` as its service's agent, or null. `agent`: the live record when the caller has it. */
export async function serviceLineOf(
  storage: Storage, config: Pick<AimeatConfig, 'nodeId'>, gaii: string, agent?: AgentRecord | null,
): Promise<ServiceLine | null> {
  const parsed = parseGAII(gaii);
  // The account by the one decision that keeps a visitor's home identity from reading as a local name.
  const account = parsed && parsed.node === config.nodeId ? localAccountOf(ownerGhiiOf(gaii)) : null;
  if (!parsed || !account) return null;
  const ids = await ledgerIds(storage, config.nodeId);
  if (!ids.includes(parsed.agent)) return null;
  const line = await readLine(storage, config.nodeId, parsed.agent, account);
  if (!line || line.gaii !== gaii) return null;
  return matchesProof(line, agent === undefined ? await storage.getAgent(gaii) : agent) ? { id: parsed.agent, account, line } : null;
}

/** True when `gaii` is an agent of this node that an operator service made. */
export async function isOperatorServiceAgent(storage: Storage, config: Pick<AimeatConfig, 'nodeId'>, gaii: string): Promise<boolean> {
  return (await serviceLineOf(storage, config, gaii)) !== null;
}
