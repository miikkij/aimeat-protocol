/**
 * @file direct-message.ts
 * @description SQLite implementation of the DirectMessageRepository — human↔human direct messages
 *   (mailbox-model rows), inbox/conversation listing, delivery + read state, and per-pair contact
 *   consent (the first-contact gate).
 * @structure deserialize helpers + message CRUD/list + contact-consent CRUD; all keyed by ownerGhii.
 * @usage import * as directMessageRepo from './repos/direct-message.js'; (wired in sqlite/index.ts)
 * @version-history
 *   v1.0.0 -- 2026-06-16 -- Initial creation for user-to-user messaging (layer 1: storage).
 */

import type Database from 'better-sqlite3';
import type { DirectMessageRecord, ContactConsentRecord } from '../../../interface.js';

// ── Helpers ──

function deserializeMessage(row: Record<string, unknown>): DirectMessageRecord {
  const record: DirectMessageRecord = {
    id: row.id as string,
    ownerGhii: row.ownerGhii as string,
    conversationId: row.conversationId as string,
    senderGhii: row.senderGhii as string,
    recipientGhii: row.recipientGhii as string,
    body: row.body as string,
    status: row.status as DirectMessageRecord['status'],
    direction: row.direction as DirectMessageRecord['direction'],
    origin: row.origin as DirectMessageRecord['origin'],
    originNodeId: row.originNodeId as string,
    createdAt: row.createdAt as string,
  };
  if (row.attachments) record.attachments = JSON.parse(row.attachments as string);
  if (row.replyToId) record.replyToId = row.replyToId as string;
  if (row.error) record.error = row.error as string;
  if (row.deliveredAt) record.deliveredAt = row.deliveredAt as string;
  if (row.readAt) record.readAt = row.readAt as string;
  return record;
}

