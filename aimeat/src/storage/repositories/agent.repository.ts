/**
 * @file src/storage/repositories/agent.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage-backend-agnostic interface for agent (GAII) persistence: CRUD/lookup by
 *   gaii or owner, plus atomic morsel-balance operations (debit/credit/capped-credit).
 *   Each backend (SQLite, PostgreSQL) implements this contract.
 *
 * @structure
 *   - AgentRepository: create/get/getByOwner/getByOwners/update/delete/list agents
 *   - balance ops: debitBalance, creditBalance, creditBalanceCapped (atomic)
 *
 * @version-history
 *   v1.3.0 — 2026-10-20 — clearGrantsToIdentity: the references where ANOTHER party named this GAII
 *     as the grantee. deleteAgent runs it inside its own transaction, and owner erasure runs it per
 *     agent (secaudit 2026-10, agent-delete:gaii-keyed-grants-outlive-agent).
 *   v1.2.0 — 2026-10-18 — setAgentScopesIf: the scope list written on the list that was read (check:atomic-writes, boot migrations).
 *   v1.1.0 — 2026-09-09 — getAgentByName and transferBalance deleted: no caller.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { AgentRecord, GrantsToIdentityCleared } from '../interface.js';

export interface AgentRepository {
  createAgent(agent: AgentRecord): Promise<AgentRecord>;
  getAgent(gaii: string): Promise<AgentRecord | null>;
  getAgentsByOwner(owner: string): Promise<AgentRecord[]>;
  /** Agents for MANY owners in ONE `owner IN (…)` query, grouped by owner name (every requested owner is
   *  a key, empty array if none). Batches the members-roster fan-out (getAgentsByOwner per member). */
  getAgentsByOwners(owners: string[]): Promise<Record<string, AgentRecord[]>>;
  updateAgent(gaii: string, updates: Partial<AgentRecord>): Promise<AgentRecord | null>;
  /**
   * Write `next` as the agent's scope list only if the stored list still equals `expected`, the list
   * the caller read (an empty `expected` also matches no list). False when another writer changed it
   * meanwhile, so the caller reads again and merges. The agent row has no version column, so the
   * condition is the value itself (services/scope-list-swap.ts).
   */
  setAgentScopesIf?(gaii: string, expected: readonly string[], next: string[]): Promise<boolean>;
  deleteAgent(gaii: string): Promise<boolean>;
  /**
   * Clear every reference in which ANOTHER party named this GAII as the one it grants to: a consent
   * whose `recipient` is this exact GAII (revoked, so the grantor keeps the record), the organisms
   * that list it in `agentGaiis`, the boards that list it in `allowedGaiis`, the sharing groups that
   * hold it as a member, and `registeredBy` on the agents it registered.
   *
   * The per-identity cascade deletes what the identity OWNS. This is the other direction, and it has
   * to be cleared for the same reason: a GAII is `name#owner@node`, rebuilt from the name, and the
   * registration check only asks whether the name is taken right now — so the next agent registered
   * under that name walked into every grant the deleted one held (secaudit 2026-10,
   * agent-delete:gaii-keyed-grants-outlive-agent).
   *
   * Matches on the EXACT GAII only. A pattern grant (`*`, `ghii:…`, `node:…`) names a class and not
   * this agent, so it is the grantor's standing decision and stays.
   *
   * `deleteAgent` already runs this inside its own transaction. Call it directly only where an agent
   * goes some other way, as owner erasure does (services/owner-erasure.ts).
   */
  clearGrantsToIdentity(gaii: string): Promise<GrantsToIdentityCleared>;
  listAgents(): Promise<AgentRecord[]>;

  /** Atomically debit balance. Returns false if insufficient funds. */
  debitBalance(gaii: string, amount: number): Promise<boolean>;

  /** Atomically credit balance. Returns false if agent not found. */
  creditBalance(gaii: string, amount: number): Promise<boolean>;

  /** Atomically credit balance with a cap. Returns actual amount credited (may be 0 if already at cap). */
  creditBalanceCapped(gaii: string, amount: number, cap: number): Promise<number>;
}
