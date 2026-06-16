/**
 * @file direct-message.repository.ts
 * @description Repository interface for human↔human direct messages (GHII messaging + federation):
 *   message CRUD, inbox, conversations/threads, delivery + read state, and per-pair contact consent.
 * @structure DirectMessageRepository — message + contact-consent methods, mirrored across SQLite + Mongo.
 * @usage import type { DirectMessageRepository } from '../interface.js'; (composed into Storage)
 * @version-history
 *   v1.0.0 -- 2026-06-16 -- Initial creation for user-to-user messaging (layer 1: storage).
 */

import type { DirectMessageRecord, ContactConsentRecord } from '../interface.js';

export interface DirectMessageRepository {
  // ── Messages ──
  createDirectMessage(record: DirectMessageRecord): Promise<DirectMessageRecord>;
  getDirectMessage(id: string, ownerGhii: string): Promise<DirectMessageRecord | null>;
  /** List a mailbox's inbound messages, newest first; returns total + unread count. */
  listInbox(ownerGhii: string, opts?: {
    unreadOnly?: boolean;
    page?: number;
    perPage?: number;
  }): Promise<{ messages: DirectMessageRecord[]; total: number; unread: number }>;
  /** Full thread (both directions) for one conversation, newest first. */
  listConversation(ownerGhii: string, conversationId: string, opts?: {
    page?: number;
    perPage?: number;
  }): Promise<{ messages: DirectMessageRecord[]; total: number }>;
  /** One entry per conversation: peer, last message preview, unread count, updatedAt. */
  listConversations(ownerGhii: string): Promise<Array<{
    conversationId: string;
    peerGhii: string;
    lastMessage: string;
    lastDirection: 'inbound' | 'outbound';
    messageCount: number;
    unread: number;
    updatedAt: string;
  }>>;
  /** Mark a single message read (sets readAt + status='read'). Returns the updated row. */
  markMessageRead(id: string, ownerGhii: string): Promise<DirectMessageRecord | null>;
  /** Mark every inbound message in a conversation read. Returns count updated. */
  markConversationRead(ownerGhii: string, conversationId: string): Promise<number>;
  /** Update delivery lifecycle on a message (sender-side: queued→sent→delivered/failed/undeliverable). */
  updateMessageDeliveryStatus(id: string, status: DirectMessageRecord['status'], extra?: {
    deliveredAt?: string;
    error?: string;
  }): Promise<DirectMessageRecord | null>;
  /** Apply a federated read receipt to the sender's row (status='read' + readAt). */
  setMessageReadReceipt(id: string, readAt: string): Promise<DirectMessageRecord | null>;
  /** Persist (re)resolved attachment descriptors after duplication/quota handling. */
  updateMessageAttachments(id: string, ownerGhii: string, attachments: DirectMessageRecord['attachments']): Promise<DirectMessageRecord | null>;
  deleteDirectMessage(id: string, ownerGhii: string): Promise<boolean>;

  // ── Contact consent (first-contact gate) ──
  getContact(ownerGhii: string, contactId: string): Promise<ContactConsentRecord | null>;
  setContactState(ownerGhii: string, contactId: string, state: ContactConsentRecord['state'], firstMessageId?: string): Promise<ContactConsentRecord>;
  listContacts(ownerGhii: string, opts?: { state?: ContactConsentRecord['state'] }): Promise<ContactConsentRecord[]>;
}