function deserializeContact(row: Record<string, unknown>): ContactConsentRecord {
  const record: ContactConsentRecord = {
    ownerGhii: row.ownerGhii as string,
    contactId: row.contactId as string,
    state: row.state as ContactConsentRecord['state'],
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
  if (row.firstMessageId) record.firstMessageId = row.firstMessageId as string;
  return record;
}

// ── Direct Messages ──

export function createDirectMessage(db: Database.Database, record: DirectMessageRecord): DirectMessageRecord {
  db.prepare(
    `INSERT INTO direct_messages
     (id, ownerGhii, conversationId, senderGhii, recipientGhii, body, attachments, status,
      direction, replyToId, origin, originNodeId, error, createdAt, deliveredAt, readAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id,
    record.ownerGhii,
    record.conversationId,
    record.senderGhii,
    record.recipientGhii,
    record.body,
    record.attachments ? JSON.stringify(record.attachments) : null,
    record.status,
    record.direction,
    record.replyToId ?? null,
    record.origin,
    record.originNodeId,
    record.error ?? null,
    record.createdAt,
    record.deliveredAt ?? null,
    record.readAt ?? null,
  );
  return record;
}

export function getDirectMessage(db: Database.Database, id: string, ownerGhii: string): DirectMessageRecord | null {
  const row = db.prepare('SELECT * FROM direct_messages WHERE id = ? AND ownerGhii = ?').get(id, ownerGhii) as Record<string, unknown> | undefined;
  return row ? deserializeMessage(row) : null;
}

export function listInbox(
  db: Database.Database,
  ownerGhii: string,
  opts?: { unreadOnly?: boolean; page?: number; perPage?: number },
): { messages: DirectMessageRecord[]; total: number; unread: number } {
  const page = opts?.page ?? 1;
  const perPage = opts?.perPage ?? 20;
  const offset = (page - 1) * perPage;

  let whereSql = "WHERE ownerGhii = ? AND direction = 'inbound'";
  const params: unknown[] = [ownerGhii];
  if (opts?.unreadOnly) whereSql += ' AND readAt IS NULL';

  const total = (db.prepare(`SELECT COUNT(*) as cnt FROM direct_messages ${whereSql}`).get(...params) as { cnt: number }).cnt;
  const unread = (db.prepare(
    "SELECT COUNT(*) as cnt FROM direct_messages WHERE ownerGhii = ? AND direction = 'inbound' AND readAt IS NULL",
  ).get(ownerGhii) as { cnt: number }).cnt;

  const rows = db.prepare(
    `SELECT * FROM direct_messages ${whereSql} ORDER BY createdAt DESC LIMIT ? OFFSET ?`
  ).all(...params, perPage, offset) as Record<string, unknown>[];

  return { messages: rows.map(deserializeMessage), total, unread };
}

export function listConversation(
  db: Database.Database,
  ownerGhii: string,
  conversationId: string,
  opts?: { page?: number; perPage?: number },
): { messages: DirectMessageRecord[]; total: number } {
  const page = opts?.page ?? 1;
  const perPage = opts?.perPage ?? 50;
  const offset = (page - 1) * perPage;

  const total = (db.prepare(
    'SELECT COUNT(*) as cnt FROM direct_messages WHERE ownerGhii = ? AND conversationId = ?',
  ).get(ownerGhii, conversationId) as { cnt: number }).cnt;

  const rows = db.prepare(
    'SELECT * FROM direct_messages WHERE ownerGhii = ? AND conversationId = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?',
  ).all(ownerGhii, conversationId, perPage, offset) as Record<string, unknown>[];

  return { messages: rows.map(deserializeMessage), total };
}

export function listConversations(
  db: Database.Database,
  ownerGhii: string,
): Array<{
  conversationId: string;
  peerGhii: string;
  lastMessage: string;
  lastDirection: 'inbound' | 'outbound';
  messageCount: number;
  unread: number;
  updatedAt: string;
}> {
  const rows = db.prepare(
    `SELECT conversationId, COUNT(*) as messageCount, MAX(createdAt) as updatedAt
     FROM direct_messages WHERE ownerGhii = ?
     GROUP BY conversationId ORDER BY updatedAt DESC`,
  ).all(ownerGhii) as Array<{ conversationId: string; messageCount: number; updatedAt: string }>;

  return rows.map(row => {
    const last = db.prepare(
      'SELECT body, direction, senderGhii, recipientGhii FROM direct_messages WHERE ownerGhii = ? AND conversationId = ? ORDER BY createdAt DESC LIMIT 1',
    ).get(ownerGhii, row.conversationId) as { body: string; direction: 'inbound' | 'outbound'; senderGhii: string; recipientGhii: string } | undefined;
    const unread = (db.prepare(
      "SELECT COUNT(*) as cnt FROM direct_messages WHERE ownerGhii = ? AND conversationId = ? AND direction = 'inbound' AND readAt IS NULL",
    ).get(ownerGhii, row.conversationId) as { cnt: number }).cnt;

    // The peer is the other party relative to this mailbox owner.
    const peerGhii = last
      ? (last.direction === 'inbound' ? last.senderGhii : last.recipientGhii)
      : '';

    return {
      conversationId: row.conversationId,
      peerGhii,
      lastMessage: last?.body ?? '',
      lastDirection: last?.direction ?? 'inbound',
      messageCount: row.messageCount,
      unread,
      updatedAt: row.updatedAt,
    };
  });
}

export function markMessageRead(db: Database.Database, id: string, ownerGhii: string): DirectMessageRecord | null {
  const existing = getDirectMessage(db, id, ownerGhii);
  if (!existing) return null;
  const now = new Date().toISOString();
  db.prepare("UPDATE direct_messages SET status = 'read', readAt = ? WHERE id = ? AND ownerGhii = ?").run(now, id, ownerGhii);
  return getDirectMessage(db, id, ownerGhii);
}

export function markConversationRead(db: Database.Database, ownerGhii: string, conversationId: string): number {
  const now = new Date().toISOString();
  const info = db.prepare(
    "UPDATE direct_messages SET status = 'read', readAt = ? WHERE ownerGhii = ? AND conversationId = ? AND direction = 'inbound' AND readAt IS NULL",
  ).run(now, ownerGhii, conversationId);
  return info.changes;
}

export function updateMessageDeliveryStatus(
  db: Database.Database,
  id: string,
  status: DirectMessageRecord['status'],
  extra?: { deliveredAt?: string; error?: string },
): DirectMessageRecord | null {
  // Delivery status lives on the sender's (outbound) copy; update wherever the id exists.
  const row = db.prepare('SELECT ownerGhii FROM direct_messages WHERE id = ? AND direction = ?').get(id, 'outbound') as { ownerGhii: string } | undefined;
  if (!row) return null;
  db.prepare('UPDATE direct_messages SET status = ?, deliveredAt = COALESCE(?, deliveredAt), error = ? WHERE id = ? AND ownerGhii = ?')
    .run(status, extra?.deliveredAt ?? null, extra?.error ?? null, id, row.ownerGhii);
  return getDirectMessage(db, id, row.ownerGhii);
}

export function listOutboundForRetry(db: Database.Database, limit = 200): DirectMessageRecord[] {
  const rows = db.prepare(
    "SELECT * FROM direct_messages WHERE direction = 'outbound' AND status IN ('queued', 'failed') ORDER BY createdAt ASC LIMIT ?",
  ).all(limit) as Record<string, unknown>[];
  return rows.map(deserializeMessage);
}

export function setMessageReadReceipt(db: Database.Database, id: string, readAt: string): DirectMessageRecord | null {
  const row = db.prepare('SELECT ownerGhii FROM direct_messages WHERE id = ? AND direction = ?').get(id, 'outbound') as { ownerGhii: string } | undefined;
  if (!row) return null;
  db.prepare("UPDATE direct_messages SET status = 'read', readAt = ? WHERE id = ? AND ownerGhii = ?").run(readAt, id, row.ownerGhii);
  return getDirectMessage(db, id, row.ownerGhii);
}

export function updateMessageAttachments(
  db: Database.Database,
  id: string,
  ownerGhii: string,
  attachments: DirectMessageRecord['attachments'],
): DirectMessageRecord | null {
  const existing = getDirectMessage(db, id, ownerGhii);
  if (!existing) return null;
  db.prepare('UPDATE direct_messages SET attachments = ? WHERE id = ? AND ownerGhii = ?')
    .run(attachments ? JSON.stringify(attachments) : null, id, ownerGhii);
  return getDirectMessage(db, id, ownerGhii);
}

export function deleteDirectMessage(db: Database.Database, id: string, ownerGhii: string): boolean {
  const info = db.prepare('DELETE FROM direct_messages WHERE id = ? AND ownerGhii = ?').run(id, ownerGhii);
  return info.changes > 0;
}

// ── Contact consent ──

export function getContact(db: Database.Database, ownerGhii: string, contactId: string): ContactConsentRecord | null {
  const row = db.prepare('SELECT * FROM contact_consents WHERE ownerGhii = ? AND contactId = ?').get(ownerGhii, contactId) as Record<string, unknown> | undefined;
  return row ? deserializeContact(row) : null;
}

export function setContactState(
  db: Database.Database,
  ownerGhii: string,
  contactId: string,
  state: ContactConsentRecord['state'],
  firstMessageId?: string,
): ContactConsentRecord {
  const now = new Date().toISOString();
  const existing = getContact(db, ownerGhii, contactId);
  if (existing) {
    db.prepare('UPDATE contact_consents SET state = ?, firstMessageId = COALESCE(?, firstMessageId), updatedAt = ? WHERE ownerGhii = ? AND contactId = ?')
      .run(state, firstMessageId ?? null, now, ownerGhii, contactId);
  } else {
    db.prepare('INSERT INTO contact_consents (ownerGhii, contactId, state, firstMessageId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(ownerGhii, contactId, state, firstMessageId ?? null, now, now);
  }
  return getContact(db, ownerGhii, contactId)!;
}

export function listContacts(
  db: Database.Database,
  ownerGhii: string,
  opts?: { state?: ContactConsentRecord['state'] },
): ContactConsentRecord[] {
  let whereSql = 'WHERE ownerGhii = ?';
  const params: unknown[] = [ownerGhii];
  if (opts?.state) {
    whereSql += ' AND state = ?';
    params.push(opts.state);
  }
  const rows = db.prepare(`SELECT * FROM contact_consents ${whereSql} ORDER BY updatedAt DESC`).all(...params) as Record<string, unknown>[];
  return rows.map(deserializeContact);
}
