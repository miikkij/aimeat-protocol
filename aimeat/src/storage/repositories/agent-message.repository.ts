/**
 * @file agent-message.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Repository interface for agent message CRUD, inbox, and thread listing
 * @version-history
 *   v1.0.0 -- 2026-05-22 -- Initial creation for Agent Dashboard Phase 3
 */

import type { AgentMessageRecord } from '../interface.js';

export interface AgentMessageRepository {
  createMessage(record: AgentMessageRecord): Promise<AgentMessageRecord>;
  getMessage(id: string): Promise<AgentMessageRecord | null>;
  listMessages(agentGaii: string, opts?: {
    direction?: 'inbound' | 'outbound';
    threadId?: string;
    page?: number;
    perPage?: number;
  }): Promise<{ messages: AgentMessageRecord[]; total: number }>;
  listPendingMessages(agentGaii: string): Promise<AgentMessageRecord[]>;
  updateMessageStatus(id: string, status: string, processedAt?: string): Promise<AgentMessageRecord | null>;
  listThreads(agentGaii: string): Promise<{ threadId: string; lastMessage: string; messageCount: number; updatedAt: string }[]>;
  /**
   * Aggregate agent→owner (outbound) message counts for a set of agents in one grouped query
   * (for the bulk `GET /v1/agents?include=stats` overview). Keyed by agentGaii. `total` = number
   * of outbound (agent→owner) messages; `lastMessageAt` = MAX(createdAt) of those — drives the
   * "unseen message" badge. Agents with no outbound messages may be absent from the map.
   */
  countMessagesByAgents(agentGaiis: string[]): Promise<Record<string, {
    total: number; lastMessageAt: string | null;
  }>>;
}
