/**
 * @file src/storage/repositories/agent-v2-messaging.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage contract for Agent v2 messaging: the turns, and the delivery targets an
 *   absent principal registers so it hears about them.
 *
 *   EVERY READ TAKES THE OWNER. Not as a filter a caller may leave off, but as the first argument,
 *   because the fence and the query are the same thing here: a message is reachable by the account
 *   whose principals sent and received it, and a signature that lets you ask without saying whose
 *   is a signature that lets you forget.
 *
 * @structure AgentV2MessagingRepository — messages: create / get / list; push configs: upsert /
 *   get / list / delete / recordAttempt; erasure: deleteByOwner for both
 * @usage const turns = await storage.listAgentV2Messages(owner, { contextId });
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V4).
 */
import type { AgentV2MessageRecord, AgentV2PushConfigRecord } from '../interface.js';

/** What a message listing may narrow by. Everything is optional except the owner, which is not here. */
export interface AgentV2MessageQuery {
  /** One exchange. The usual read. */
  contextId?: string;
  /** One task's turns, once V5 gives messages a task. */
  taskId?: string;
  /** Turns sent to this principal. */
  to?: string;
  /** Turns sent by this principal. */
  from?: string;
  /** ISO timestamp, exclusive: turns created after it. How a reconnecting principal catches up. */
  since?: string;
  /** Default 50, capped by the caller. */
  limit?: number;
}

export interface AgentV2MessagingRepository {
  createAgentV2Message(message: AgentV2MessageRecord): Promise<void>;
  getAgentV2Message(owner: string, messageId: string): Promise<AgentV2MessageRecord | null>;
  /** Oldest first, so a reader appends. */
  listAgentV2Messages(owner: string, query: AgentV2MessageQuery): Promise<AgentV2MessageRecord[]>;
  deleteAgentV2MessagesByOwner(owner: string): Promise<number>;

  /**
   * Register or replace a delivery target. Keyed by its own id, so a principal may hold several.
   * Passing an existing id replaces that one; the failure counters reset, because re-registering is
   * how a person clears a target the node gave up on.
   */
  upsertAgentV2PushConfig(config: AgentV2PushConfigRecord): Promise<void>;
  getAgentV2PushConfig(owner: string, id: string): Promise<AgentV2PushConfigRecord | null>;
  /** Every target for one principal, or for the whole account when `principal` is omitted. */
  listAgentV2PushConfigs(owner: string, principal?: string): Promise<AgentV2PushConfigRecord[]>;
  deleteAgentV2PushConfig(owner: string, id: string): Promise<boolean>;
  /**
   * Record what one delivery attempt did. A success clears the count; a failure increments it and
   * `disabledAt` is set by the caller when it decides to stop.
   */
  recordAgentV2PushAttempt(id: string, ok: boolean, at: string, disabledAt?: string | null): Promise<void>;
  deleteAgentV2PushConfigsByOwner(owner: string): Promise<number>;
}
