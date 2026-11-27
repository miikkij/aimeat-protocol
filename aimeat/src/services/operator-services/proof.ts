/**
 * @file src/services/operator-services/proof.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Is this live agent the one an operator service made? Two GAIIs built from the same
 *   agent name and account are always equal, so the ledger line keeps what only that agent has: its
 *   record's createdAt and its public key's fingerprint, written by the approval that made or
 *   connected it (./ledger.ts AgentProof). A line that says active while the agent is gone, or is a
 *   different agent (the person made their own under the same name), is not the service's: the service
 *   gets nothing for that person, and the sweep and the person's off switch leave that agent alone.
 *
 *   A reservation (`pending`) has no proof for an agent the approval is about to make: there the agent
 *   is the service's when the credential agent that reserved the line registered it (`registeredBy`)
 *   and it was made after the reservation. A reservation of an agent made before keeps that agent's
 *   proof, and its createdAt (which a re-approval does not change) is compared, because the approval
 *   rotates the key.
 *
 *   A key rotation the service did not make (the owner's rekey) changes the fingerprint, so from then on
 *   the agent counts as the person's, not the service's.
 * @structure keyFingerprint · proofOf · isServicesAgent · matchesProof
 * @usage if (isServicesAgent(line, await storage.getAgent(line.gaii))) ...
 * @version-history
 *   v1.1.0 — 2026-11-26 — matchesProof: the proof read whatever the line's state, for the fences (S4).
 *   v1.0.0 — 2026-11-26 — Initial (security review of the operator services, D2).
 */
import { createHash } from 'node:crypto';
import type { AgentRecord } from '../../storage/interface.js';
import type { AgentProof, LedgerLine } from './ledger.js';

/** The first 32 hex characters of the SHA-256 of a public key. */
export function keyFingerprint(publicKey: string): string {
  return createHash('sha256').update(publicKey).digest('hex').slice(0, 32);
}

/** The proof of one agent record. */
export function proofOf(agent: Pick<AgentRecord, 'createdAt' | 'publicKey'>): AgentProof {
  return { created_at: agent.createdAt, key_fp: keyFingerprint(agent.publicKey) };
}

type Agentish = Pick<AgentRecord, 'gaii' | 'createdAt' | 'publicKey' | 'registeredBy'> | null | undefined;

/** True when `agent` is the agent `line` says the service made (or is making). */
export function isServicesAgent(line: LedgerLine | null | undefined, agent: Agentish): boolean {
  if (!line || !agent || agent.gaii !== line.gaii) return false;
  if (line.state === 'active') {
    return !!line.proof && line.proof.created_at === agent.createdAt && line.proof.key_fp === keyFingerprint(agent.publicKey);
  }
  if (line.state === 'pending') {
    if (line.proof) return line.proof.created_at === agent.createdAt;
    return !!line.by && agent.registeredBy === line.by && !!line.reserved_at && agent.createdAt >= line.reserved_at;
  }
  return false;
}

/**
 * True when `agent` is the agent `line` names, WHATEVER the line's state: an `ended` or `removed` line
 * that kept its proof is compared as the agent it named. The fences ask this (./agent-check.ts), so the
 * write fence and the required and key refusals hold until the agent is gone, not until its line moves.
 */
export function matchesProof(line: LedgerLine | null | undefined, agent: Agentish): boolean {
  if (!line) return false;
  return isServicesAgent(line.state === 'ended' || line.state === 'removed' ? { ...line, state: 'active' } : line, agent);
}
