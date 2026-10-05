/**
 * @file src/storage/providers/sqlite/methods/direct-message.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/direct-message.ts
 *   (directMessageMethods), so a fix in one provider finds its twin by file name. Bodies moved verbatim from
 *   the files named in the version history; bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure directMessageMethods
 * @usage Object.assign(SqliteStorage.prototype, directMessageMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — 30 methods (createDirectMessage, getDirectMessage, getDirectMessagesByIds, …) moved
 *     here from messaging.ts so the file mirrors postgres-kysely/methods/direct-message.ts (secaudit 2026-10,
 *     M8).
 */
import type {
  DirectMessageRecord, ContactConsentRecord, ConversationRecord, MessageDeliveryLog, MessageDeliveryStats,
} from '../../../interface.js';
import type { SqliteStorage } from '../index.js';
import * as directMessageRepo from '../repos/direct-message.js';

export const directMessageMethods = {

  // ══════════════════════════════════════════════════════════
  // ── Direct Messages (human↔human) ──
  // ══════════════════════════════════════════════════════════

  async createDirectMessage(this: SqliteStorage, record: DirectMessageRecord): Promise<DirectMessageRecord> {
    return directMessageRepo.createDirectMessage(this.db, record);
  },

  async getDirectMessage(this: SqliteStorage, id: string, ownerGhii: string): Promise<DirectMessageRecord | null> {
    return directMessageRepo.getDirectMessage(this.db, id, ownerGhii);
  },

  async getDirectMessagesByIds(this: SqliteStorage, ids: string[], ownerGhii: string): Promise<DirectMessageRecord[]> {
    return directMessageRepo.getDirectMessagesByIds(this.db, ids, ownerGhii);
  },

  async listInbox(this: SqliteStorage, ownerGhii: string, opts?: { unreadOnly?: boolean; page?: number; perPage?: number }): Promise<{ messages: DirectMessageRecord[]; total: number; unread: number }> {
    return directMessageRepo.listInbox(this.db, ownerGhii, opts);
  },

  async listConversation(this: SqliteStorage, ownerGhii: string, conversationId: string, opts?: { page?: number; perPage?: number }): Promise<{ messages: DirectMessageRecord[]; total: number }> {
    return directMessageRepo.listConversation(this.db, ownerGhii, conversationId, opts);
  },

  async listDmsAddressedTo(this: SqliteStorage, recipientGhii: string, opts?: { page?: number; perPage?: number; groupScope?: { mailboxGhii: string; conversationIds: string[] } }): Promise<{ messages: DirectMessageRecord[]; total: number }> {
    return directMessageRepo.listDmsAddressedTo(this.db, recipientGhii, opts);
  },

  async listAgentDmThread(this: SqliteStorage, agentGaii: string, conversationId: string, opts?: { page?: number; perPage?: number }): Promise<{ messages: DirectMessageRecord[]; total: number }> {
    return directMessageRepo.listAgentDmThread(this.db, agentGaii, conversationId, opts);
  },

  async listDmsByBroadcast(this: SqliteStorage, broadcastId: string, ownerGhii: string): Promise<DirectMessageRecord[]> {
    return directMessageRepo.listDmsByBroadcast(this.db, broadcastId, ownerGhii);
  },

  async listConversations(this: SqliteStorage, ownerGhii: string): Promise<Array<{ conversationId: string; peerGhii: string; subject?: string; lastMessage: string; lastDirection: 'inbound' | 'outbound'; messageCount: number; unread: number; updatedAt: string }>> {
    return directMessageRepo.listConversations(this.db, ownerGhii);
  },

  async listConversationsForOwners(this: SqliteStorage, ownerGhiis: string[]): Promise<Record<string, Array<{ conversationId: string; peerGhii: string; subject?: string; lastMessage: string; lastDirection: 'inbound' | 'outbound'; messageCount: number; unread: number; updatedAt: string }>>> {
    return directMessageRepo.listConversationsForOwners(this.db, ownerGhiis);
  },

  async markMessageRead(this: SqliteStorage, id: string, ownerGhii: string): Promise<DirectMessageRecord | null> {
    return directMessageRepo.markMessageRead(this.db, id, ownerGhii);
  },

  async markConversationRead(this: SqliteStorage, ownerGhii: string, conversationId: string): Promise<number> {
    return directMessageRepo.markConversationRead(this.db, ownerGhii, conversationId);
  },

  async updateMessageDeliveryStatus(this: SqliteStorage, id: string, status: DirectMessageRecord['status'], extra?: { deliveredAt?: string; error?: string }): Promise<DirectMessageRecord | null> {
    return directMessageRepo.updateMessageDeliveryStatus(this.db, id, status, extra);
  },

  async setMessageReadReceipt(this: SqliteStorage, id: string, readAt: string): Promise<DirectMessageRecord | null> {
    return directMessageRepo.setMessageReadReceipt(this.db, id, readAt);
  },

  async listOutboundForRetry(this: SqliteStorage, limit?: number): Promise<DirectMessageRecord[]> {
    return directMessageRepo.listOutboundForRetry(this.db, limit);
  },

  async listInboundWithAttachments(this: SqliteStorage, limit?: number): Promise<DirectMessageRecord[]> {
    return directMessageRepo.listInboundWithAttachments(this.db, limit);
  },

  async updateMessageAttachments(this: SqliteStorage, id: string, ownerGhii: string, attachments: DirectMessageRecord['attachments']): Promise<DirectMessageRecord | null> {
    return directMessageRepo.updateMessageAttachments(this.db, id, ownerGhii, attachments);
  },

  async deleteDirectMessage(this: SqliteStorage, id: string, ownerGhii: string): Promise<boolean> {
    return directMessageRepo.deleteDirectMessage(this.db, id, ownerGhii);
  },

  async appendMessageDeliveryLog(this: SqliteStorage, log: MessageDeliveryLog): Promise<void> {
    directMessageRepo.appendMessageDeliveryLog(this.db, log);
  },

  async listMessageDeliveryLogs(this: SqliteStorage, limit?: number): Promise<MessageDeliveryLog[]> {
    return directMessageRepo.listMessageDeliveryLogs(this.db, limit);
  },

  async getMessageDeliveryStats(this: SqliteStorage): Promise<MessageDeliveryStats> {
    return directMessageRepo.getMessageDeliveryStats(this.db);
  },

  async pruneMessageDeliveryLogs(this: SqliteStorage, keep?: number): Promise<number> {
    return directMessageRepo.pruneMessageDeliveryLogs(this.db, keep);
  },

  // ── Group conversations (only a >2-participant thread has a row) ──

  async createConversation(this: SqliteStorage, record: ConversationRecord): Promise<ConversationRecord> {
    return directMessageRepo.createConversation(this.db, record);
  },

  async getConversation(this: SqliteStorage, id: string): Promise<ConversationRecord | null> {
    return directMessageRepo.getConversation(this.db, id);
  },

  async updateConversation(this: SqliteStorage, id: string, updates: Partial<Pick<ConversationRecord, 'participants' | 'subject' | 'alias'>>): Promise<ConversationRecord | null> {
    return directMessageRepo.updateConversation(this.db, id, updates);
  },

  async listConversationsForParticipant(this: SqliteStorage, identity: string): Promise<ConversationRecord[]> {
    return directMessageRepo.listConversationsForParticipant(this.db, identity);
  },

  async getContact(this: SqliteStorage, ownerGhii: string, contactId: string): Promise<ContactConsentRecord | null> {
    return directMessageRepo.getContact(this.db, ownerGhii, contactId);
  },

  async setContactState(this: SqliteStorage, ownerGhii: string, contactId: string, state: ContactConsentRecord['state'], firstMessageId?: string, origin?: ContactConsentRecord['origin']): Promise<ContactConsentRecord> {
    return directMessageRepo.setContactState(this.db, ownerGhii, contactId, state, firstMessageId, origin);
  },

  async listContacts(this: SqliteStorage, ownerGhii: string, opts?: { state?: ContactConsentRecord['state'] }): Promise<ContactConsentRecord[]> {
    return directMessageRepo.listContacts(this.db, ownerGhii, opts);
  },

  async deleteContact(this: SqliteStorage, ownerGhii: string, contactId: string): Promise<boolean> {
    return directMessageRepo.deleteContact(this.db, ownerGhii, contactId);
  },
};
