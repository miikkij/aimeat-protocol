/**
 * @file direct-message.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite implementation of the DirectMessageRepository — human↔human direct messages
 *   (mailbox-model rows), inbox/conversation listing, delivery + read state, and per-pair contact
 *   consent (the first-contact gate).
 * @structure deserialize helpers + message CRUD/list + contact-consent CRUD; all keyed by ownerGhii.
 * @usage import * as directMessageRepo from './repos/direct-message.js'; (wired in sqlite/index.ts)
 * @version-history
 *   v1.4.0 -- 2026-08-22 -- lastSenderGhii on both conversation summaries; listDmsAddressedTo honours
 *     groupScope (the thread's rows in this identity's mailbox, minus what it sent itself).
 *   v1.3.0 -- 2026-08-11 -- Group conversations: a thread with more than two participants gets a row
 *     (createConversation / getConversation / updateConversation / listConversationsForParticipant).
 *     A pair thread still stores nothing, so no existing conversation changed.
 *   v1.2.0 -- 2026-07-16 -- Add getDirectMessagesByIds batch (Phase 3): many messages by id under one owner.
 *   v1.1.0 -- 2026-07-16 -- Add listConversationsForOwners batch (Phase 3): the conversations list for many
 *     owners in 3 window-function queries, collapsing the route's owner + per-agent fan-out.
 *   v1.0.0 -- 2026-06-16 -- Initial creation for user-to-user messaging (layer 1: storage).
 */

import type Database from 'better-sqlite3';
import type { DirectMessageRecord, ContactConsentRecord, ConversationRecord, MessageDeliveryLog, MessageDeliveryStats } from '../../../interface.js';
import type { ConversationSummary } from '../../../repositories/direct-message.repository.js';

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
  if (row.subject) record.subject = row.subject as string;
  if (row.attachments) record.attachments = JSON.parse(row.attachments as string);
  if (row.interactive) record.interactive = JSON.parse(row.interactive as string);
  if (row.broadcastId) record.broadcastId = row.broadcastId as string;
  if (row.respondable != null) record.respondable = (row.respondable as number) === 1;
  if (row.kind) record.kind = row.kind as DirectMessageRecord['kind'];
  if (row.replyToId) record.replyToId = row.replyToId as string;
  if (row.error) record.error = row.error as string;
  if (row.aiProvenanceId) record.aiProvenanceId = row.aiProvenanceId as string;
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
  record.origin = (row.origin === 'saved' ? 'saved' : 'message');
  return record;
}

// ── Direct Messages ──

