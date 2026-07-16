/**
 * @file direct-message.repository.ts
 * @description Repository interface for human↔human direct messages (GHII messaging + federation):
 *   message CRUD, inbox, conversations/threads, delivery + read state, and per-pair contact consent.
 * @structure DirectMessageRepository — message + contact-consent methods, mirrored across SQLite + Mongo.
 * @usage import type { DirectMessageRepository } from '../interface.js'; (composed into Storage)
 * @version-history
 *   v1.2.0 -- 2026-07-16 -- Add getDirectMessagesByIds batch (Phase 3): many messages by id under one owner.
 *   v1.1.0 -- 2026-07-16 -- Add ConversationSummary type + listConversationsForOwners batch (Phase 3 fan-out→IN).
 *   v1.0.0 -- 2026-06-16 -- Initial creation for user-to-user messaging (layer 1: storage).
 */

import type { DirectMessageRecord, ContactConsentRecord, MessageDeliveryLog, MessageDeliveryStats } from '../interface.js';

/** One row of the conversations list — the per-thread summary {@link DirectMessageRepository.listConversations}
 *  (and its batched sibling {@link DirectMessageRepository.listConversationsForOwners}) return. */
export type ConversationSummary = {
  conversationId: string;
  peerGhii: string;
  subject?: string;
  lastMessage: string;
  lastDirection: 'inbound' | 'outbound';
  messageCount: number;
  unread: number;
  updatedAt: string;
};

export interface DirectMessageRepository {
  // ── Messages ──
  createDirectMessage(record: DirectMessageRecord): Promise<DirectMessageRecord>;
  getDirectMessage(id: string, ownerGhii: string): Promise<DirectMessageRecord | null>;
  /**
   * BULK PRIMITIVE (Phase 3) — many messages by id under ONE owner mailbox in one `IN (…)` query. Backs
   * the pending first-contact requests list (was getDirectMessage per pending contact). Returns the rows
   * that exist; the caller indexes by `record.id` (the message id). Optional — falls back to a per-id loop.
   */
  getDirectMessagesByIds?(ids: string[], ownerGhii: string): Promise<DirectMessageRecord[]>;
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
  /** Messages ADDRESSED TO an agent/eco identity (recipientGhii match), newest first. These physically
   *  live in the owner's mailbox (a reply to an agent is delivered to its owner), so they are NOT found
   *  by listInbox(agentGaii); this is how an agent reads its own federated DMs. */
  listDmsAddressedTo(recipientGhii: string, opts?: {
    page?: number;
    perPage?: number;
  }): Promise<{ messages: DirectMessageRecord[]; total: number }>;
  /** One conversation as an AGENT sees it: its own sent copies (ownerGhii=agent, outbound) + the
   *  inbound copies addressed to it (recipientGhii=agent, inbound). De-duplicated, newest first. */
  listAgentDmThread(agentGaii: string, conversationId: string, opts?: {
    page?: number;
    perPage?: number;
  }): Promise<{ messages: DirectMessageRecord[]; total: number }>;
  /** All copies of a broadcast (send-to-many) in the sender's mailbox — outbound copies + inbound replies
   *  that inherited the broadcastId — for the results/aggregation view. */
  listDmsByBroadcast(broadcastId: string, ownerGhii: string): Promise<DirectMessageRecord[]>;
  /** One entry per conversation: peer, last message preview, unread count, updatedAt. */
  listConversations(ownerGhii: string): Promise<ConversationSummary[]>;
  /**
   * BULK PRIMITIVE (Phase 3) — the conversations list for MANY mailbox owners in ONE pass (fan-out→IN):
   * batches the owner + per-agent {@link listConversations} fan-out the conversations view runs (an owner
   * with a fleet paid one listConversations per agent). Same per-thread shape and semantics as
   * {@link listConversations}; keyed by ownerGhii (an owner with no threads is absent from the map).
   * Implemented as ONE grouped aggregate + ONE last-message + ONE subject query (window functions),
   * independent of the owner count. Optional — a backend without it falls back to a per-owner loop.
   */
  listConversationsForOwners?(ownerGhiis: string[]): Promise<Record<string, ConversationSummary[]>>;
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
  /** Outbound copies still awaiting cross-node delivery (status queued/failed), oldest first. */
  listOutboundForRetry(limit?: number): Promise<DirectMessageRecord[]>;
  /** Inbound copies that carry attachments (for the attachment duplication/expiry sweep). */
  listInboundWithAttachments(limit?: number): Promise<DirectMessageRecord[]>;
  /** Persist (re)resolved attachment descriptors after duplication/quota handling. */
  updateMessageAttachments(id: string, ownerGhii: string, attachments: DirectMessageRecord['attachments']): Promise<DirectMessageRecord | null>;
  deleteDirectMessage(id: string, ownerGhii: string): Promise<boolean>;

  // ── Delivery telemetry (operator dashboard; no content/identities) ──
  appendMessageDeliveryLog(log: MessageDeliveryLog): Promise<void>;
  listMessageDeliveryLogs(limit?: number): Promise<MessageDeliveryLog[]>;
  getMessageDeliveryStats(): Promise<MessageDeliveryStats>;
  pruneMessageDeliveryLogs(keep?: number): Promise<number>;

  // ── Contact consent (first-contact gate + the owner's address book) ──
  getContact(ownerGhii: string, contactId: string): Promise<ContactConsentRecord | null>;
  /** Upsert a contact's state. `origin` marks an explicit address-book save ('saved'); when
   *  omitted an EXISTING row keeps its origin (the DM gate must never downgrade a saved contact)
   *  and a new row defaults to 'message'. */
  setContactState(ownerGhii: string, contactId: string, state: ContactConsentRecord['state'], firstMessageId?: string, origin?: ContactConsentRecord['origin']): Promise<ContactConsentRecord>;
  listContacts(ownerGhii: string, opts?: { state?: ContactConsentRecord['state'] }): Promise<ContactConsentRecord[]>;
  /** Remove a contact row (address-book delete). Returns false when no row existed. */
  deleteContact(ownerGhii: string, contactId: string): Promise<boolean>;
}
