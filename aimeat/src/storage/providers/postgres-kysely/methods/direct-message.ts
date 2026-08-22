/**
 * @file src/storage/providers/postgres-kysely/methods/direct-message.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Direct-message domain for the Postgres+Kysely backend (DirectMessage / ContactConsent /
 *   MessageDeliveryLog). Backs human↔human (GHII) messaging + federation: the classic mailbox model
 *   (each side stores its own copy sharing mid/conversationId), inbox/conversation/thread listing,
 *   delivery + read lifecycle, per-pair contact consent (first-contact gate), and operator delivery
 *   telemetry. Translated 1:1 from the Prisma implementation (providers/mongodb/methods/messaging.ts):
 *   `id` is the composite mailbox-copy key `${mid}::${ownerGhii}`, `mid` the message uuid.
 * @version-history
 *   v1.4.0 — 2026-08-22 — Unread is ownerReadAt-based: `senderGhii <> ownerGhii AND ownerReadAt IS
 *     NULL` in all three counts, and markConversationRead stamps it in a SECOND statement so the
 *     read receipt stays inbound-only. `readAt` on that row is the RECIPIENT's read receipt, so the badge was cleared by somebody else's reading and could not be cleared by the owner's without faking one.
 *   v1.3.0 — 2026-08-22 — lastSenderGhii on both conversation summaries; listDmsAddressedTo honours
 *     groupScope (the thread's rows in this identity's mailbox, minus what it sent itself).
 *   v1.2.0 — 2026-07-16 — Add getDirectMessagesByIds batch (Phase 3): many messages by id under one owner.
 *   v1.1.0 — 2026-07-16 — Add listConversationsForOwners batch (Phase 3): conversations list for many owners
 *     in 3 window-function queries, collapsing the route's owner + per-agent fan-out.
 *   v1.0.0 — 2026-07-15 — Phase 5: direct messages on Postgres+Kysely.
 */
import { sql } from 'kysely';
import type { Selectable } from 'kysely';
import type { DirectMessageRecord, ContactConsentRecord, ConversationRecord, MessageDeliveryLog, MessageDeliveryStats } from '../../../interface.js';
import type { ConversationSummary } from '../../../repositories/direct-message.repository.js';
import type { DirectMessage, ContactConsent, Conversation as ConversationRow, JsonValue, MessageDeliveryLog as MessageDeliveryLogRow } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();

/** Composite _id for one mailbox copy of a message (sender + recipient each store their own row). */
const dmDocId = (mid: string, ownerGhii: string): string => `${mid}::${ownerGhii}`;
/** Composite _id for a per-pair contact-consent record. */
const contactDocId = (ownerGhii: string, contactId: string): string => `${ownerGhii}::${contactId}`;

function toDirectMessageRecord(r: Selectable<DirectMessage>): DirectMessageRecord {
  const record: DirectMessageRecord = {
    id: r.mid,
    ownerGhii: r.ownerGhii,
    conversationId: r.conversationId,
    senderGhii: r.senderGhii,
    recipientGhii: r.recipientGhii,
    body: r.body ?? '',
    status: r.status as DirectMessageRecord['status'],
    direction: r.direction as DirectMessageRecord['direction'],
    origin: r.origin as DirectMessageRecord['origin'],
    originNodeId: r.originNodeId,
    createdAt: iso(r.createdAt),
  };
  if (r.subject) record.subject = r.subject;
  if (r.attachments) record.attachments = r.attachments as unknown as DirectMessageRecord['attachments'];
  if (r.interactive) record.interactive = r.interactive as unknown as DirectMessageRecord['interactive'];
  if (r.broadcastId) record.broadcastId = r.broadcastId;
  if (r.respondable != null) record.respondable = r.respondable;
  if (r.kind) record.kind = r.kind as DirectMessageRecord['kind'];
  if (r.replyToId) record.replyToId = r.replyToId;
  if (r.error) record.error = r.error;
  if (r.aiProvenanceId) record.aiProvenanceId = r.aiProvenanceId;
  if (r.deliveredAt) record.deliveredAt = iso(r.deliveredAt);
  if (r.readAt) record.readAt = iso(r.readAt);
  if (r.ownerReadAt) record.ownerReadAt = iso(r.ownerReadAt);
  return record;
}

