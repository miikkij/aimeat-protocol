/**
 * @file src/storage/repositories/agent.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage-backend-agnostic interface for agent (GAII) persistence: CRUD/lookup by
 *   gaii, name, or owner, plus atomic morsel-balance operations (debit/credit/capped-credit/transfer).
 *   Each backend (SQLite, MongoDB, PostgreSQL) implements this contract.
 *
 * @structure
 *   - AgentRepository: create/get/getByName/getByOwner/update/delete/list agents
 *   - balance ops: debitBalance, creditBalance, creditBalanceCapped, transferBalance (atomic)
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { AgentRecord } from '../interface.js';

export interface AgentRepository {
  createAgent(agent: AgentRecord): Promise<AgentRecord>;
  getAgent(gaii: string): Promise<AgentRecord | null>;
  getAgentByName(name: string, nodeId: string): Promise<AgentRecord | null>;
  getAgentsByOwner(owner: string): Promise<AgentRecord[]>;
  /** Agents for MANY owners in ONE `owner IN (…)` query, grouped by owner name (every requested owner is
   *  a key, empty array if none). Batches the members-roster fan-out (getAgentsByOwner per member). */
  getAgentsByOwners(owners: string[]): Promise<Record<string, AgentRecord[]>>;
  updateAgent(gaii: string, updates: Partial<AgentRecord>): Promise<AgentRecord | null>;
  deleteAgent(gaii: string): Promise<boolean>;
  listAgents(): Promise<AgentRecord[]>;

  /** Atomically debit balance. Returns false if insufficient funds. */
  debitBalance(gaii: string, amount: number): Promise<boolean>;

  /** Atomically credit balance. Returns false if agent not found. */
  creditBalance(gaii: string, amount: number): Promise<boolean>;

  /** Atomically credit balance with a cap. Returns actual amount credited (may be 0 if already at cap). */
  creditBalanceCapped(gaii: string, amount: number, cap: number): Promise<number>;

  /** Atomically transfer: debit from + credit to in one transaction. Returns false if insufficient funds or agent not found. */
  transferBalance(fromGaii: string, toGaii: string, amount: number): Promise<boolean>;
}
