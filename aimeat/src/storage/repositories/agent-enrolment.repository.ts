/**
 * @file src/storage/repositories/agent-enrolment.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage contract for Agent v2 enrolment grants — the short-lived, single-use
 *   permission an owner's button press creates so their already-connected daemon may enrol exactly
 *   the agents that press produced, and nothing else.
 *
 *   `consumeAgentEnrolmentGrant` is a CONDITIONAL update, not a read-then-write: it must set
 *   `usedAt` only where `usedAt` is still null and answer whether it did. Two daemons racing on one
 *   grant is the case it exists for, and a read followed by a write would let both through.
 *
 * @structure AgentEnrolmentRepository: create / get / consume / cleanupExpired / deleteByOwner
 * @usage const grant = await storage.getAgentEnrolmentGrant(id);
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial, with the basic-agents button.
 */
import type { AgentEnrolmentGrantRecord } from '../interface.js';

export interface AgentEnrolmentRepository {
  createAgentEnrolmentGrant(grant: AgentEnrolmentGrantRecord): Promise<void>;
  getAgentEnrolmentGrant(id: string): Promise<AgentEnrolmentGrantRecord | null>;
  /**
   * Spend the grant. Returns true only if THIS call is the one that spent it: the update is
   * conditional on `usedAt` still being null, so a concurrent second submit gets false rather than a
   * second set of credentials.
   */
  consumeAgentEnrolmentGrant(id: string, usedBy: string, usedAt: string): Promise<boolean>;
  /** Remove grants past their expiry. Returns how many rows went. */
  cleanupExpiredAgentEnrolmentGrants(): Promise<number>;
  /** Account erasure: drop every grant belonging to this owner. */
  deleteAgentEnrolmentGrantsByOwner(owner: string): Promise<number>;
}