export function createDirectMessage(db: Database.Database, record: DirectMessageRecord): DirectMessageRecord {
  db.prepare(
    `INSERT INTO direct_messages
     (id, ownerGhii, conversationId, subject, senderGhii, recipientGhii, body, attachments, interactive,
      broadcastId, respondable, kind, status,
      direction, replyToId, origin, originNodeId, error, aiProvenanceId, createdAt, deliveredAt, readAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id,
    record.ownerGhii,
    record.conversationId,
    record.subject ?? null,
    record.senderGhii,
    record.recipientGhii,
    record.body,
    record.attachments ? JSON.stringify(record.attachments) : null,
    record.interactive ? JSON.stringify(record.interactive) : null,
    record.broadcastId ?? null,
    record.respondable == null ? null : (record.respondable ? 1 : 0),
    record.kind ?? null,
    record.status,
    record.direction,
    record.replyToId ?? null,
    record.origin,
    record.originNodeId,
    record.error ?? null,
    record.aiProvenanceId ?? null,
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

/** BULK (Phase 3) — many messages by id under one owner mailbox in ONE `IN (…)` query (sqlite `id` = mid). */
export function getDirectMessagesByIds(db: Database.Database, ids: string[], ownerGhii: string): DirectMessageRecord[] {
  if (ids.length === 0) return [];
  const ph = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM direct_messages WHERE ownerGhii = ? AND id IN (${ph})`).all(ownerGhii, ...ids) as Record<string, unknown>[];
  return rows.map(deserializeMessage);
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

export function listDmsAddressedTo(
  db: Database.Database,
  recipientGhii: string,
  opts?: { page?: number; perPage?: number; groupScope?: { mailboxGhii: string; conversationIds: string[] } },
): { messages: DirectMessageRecord[]; total: number } {
  const page = opts?.page ?? 1;
  const perPage = opts?.perPage ?? 20;
  const offset = (page - 1) * perPage;
  // A group message is addressed to the THREAD, so the recipient match finds none of it. Where the caller
  // has established membership, the thread's rows in this identity's mailbox count as addressed to it —
  // minus what it sent itself, which belongs in a sent view and not in an inbox.
  const ids = opts?.groupScope?.conversationIds ?? [];
  const params: unknown[] = [recipientGhii];
  let where = "(recipientGhii = ? AND direction = 'inbound')";
  if (ids.length) {
    where += ` OR (ownerGhii = ? AND conversationId IN (${ids.map(() => '?').join(',')}) AND senderGhii <> ?)`;
    params.push(opts!.groupScope!.mailboxGhii, ...ids, recipientGhii);
  }
  const total = (db.prepare(
    `SELECT COUNT(*) as cnt FROM direct_messages WHERE ${where}`,
  ).get(...params) as { cnt: number }).cnt;
  const rows = db.prepare(
    `SELECT * FROM direct_messages WHERE ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
  ).all(...params, perPage, offset) as Record<string, unknown>[];
  return { messages: rows.map(deserializeMessage), total };
}

export function listAgentDmThread(
  db: Database.Database,
  agentGaii: string,
  conversationId: string,
  opts?: { page?: number; perPage?: number },
): { messages: DirectMessageRecord[]; total: number } {
  const page = opts?.page ?? 1;
  const perPage = opts?.perPage ?? 50;
  const offset = (page - 1) * perPage;
  // The agent's own sent copies (ownerGhii=agent, outbound) + inbound copies addressed to it
  // (recipientGhii=agent, inbound). These two sets never overlap, so no dedup is needed.
  const where = "conversationId = ? AND ((ownerGhii = ? AND direction = 'outbound') OR (recipientGhii = ? AND direction = 'inbound'))";
  const total = (db.prepare(`SELECT COUNT(*) as cnt FROM direct_messages WHERE ${where}`)
    .get(conversationId, agentGaii, agentGaii) as { cnt: number }).cnt;
  const rows = db.prepare(`SELECT * FROM direct_messages WHERE ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`)
    .all(conversationId, agentGaii, agentGaii, perPage, offset) as Record<string, unknown>[];
  return { messages: rows.map(deserializeMessage), total };
}

/** All copies of a broadcast in the sender's mailbox (outbound questions/messages + inbound replies that
 *  inherited the broadcastId), for the results/aggregation view. */
export function listDmsByBroadcast(db: Database.Database, broadcastId: string, ownerGhii: string): DirectMessageRecord[] {
  const rows = db.prepare(
    'SELECT * FROM direct_messages WHERE broadcastId = ? AND ownerGhii = ? ORDER BY createdAt ASC',
  ).all(broadcastId, ownerGhii) as Record<string, unknown>[];
  return rows.map(deserializeMessage);
}

export function listConversations(
  db: Database.Database,
  ownerGhii: string,
): ConversationSummary[] {
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
    // The thread subject is the one set on the message that opened it (earliest non-null subject).
    const subj = db.prepare(
      'SELECT subject FROM direct_messages WHERE ownerGhii = ? AND conversationId = ? AND subject IS NOT NULL ORDER BY createdAt ASC LIMIT 1',
    ).get(ownerGhii, row.conversationId) as { subject: string } | undefined;

    // The peer is the other party relative to this mailbox owner.
    const peerGhii = last
      ? (last.direction === 'inbound' ? last.senderGhii : last.recipientGhii)
      : '';

    return {
      conversationId: row.conversationId,
      peerGhii,
      subject: subj?.subject,
      lastMessage: last?.body ?? '',
      lastDirection: last?.direction ?? 'inbound',
      lastSenderGhii: last?.senderGhii ?? '',
      messageCount: row.messageCount,
      unread,
      updatedAt: row.updatedAt,
    };
  });
}

/** BULK (Phase 3) — the conversations list for MANY owners in ONE grouped aggregate + ONE last-message +
 *  ONE subject query (window functions), regardless of owner count. Byte-for-byte the per-thread shape of
 *  {@link listConversations} — the same peer/subject/unread/last rules — but keyed by ownerGhii so the
 *  route's owner + per-agent fan-out collapses to this one call. */
export function listConversationsForOwners(
  db: Database.Database,
  ownerGhiis: string[],
): Record<string, ConversationSummary[]> {
  if (ownerGhiis.length === 0) return {};
  const ph = ownerGhiis.map(() => '?').join(',');
  const groups = db.prepare(
    `SELECT ownerGhii, conversationId, COUNT(*) as messageCount, MAX(createdAt) as updatedAt,
       SUM(CASE WHEN direction = 'inbound' AND readAt IS NULL THEN 1 ELSE 0 END) as unread
     FROM direct_messages WHERE ownerGhii IN (${ph})
     GROUP BY ownerGhii, conversationId`,
  ).all(...ownerGhiis) as Array<{ ownerGhii: string; conversationId: string; messageCount: number; updatedAt: string; unread: number }>;
  if (groups.length === 0) return {};

  // Last message per (owner, conversation): newest row — the row that fixes peer + lastMessage + direction.
  const lasts = db.prepare(
    `SELECT ownerGhii, conversationId, body, direction, senderGhii, recipientGhii FROM (
        SELECT ownerGhii, conversationId, body, direction, senderGhii, recipientGhii,
               ROW_NUMBER() OVER (PARTITION BY ownerGhii, conversationId ORDER BY createdAt DESC, id DESC) rn
        FROM direct_messages WHERE ownerGhii IN (${ph})
     ) WHERE rn = 1`,
  ).all(...ownerGhiis) as Array<{ ownerGhii: string; conversationId: string; body: string; direction: 'inbound' | 'outbound'; senderGhii: string; recipientGhii: string }>;
  // Thread subject: the earliest non-null subject (the message that opened it).
  const subjects = db.prepare(
    `SELECT ownerGhii, conversationId, subject FROM (
        SELECT ownerGhii, conversationId, subject,
               ROW_NUMBER() OVER (PARTITION BY ownerGhii, conversationId ORDER BY createdAt ASC, id ASC) rn
        FROM direct_messages WHERE ownerGhii IN (${ph}) AND subject IS NOT NULL
     ) WHERE rn = 1`,
  ).all(...ownerGhiis) as Array<{ ownerGhii: string; conversationId: string; subject: string }>;

  const ck = (o: string, c: string) => `${o} ${c}`;
  const lastBy = new Map(lasts.map(l => [ck(l.ownerGhii, l.conversationId), l]));
  const subjBy = new Map(subjects.map(s => [ck(s.ownerGhii, s.conversationId), s.subject]));

  const out: Record<string, ConversationSummary[]> = {};
  for (const g of groups) {
    const last = lastBy.get(ck(g.ownerGhii, g.conversationId));
    const lastDirection = (last?.direction ?? 'inbound') as 'inbound' | 'outbound';
    (out[g.ownerGhii] ??= []).push({
      conversationId: g.conversationId,
      peerGhii: last ? (lastDirection === 'inbound' ? last.senderGhii : last.recipientGhii) : '',
      subject: subjBy.get(ck(g.ownerGhii, g.conversationId)),
      lastMessage: last?.body ?? '',
      lastDirection,
      lastSenderGhii: last?.senderGhii ?? '',
      messageCount: g.messageCount,
      unread: g.unread,
      updatedAt: g.updatedAt,
    });
  }
  for (const arr of Object.values(out)) arr.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
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

export function listInboundWithAttachments(db: Database.Database, limit = 200): DirectMessageRecord[] {
  const rows = db.prepare(
    "SELECT * FROM direct_messages WHERE direction = 'inbound' AND attachments IS NOT NULL ORDER BY createdAt ASC LIMIT ?",
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

// ── Delivery telemetry ──

function deserializeLog(row: Record<string, unknown>): MessageDeliveryLog {
  const rec: MessageDeliveryLog = {
    id: row.id as string,
    messageId: row.messageId as string,
    origin: row.origin as MessageDeliveryLog['origin'],
    targetNodeId: row.targetNodeId as string,
    status: row.status as MessageDeliveryLog['status'],
    latencyMs: (row.latencyMs as number) ?? 0,
    createdAt: row.createdAt as string,
  };
  if (row.httpStatus != null) rec.httpStatus = row.httpStatus as number;
  if (row.errorMessage) rec.errorMessage = row.errorMessage as string;
  return rec;
}

export function appendMessageDeliveryLog(db: Database.Database, log: MessageDeliveryLog): void {
  db.prepare(
    `INSERT INTO message_delivery_log (id, messageId, origin, targetNodeId, status, httpStatus, errorMessage, latencyMs, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    log.id, log.messageId, log.origin, log.targetNodeId, log.status,
    log.httpStatus ?? null, log.errorMessage ?? null, log.latencyMs, log.createdAt,
  );
}

export function listMessageDeliveryLogs(db: Database.Database, limit = 100): MessageDeliveryLog[] {
  const rows = db.prepare('SELECT * FROM message_delivery_log ORDER BY createdAt DESC LIMIT ?').all(limit) as Record<string, unknown>[];
  return rows.map(deserializeLog);
}

export function getMessageDeliveryStats(db: Database.Database): MessageDeliveryStats {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const byStatus: Record<string, number> = {};
  const byStatus24h: Record<string, number> = {};
  for (const r of db.prepare('SELECT status, COUNT(*) c FROM message_delivery_log GROUP BY status').all() as Array<{ status: string; c: number }>) {
    byStatus[r.status] = r.c;
  }
  for (const r of db.prepare('SELECT status, COUNT(*) c FROM message_delivery_log WHERE createdAt >= ? GROUP BY status').all(since) as Array<{ status: string; c: number }>) {
    byStatus24h[r.status] = r.c;
  }
  const total = (db.prepare('SELECT COUNT(*) c FROM message_delivery_log').get() as { c: number }).c;
  const total24h = (db.prepare('SELECT COUNT(*) c FROM message_delivery_log WHERE createdAt >= ?').get(since) as { c: number }).c;
  const topTargetNodes = (db.prepare(
    `SELECT targetNodeId nodeId, COUNT(*) total,
            SUM(CASE WHEN status IN ('failed','undeliverable') THEN 1 ELSE 0 END) failed
     FROM message_delivery_log GROUP BY targetNodeId ORDER BY total DESC LIMIT 10`,
  ).all() as Array<{ nodeId: string; total: number; failed: number }>).map(r => ({ nodeId: r.nodeId, total: r.total, failed: r.failed ?? 0 }));
  return { total, total24h, byStatus, byStatus24h, topTargetNodes };
}

export function pruneMessageDeliveryLogs(db: Database.Database, keep = 10000): number {
  const info = db.prepare(
    `DELETE FROM message_delivery_log WHERE id NOT IN (
       SELECT id FROM message_delivery_log ORDER BY createdAt DESC LIMIT ?
     )`,
  ).run(keep);
  return info.changes;
}

// ── Group conversations ──
// Only a thread with more than two participants has a row. A pair thread derives its id from the
// two identities and stores nothing, so `getConversation` returning null means "ordinary pair".

function deserializeConversation(row: Record<string, unknown>): ConversationRecord {
  const record: ConversationRecord = {
    id: row.id as string,
    kind: 'group',
    participants: JSON.parse(row.participants as string) as string[],
    createdBy: row.createdBy as string,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
  if (row.subject) record.subject = row.subject as string;
  if (row.alias) record.alias = row.alias as string;
  return record;
}

export function createConversation(db: Database.Database, record: ConversationRecord): ConversationRecord {
  db.prepare(
    `INSERT INTO conversations (id, kind, subject, participants, createdBy, alias, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id,
    record.kind,
    record.subject ?? null,
    JSON.stringify(record.participants),
    record.createdBy,
    record.alias ?? null,
    record.createdAt,
    record.updatedAt,
  );
  return record;
}

export function getConversation(db: Database.Database, id: string): ConversationRecord | null {
  const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? deserializeConversation(row) : null;
}

export function updateConversation(
  db: Database.Database,
  id: string,
  updates: Partial<Pick<ConversationRecord, 'participants' | 'subject' | 'alias'>>,
): ConversationRecord | null {
  const existing = getConversation(db, id);
  if (!existing) return null;
  db.prepare(
    `UPDATE conversations
     SET participants = COALESCE(?, participants), subject = COALESCE(?, subject),
         alias = COALESCE(?, alias), updatedAt = ?
     WHERE id = ?`,
  ).run(
    updates.participants ? JSON.stringify(updates.participants) : null,
    updates.subject ?? null,
    updates.alias ?? null,
    new Date().toISOString(),
    id,
  );
  return getConversation(db, id);
}

/**
 * Every group thread `identity` participates in, newest first.
 *
 * Membership is a JSON array, so the match is a LIKE on the serialised form with the quotes
 * included: `"alice@node"` cannot match `"alice@node-2"` the way a bare substring would.
 */
export function listConversationsForParticipant(db: Database.Database, identity: string): ConversationRecord[] {
  const needle = `%${JSON.stringify(identity)}%`;
  const rows = db.prepare(
    'SELECT * FROM conversations WHERE participants LIKE ? ORDER BY updatedAt DESC',
  ).all(needle) as Record<string, unknown>[];
  return rows.map(deserializeConversation);
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
  origin?: ContactConsentRecord['origin'],
): ContactConsentRecord {
  const now = new Date().toISOString();
  const existing = getContact(db, ownerGhii, contactId);
  if (existing) {
    // Omitted origin keeps the row's origin — the DM gate must never downgrade a saved contact.
    db.prepare('UPDATE contact_consents SET state = ?, firstMessageId = COALESCE(?, firstMessageId), origin = COALESCE(?, origin), updatedAt = ? WHERE ownerGhii = ? AND contactId = ?')
      .run(state, firstMessageId ?? null, origin ?? null, now, ownerGhii, contactId);
  } else {
    db.prepare('INSERT INTO contact_consents (ownerGhii, contactId, state, firstMessageId, origin, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(ownerGhii, contactId, state, firstMessageId ?? null, origin ?? 'message', now, now);
  }
  return getContact(db, ownerGhii, contactId)!;
}

export function deleteContact(db: Database.Database, ownerGhii: string, contactId: string): boolean {
  const result = db.prepare('DELETE FROM contact_consents WHERE ownerGhii = ? AND contactId = ?').run(ownerGhii, contactId);
  return result.changes > 0;
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
