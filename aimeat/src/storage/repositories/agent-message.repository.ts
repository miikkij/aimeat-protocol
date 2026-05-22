/**
 * @file agent-message.repository.ts
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
}