function toConversationRecord(r: Selectable<ConversationRow>): ConversationRecord {
  const record: ConversationRecord = {
    id: r.id,
    kind: 'group',
    participants: (r.participants ?? []) as unknown as string[],
    createdBy: r.createdBy,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
  if (r.subject) record.subject = r.subject;
  if (r.alias) record.alias = r.alias;
  return record;
}

function toContactRecord(r: Selectable<ContactConsent>): ContactConsentRecord {
  const record: ContactConsentRecord = {
    ownerGhii: r.ownerGhii,
    contactId: r.contactId,
    state: r.state as ContactConsentRecord['state'],
    origin: r.origin === 'saved' ? 'saved' : 'message',
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
  if (r.firstMessageId) record.firstMessageId = r.firstMessageId;
  return record;
}

function toMessageDeliveryLog(r: Selectable<MessageDeliveryLogRow>): MessageDeliveryLog {
  const rec: MessageDeliveryLog = {
    id: r.id, messageId: r.messageId, origin: r.origin as MessageDeliveryLog['origin'], targetNodeId: r.targetNodeId,
    status: r.status as MessageDeliveryLog['status'], latencyMs: r.latencyMs ?? 0, createdAt: iso(r.createdAt),
  };
  if (r.httpStatus != null) rec.httpStatus = r.httpStatus;
  if (r.errorMessage) rec.errorMessage = r.errorMessage;
  return rec;
}

export const directMessageMethods = {
  // ── Messages ──
  async createDirectMessage(this: PostgresKyselyStorage, record: DirectMessageRecord): Promise<DirectMessageRecord> {
    await this.db.insertInto('DirectMessage').values({
      id: dmDocId(record.id, record.ownerGhii), mid: record.id, ownerGhii: record.ownerGhii, conversationId: record.conversationId,
      subject: record.subject ?? null, senderGhii: record.senderGhii, recipientGhii: record.recipientGhii, body: record.body,
      attachments: jsonb(record.attachments ?? null), interactive: jsonb(record.interactive ?? null), broadcastId: record.broadcastId ?? null,
      respondable: record.respondable ?? null, kind: record.kind ?? null, status: record.status, direction: record.direction, replyToId: record.replyToId ?? null,
      origin: record.origin, originNodeId: record.originNodeId, error: record.error ?? null,
      aiProvenanceId: record.aiProvenanceId ?? null, createdAt: new Date(record.createdAt),
      deliveredAt: record.deliveredAt ? new Date(record.deliveredAt) : null, readAt: record.readAt ? new Date(record.readAt) : null,
      ownerReadAt: record.ownerReadAt ? new Date(record.ownerReadAt) : null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
    return record;
  },

  async getDirectMessage(this: PostgresKyselyStorage, id: string, ownerGhii: string): Promise<DirectMessageRecord | null> {
    const r = await this.db.selectFrom('DirectMessage').selectAll().where('id', '=', dmDocId(id, ownerGhii)).executeTakeFirst();
    return r ? toDirectMessageRecord(r) : null;
  },

  // BULK (Phase 3) — many messages by id under one owner mailbox in ONE `id IN (…)` query (PG `id` = mid::owner).
  async getDirectMessagesByIds(this: PostgresKyselyStorage, ids: string[], ownerGhii: string): Promise<DirectMessageRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.selectFrom('DirectMessage').selectAll().where('id', 'in', ids.map(id => dmDocId(id, ownerGhii))).execute();
    return rows.map(toDirectMessageRecord);
  },

  async listInbox(this: PostgresKyselyStorage, ownerGhii: string, opts?: { unreadOnly?: boolean; page?: number; perPage?: number }): Promise<{ messages: DirectMessageRecord[]; total: number; unread: number }> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 20;
    let base = this.db.selectFrom('DirectMessage').where('ownerGhii', '=', ownerGhii).where('direction', '=', 'inbound');
    if (opts?.unreadOnly) base = base.where('readAt', 'is', null);
    const rows = await base.selectAll().orderBy('createdAt', 'desc').limit(perPage).offset((page - 1) * perPage).execute();
    const totalRow = await base.select(this.db.fn.countAll<number>().as('n')).executeTakeFirst();
    const unreadRow = await this.db.selectFrom('DirectMessage').select(this.db.fn.countAll<number>().as('n'))
      .where('ownerGhii', '=', ownerGhii).whereRef('senderGhii', '<>', 'ownerGhii').where('ownerReadAt', 'is', null).executeTakeFirst();
    return { messages: rows.map(toDirectMessageRecord), total: Number(totalRow?.n ?? 0), unread: Number(unreadRow?.n ?? 0) };
  },

  async listConversation(this: PostgresKyselyStorage, ownerGhii: string, conversationId: string, opts?: { page?: number; perPage?: number }): Promise<{ messages: DirectMessageRecord[]; total: number }> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 50;
    const base = this.db.selectFrom('DirectMessage').where('ownerGhii', '=', ownerGhii).where('conversationId', '=', conversationId);
    const rows = await base.selectAll().orderBy('createdAt', 'desc').limit(perPage).offset((page - 1) * perPage).execute();
    const totalRow = await base.select(this.db.fn.countAll<number>().as('n')).executeTakeFirst();
    return { messages: rows.map(toDirectMessageRecord), total: Number(totalRow?.n ?? 0) };
  },

  async listDmsAddressedTo(this: PostgresKyselyStorage, recipientGhii: string, opts?: { page?: number; perPage?: number; groupScope?: { mailboxGhii: string; conversationIds: string[] } }): Promise<{ messages: DirectMessageRecord[]; total: number }> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 20;
    const group = opts?.groupScope;
    // A group message is addressed to the THREAD, so the recipient match below never finds one. When the
    // caller has established membership, the thread's rows in this identity's mailbox count as addressed
    // to it — minus what it sent itself, which belongs in a sent view and not in an inbox.
    const base = this.db.selectFrom('DirectMessage').where(eb => {
      const direct = eb.and([eb('recipientGhii', '=', recipientGhii), eb('direction', '=', 'inbound')]);
      if (!group?.conversationIds.length) return direct;
      return eb.or([direct, eb.and([
        eb('ownerGhii', '=', group.mailboxGhii),
        eb('conversationId', 'in', group.conversationIds),
        eb('senderGhii', '<>', recipientGhii),
      ])]);
    });
    const rows = await base.selectAll().orderBy('createdAt', 'desc').limit(perPage).offset((page - 1) * perPage).execute();
    const totalRow = await base.select(this.db.fn.countAll<number>().as('n')).executeTakeFirst();
    return { messages: rows.map(toDirectMessageRecord), total: Number(totalRow?.n ?? 0) };
  },

  async listAgentDmThread(this: PostgresKyselyStorage, agentGaii: string, conversationId: string, opts?: { page?: number; perPage?: number }): Promise<{ messages: DirectMessageRecord[]; total: number }> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 50;
    // Agent's own sent copies (ownerGhii=agent, outbound) + inbound copies addressed to it. No overlap.
    const base = this.db.selectFrom('DirectMessage').where('conversationId', '=', conversationId).where(eb => eb.or([
      eb.and([eb('ownerGhii', '=', agentGaii), eb('direction', '=', 'outbound')]),
      eb.and([eb('recipientGhii', '=', agentGaii), eb('direction', '=', 'inbound')]),
    ]));
    const rows = await base.selectAll().orderBy('createdAt', 'desc').limit(perPage).offset((page - 1) * perPage).execute();
    const totalRow = await base.select(this.db.fn.countAll<number>().as('n')).executeTakeFirst();
    return { messages: rows.map(toDirectMessageRecord), total: Number(totalRow?.n ?? 0) };
  },

  async listDmsByBroadcast(this: PostgresKyselyStorage, broadcastId: string, ownerGhii: string): Promise<DirectMessageRecord[]> {
    const rows = await this.db.selectFrom('DirectMessage').selectAll()
      .where('broadcastId', '=', broadcastId).where('ownerGhii', '=', ownerGhii).orderBy('createdAt', 'asc').execute();
    return rows.map(toDirectMessageRecord);
  },

  async listConversations(this: PostgresKyselyStorage, ownerGhii: string): Promise<ConversationSummary[]> {
    const groups = await this.db.selectFrom('DirectMessage')
      .select(['conversationId', this.db.fn.countAll<number>().as('messageCount'), sql<Date | null>`max("createdAt")`.as('updatedAt')])
      .where('ownerGhii', '=', ownerGhii).groupBy('conversationId').execute();

    const results: ConversationSummary[] = [];
    for (const g of groups) {
      const last = await this.db.selectFrom('DirectMessage').select(['body', 'direction', 'senderGhii', 'recipientGhii'])
        .where('ownerGhii', '=', ownerGhii).where('conversationId', '=', g.conversationId).orderBy('createdAt', 'desc').limit(1).executeTakeFirst();
      const unreadRow = await this.db.selectFrom('DirectMessage').select(this.db.fn.countAll<number>().as('n'))
        .where('ownerGhii', '=', ownerGhii).where('conversationId', '=', g.conversationId).whereRef('senderGhii', '<>', 'ownerGhii').where('ownerReadAt', 'is', null).executeTakeFirst();
      // Thread subject = the one set on the message that opened it (earliest non-null subject).
      const subj = await this.db.selectFrom('DirectMessage').select('subject')
        .where('ownerGhii', '=', ownerGhii).where('conversationId', '=', g.conversationId).where('subject', 'is not', null).orderBy('createdAt', 'asc').limit(1).executeTakeFirst();
      const lastDirection = (last?.direction ?? 'inbound') as 'inbound' | 'outbound';
      results.push({
        conversationId: g.conversationId,
        peerGhii: last ? (lastDirection === 'inbound' ? last.senderGhii : last.recipientGhii) : '',
        subject: subj?.subject ?? undefined,
        lastMessage: last?.body ?? '',
        lastDirection,
        lastSenderGhii: last?.senderGhii ?? '',
        messageCount: Number(g.messageCount ?? 0),
        unread: Number(unreadRow?.n ?? 0),
        updatedAt: g.updatedAt ? iso(g.updatedAt) : '',
      });
    }
    results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return results;
  },

  // BULK (Phase 3) — the conversations list for MANY owners in ONE grouped aggregate + ONE last-message +
  // ONE subject query (window functions), independent of owner count. Same per-thread rules as
  // listConversations (peer from the newest row's direction, earliest non-null subject, inbound-unread
  // count), keyed by ownerGhii so the route's owner + per-agent fan-out collapses to this one call.
  async listConversationsForOwners(this: PostgresKyselyStorage, ownerGhiis: string[]): Promise<Record<string, ConversationSummary[]>> {
    if (ownerGhiis.length === 0) return {};
    const owners = sql.join(ownerGhiis);
    const groups = await sql<{ ownerGhii: string; conversationId: string; messageCount: string | number; updatedAt: Date | string | null; unread: string | number }>`
      SELECT "ownerGhii", "conversationId", COUNT(*) AS "messageCount", MAX("createdAt") AS "updatedAt",
             SUM(CASE WHEN "senderGhii" <> "ownerGhii" AND "ownerReadAt" IS NULL THEN 1 ELSE 0 END) AS "unread"
      FROM "DirectMessage" WHERE "ownerGhii" IN (${owners})
      GROUP BY "ownerGhii", "conversationId"
    `.execute(this.db);
    if (groups.rows.length === 0) return {};

    const lasts = await sql<{ ownerGhii: string; conversationId: string; body: string; direction: 'inbound' | 'outbound'; senderGhii: string; recipientGhii: string }>`
      SELECT "ownerGhii", "conversationId", "body", "direction", "senderGhii", "recipientGhii" FROM (
        SELECT "ownerGhii", "conversationId", "body", "direction", "senderGhii", "recipientGhii",
               ROW_NUMBER() OVER (PARTITION BY "ownerGhii", "conversationId" ORDER BY "createdAt" DESC, "id" DESC) AS rn
        FROM "DirectMessage" WHERE "ownerGhii" IN (${owners})
      ) t WHERE rn = 1
    `.execute(this.db);
    const subjects = await sql<{ ownerGhii: string; conversationId: string; subject: string }>`
      SELECT "ownerGhii", "conversationId", "subject" FROM (
        SELECT "ownerGhii", "conversationId", "subject",
               ROW_NUMBER() OVER (PARTITION BY "ownerGhii", "conversationId" ORDER BY "createdAt" ASC, "id" ASC) AS rn
        FROM "DirectMessage" WHERE "ownerGhii" IN (${owners}) AND "subject" IS NOT NULL
      ) t WHERE rn = 1
    `.execute(this.db);

    const ck = (o: string, c: string) => `${o} ${c}`;
    const lastBy = new Map(lasts.rows.map(l => [ck(l.ownerGhii, l.conversationId), l]));
    const subjBy = new Map(subjects.rows.map(s => [ck(s.ownerGhii, s.conversationId), s.subject]));

    const out: Record<string, ConversationSummary[]> = {};
    for (const g of groups.rows) {
      const last = lastBy.get(ck(g.ownerGhii, g.conversationId));
      const lastDirection = (last?.direction ?? 'inbound') as 'inbound' | 'outbound';
      (out[g.ownerGhii] ??= []).push({
        conversationId: g.conversationId,
        peerGhii: last ? (lastDirection === 'inbound' ? last.senderGhii : last.recipientGhii) : '',
        subject: subjBy.get(ck(g.ownerGhii, g.conversationId)),
        lastMessage: last?.body ?? '',
        lastDirection,
        lastSenderGhii: last?.senderGhii ?? '',
        messageCount: Number(g.messageCount ?? 0),
        unread: Number(g.unread ?? 0),
        updatedAt: g.updatedAt ? iso(g.updatedAt) : '',
      });
    }
    for (const arr of Object.values(out)) arr.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return out;
  },

  async markMessageRead(this: PostgresKyselyStorage, id: string, ownerGhii: string): Promise<DirectMessageRecord | null> {
    const rows = await this.db.updateTable('DirectMessage').set({ status: 'read', readAt: new Date(), ownerReadAt: new Date() })
      .where('id', '=', dmDocId(id, ownerGhii)).returningAll().execute();
    return rows[0] ? toDirectMessageRecord(rows[0]) : null;
  },

  async markConversationRead(this: PostgresKyselyStorage, ownerGhii: string, conversationId: string): Promise<number> {
    const now = new Date();
    // Two statements because they say two different things. The first is the read RECEIPT the sender
    // is owed, and it belongs to inbound rows only: writing `status: 'read'` on an outbound row means
    // "the recipient read it", which nobody did.
    await this.db.updateTable('DirectMessage').set({ status: 'read', readAt: now })
      .where('ownerGhii', '=', ownerGhii).where('conversationId', '=', conversationId).where('direction', '=', 'inbound').where('readAt', 'is', null).executeTakeFirst();
    // The second is this owner having looked at the thread, which covers every row they did not write
    // themselves — including their own agent's copy in a group thread, the row the badge was blind to.
    const seen = await this.db.updateTable('DirectMessage').set({ ownerReadAt: now })
      .where('ownerGhii', '=', ownerGhii).where('conversationId', '=', conversationId).whereRef('senderGhii', '<>', 'ownerGhii').where('ownerReadAt', 'is', null).executeTakeFirst();
    return Number(seen.numUpdatedRows ?? 0);
  },

  async updateMessageDeliveryStatus(this: PostgresKyselyStorage, id: string, status: DirectMessageRecord['status'], extra?: { deliveredAt?: string; error?: string }): Promise<DirectMessageRecord | null> {
    // Delivery status lives on the sender's (outbound) copy.
    const outbound = await this.db.selectFrom('DirectMessage').select('id').where('mid', '=', id).where('direction', '=', 'outbound').executeTakeFirst();
    if (!outbound) return null;
    const data: Record<string, unknown> = { status };
    if (extra?.deliveredAt) data.deliveredAt = new Date(extra.deliveredAt);
    if (extra?.error !== undefined) data.error = extra.error;
    const rows = await this.db.updateTable('DirectMessage').set(data as never).where('id', '=', outbound.id).returningAll().execute();
    return rows[0] ? toDirectMessageRecord(rows[0]) : null;
  },

  async setMessageReadReceipt(this: PostgresKyselyStorage, id: string, readAt: string): Promise<DirectMessageRecord | null> {
    const outbound = await this.db.selectFrom('DirectMessage').select('id').where('mid', '=', id).where('direction', '=', 'outbound').executeTakeFirst();
    if (!outbound) return null;
    const rows = await this.db.updateTable('DirectMessage').set({ status: 'read', readAt: new Date(readAt) }).where('id', '=', outbound.id).returningAll().execute();
    return rows[0] ? toDirectMessageRecord(rows[0]) : null;
  },

  async listOutboundForRetry(this: PostgresKyselyStorage, limit = 200): Promise<DirectMessageRecord[]> {
    const rows = await this.db.selectFrom('DirectMessage').selectAll()
      .where('direction', '=', 'outbound').where('status', 'in', ['queued', 'failed']).orderBy('createdAt', 'asc').limit(limit).execute();
    return rows.map(toDirectMessageRecord);
  },

  async listInboundWithAttachments(this: PostgresKyselyStorage, limit = 200): Promise<DirectMessageRecord[]> {
    const rows = await this.db.selectFrom('DirectMessage').selectAll()
      .where('direction', '=', 'inbound').where('attachments', 'is not', null).orderBy('createdAt', 'asc').limit(limit).execute();
    return rows.map(toDirectMessageRecord);
  },

  async updateMessageAttachments(this: PostgresKyselyStorage, id: string, ownerGhii: string, attachments: DirectMessageRecord['attachments']): Promise<DirectMessageRecord | null> {
    const rows = await this.db.updateTable('DirectMessage').set({ attachments: jsonb(attachments ?? null) as never })
      .where('id', '=', dmDocId(id, ownerGhii)).returningAll().execute();
    return rows[0] ? toDirectMessageRecord(rows[0]) : null;
  },

  async deleteDirectMessage(this: PostgresKyselyStorage, id: string, ownerGhii: string): Promise<boolean> {
    const r = await this.db.deleteFrom('DirectMessage').where('id', '=', dmDocId(id, ownerGhii)).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  // ── Delivery telemetry (operator dashboard; no content/identities) ──
  async appendMessageDeliveryLog(this: PostgresKyselyStorage, log: MessageDeliveryLog): Promise<void> {
    await this.db.insertInto('MessageDeliveryLog').values({
      id: log.id, messageId: log.messageId, origin: log.origin, targetNodeId: log.targetNodeId, status: log.status,
      httpStatus: log.httpStatus ?? null, errorMessage: log.errorMessage ?? null, latencyMs: log.latencyMs, createdAt: new Date(log.createdAt),
    }).execute();
  },

  async listMessageDeliveryLogs(this: PostgresKyselyStorage, limit = 100): Promise<MessageDeliveryLog[]> {
    const rows = await this.db.selectFrom('MessageDeliveryLog').selectAll().orderBy('createdAt', 'desc').limit(limit).execute();
    return rows.map(toMessageDeliveryLog);
  },

  async getMessageDeliveryStats(this: PostgresKyselyStorage): Promise<MessageDeliveryStats> {
    const since = new Date(Date.now() - 24 * 3600_000);
    const [all, recent] = await Promise.all([
      this.db.selectFrom('MessageDeliveryLog').select(['status', this.db.fn.countAll<number>().as('n')]).groupBy('status').execute(),
      this.db.selectFrom('MessageDeliveryLog').select(['status', this.db.fn.countAll<number>().as('n')]).where('createdAt', '>=', since).groupBy('status').execute(),
    ]);
    const byStatus: Record<string, number> = {};
    const byStatus24h: Record<string, number> = {};
    let total = 0, total24h = 0;
    for (const r of all) { byStatus[r.status] = Number(r.n); total += Number(r.n); }
    for (const r of recent) { byStatus24h[r.status] = Number(r.n); total24h += Number(r.n); }
    const nodes = await this.db.selectFrom('MessageDeliveryLog')
      .select([
        'targetNodeId',
        this.db.fn.countAll<number>().as('total'),
        sql<string>`sum(case when status in ('failed','undeliverable') then 1 else 0 end)`.as('failed'),
      ])
      .groupBy('targetNodeId').orderBy('total', 'desc').limit(10).execute();
    const topTargetNodes = nodes.map(n => ({ nodeId: n.targetNodeId, total: Number(n.total), failed: Number(n.failed ?? 0) }));
    return { total, total24h, byStatus, byStatus24h, topTargetNodes };
  },

  async pruneMessageDeliveryLogs(this: PostgresKyselyStorage, keep = 10000): Promise<number> {
    const cutoff = await this.db.selectFrom('MessageDeliveryLog').select('createdAt')
      .orderBy('createdAt', 'desc').offset(keep).limit(1).executeTakeFirst();
    if (!cutoff) return 0;
    const r = await this.db.deleteFrom('MessageDeliveryLog').where('createdAt', '<', cutoff.createdAt).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },

  // ── Group conversations (only a >2-participant thread has a row) ──
  async createConversation(this: PostgresKyselyStorage, record: ConversationRecord): Promise<ConversationRecord> {
    await this.db.insertInto('Conversation').values({
      id: record.id,
      kind: record.kind,
      subject: record.subject ?? null,
      // jsonb() is a `::jsonb` sql fragment; Kysely types the column as the parsed JSON value, so the
      // cast is the parameter-vs-value distinction rather than a type being dodged.
      participants: jsonb(record.participants) as unknown as JsonValue,
      createdBy: record.createdBy,
      alias: record.alias ?? null,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
    }).execute();
    return record;
  },

  async getConversation(this: PostgresKyselyStorage, id: string): Promise<ConversationRecord | null> {
    const r = await this.db.selectFrom('Conversation').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toConversationRecord(r) : null;
  },

  async updateConversation(
    this: PostgresKyselyStorage,
    id: string,
    updates: Partial<Pick<ConversationRecord, 'participants' | 'subject' | 'alias'>>,
  ): Promise<ConversationRecord | null> {
    const rows = await this.db.updateTable('Conversation').set({
      ...(updates.participants ? { participants: jsonb(updates.participants) as unknown as JsonValue } : {}),
      ...(updates.subject !== undefined ? { subject: updates.subject } : {}),
      ...(updates.alias !== undefined ? { alias: updates.alias } : {}),
      updatedAt: new Date(),
    }).where('id', '=', id).returningAll().execute();
    return rows[0] ? toConversationRecord(rows[0]) : null;
  },

  async listConversationsForParticipant(this: PostgresKyselyStorage, identity: string): Promise<ConversationRecord[]> {
    // Membership is a JSONB array, so this is a containment test rather than a string match: it
    // cannot confuse `alice@node` with `alice@node-2` the way a LIKE would.
    const rows = await this.db.selectFrom('Conversation').selectAll()
      .where(sql<boolean>`"participants" @> ${jsonb([identity])}`)
      .orderBy('updatedAt', 'desc').execute();
    return rows.map(toConversationRecord);
  },

  // ── Contact consent (first-contact gate) ──
  async getContact(this: PostgresKyselyStorage, ownerGhii: string, contactId: string): Promise<ContactConsentRecord | null> {
    const r = await this.db.selectFrom('ContactConsent').selectAll().where('id', '=', contactDocId(ownerGhii, contactId)).executeTakeFirst();
    return r ? toContactRecord(r) : null;
  },

  async setContactState(this: PostgresKyselyStorage, ownerGhii: string, contactId: string, state: ContactConsentRecord['state'], firstMessageId?: string, origin?: ContactConsentRecord['origin']): Promise<ContactConsentRecord> {
    const now = new Date();
    const id = contactDocId(ownerGhii, contactId);
    // Omitted origin keeps an existing row's origin — the DM gate must never downgrade a saved contact.
    const rows = await this.db.insertInto('ContactConsent').values({
      id, ownerGhii, contactId, state, firstMessageId: firstMessageId ?? null, origin: origin ?? 'message', createdAt: now, updatedAt: now,
    }).onConflict(oc => oc.column('id').doUpdateSet({
      state, updatedAt: now, ...(firstMessageId ? { firstMessageId } : {}), ...(origin ? { origin } : {}),
    })).returningAll().execute();
    return toContactRecord(rows[0]);
  },

  async listContacts(this: PostgresKyselyStorage, ownerGhii: string, opts?: { state?: ContactConsentRecord['state'] }): Promise<ContactConsentRecord[]> {
    let q = this.db.selectFrom('ContactConsent').selectAll().where('ownerGhii', '=', ownerGhii);
    if (opts?.state) q = q.where('state', '=', opts.state);
    return (await q.orderBy('updatedAt', 'desc').execute()).map(toContactRecord);
  },

  async deleteContact(this: PostgresKyselyStorage, ownerGhii: string, contactId: string): Promise<boolean> {
    const r = await this.db.deleteFrom('ContactConsent').where('id', '=', contactDocId(ownerGhii, contactId)).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },
};
