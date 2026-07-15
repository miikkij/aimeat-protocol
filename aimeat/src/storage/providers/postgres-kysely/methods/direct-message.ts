/**
 * @file src/storage/providers/postgres-kysely/methods/direct-message.ts
 * @description Direct-message domain for the Postgres+Kysely backend (DirectMessage / ContactConsent /
 *   MessageDeliveryLog). Backs human↔human (GHII) messaging + federation: the classic mailbox model
 *   (each side stores its own copy sharing mid/conversationId), inbox/conversation/thread listing,
 *   delivery + read lifecycle, per-pair contact consent (first-contact gate), and operator delivery
 *   telemetry. Translated 1:1 from the Prisma implementation (providers/mongodb/methods/messaging.ts):
 *   `id` is the composite mailbox-copy key `${mid}::${ownerGhii}`, `mid` the message uuid.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: direct messages on Postgres+Kysely.
 */
import { sql } from 'kysely';
import type { Selectable } from 'kysely';
import type { DirectMessageRecord, ContactConsentRecord, MessageDeliveryLog, MessageDeliveryStats } from '../../../interface.js';
import type { DirectMessage, ContactConsent, MessageDeliveryLog as MessageDeliveryLogRow } from '../db-types.js';
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
  if (r.replyToId) record.replyToId = r.replyToId;
  if (r.error) record.error = r.error;
  if (r.deliveredAt) record.deliveredAt = iso(r.deliveredAt);
  if (r.readAt) record.readAt = iso(r.readAt);
  return record;
}

function toContactRecord(r: Selectable<ContactConsent>): ContactConsentRecord {
  const record: ContactConsentRecord = {
    ownerGhii: r.ownerGhii,
    contactId: r.contactId,
    state: r.state as ContactConsentRecord['state'],
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
      respondable: record.respondable ?? null, status: record.status, direction: record.direction, replyToId: record.replyToId ?? null,
      origin: record.origin, originNodeId: record.originNodeId, error: record.error ?? null, createdAt: new Date(record.createdAt),
      deliveredAt: record.deliveredAt ? new Date(record.deliveredAt) : null, readAt: record.readAt ? new Date(record.readAt) : null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
    return record;
  },

  async getDirectMessage(this: PostgresKyselyStorage, id: string, ownerGhii: string): Promise<DirectMessageRecord | null> {
    const r = await this.db.selectFrom('DirectMessage').selectAll().where('id', '=', dmDocId(id, ownerGhii)).executeTakeFirst();
    return r ? toDirectMessageRecord(r) : null;
  },

  async listInbox(this: PostgresKyselyStorage, ownerGhii: string, opts?: { unreadOnly?: boolean; page?: number; perPage?: number }): Promise<{ messages: DirectMessageRecord[]; total: number; unread: number }> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 20;
    let base = this.db.selectFrom('DirectMessage').where('ownerGhii', '=', ownerGhii).where('direction', '=', 'inbound');
    if (opts?.unreadOnly) base = base.where('readAt', 'is', null);
    const rows = await base.selectAll().orderBy('createdAt', 'desc').limit(perPage).offset((page - 1) * perPage).execute();
    const totalRow = await base.select(this.db.fn.countAll<number>().as('n')).executeTakeFirst();
    const unreadRow = await this.db.selectFrom('DirectMessage').select(this.db.fn.countAll<number>().as('n'))
      .where('ownerGhii', '=', ownerGhii).where('direction', '=', 'inbound').where('readAt', 'is', null).executeTakeFirst();
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

  async listDmsAddressedTo(this: PostgresKyselyStorage, recipientGhii: string, opts?: { page?: number; perPage?: number }): Promise<{ messages: DirectMessageRecord[]; total: number }> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 20;
    const base = this.db.selectFrom('DirectMessage').where('recipientGhii', '=', recipientGhii).where('direction', '=', 'inbound');
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

  async listConversations(this: PostgresKyselyStorage, ownerGhii: string): Promise<Array<{ conversationId: string; peerGhii: string; subject?: string; lastMessage: string; lastDirection: 'inbound' | 'outbound'; messageCount: number; unread: number; updatedAt: string }>> {
    const groups = await this.db.selectFrom('DirectMessage')
      .select(['conversationId', this.db.fn.countAll<number>().as('messageCount'), sql<Date | null>`max("createdAt")`.as('updatedAt')])
      .where('ownerGhii', '=', ownerGhii).groupBy('conversationId').execute();

    const results: Array<{ conversationId: string; peerGhii: string; subject?: string; lastMessage: string; lastDirection: 'inbound' | 'outbound'; messageCount: number; unread: number; updatedAt: string }> = [];
    for (const g of groups) {
      const last = await this.db.selectFrom('DirectMessage').select(['body', 'direction', 'senderGhii', 'recipientGhii'])
        .where('ownerGhii', '=', ownerGhii).where('conversationId', '=', g.conversationId).orderBy('createdAt', 'desc').limit(1).executeTakeFirst();
      const unreadRow = await this.db.selectFrom('DirectMessage').select(this.db.fn.countAll<number>().as('n'))
        .where('ownerGhii', '=', ownerGhii).where('conversationId', '=', g.conversationId).where('direction', '=', 'inbound').where('readAt', 'is', null).executeTakeFirst();
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
        messageCount: Number(g.messageCount ?? 0),
        unread: Number(unreadRow?.n ?? 0),
        updatedAt: g.updatedAt ? iso(g.updatedAt) : '',
      });
    }
    results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return results;
  },

  async markMessageRead(this: PostgresKyselyStorage, id: string, ownerGhii: string): Promise<DirectMessageRecord | null> {
    const rows = await this.db.updateTable('DirectMessage').set({ status: 'read', readAt: new Date() })
      .where('id', '=', dmDocId(id, ownerGhii)).returningAll().execute();
    return rows[0] ? toDirectMessageRecord(rows[0]) : null;
  },

  async markConversationRead(this: PostgresKyselyStorage, ownerGhii: string, conversationId: string): Promise<number> {
    const r = await this.db.updateTable('DirectMessage').set({ status: 'read', readAt: new Date() })
      .where('ownerGhii', '=', ownerGhii).where('conversationId', '=', conversationId).where('direction', '=', 'inbound').where('readAt', 'is', null).executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0);
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

  // ── Contact consent (first-contact gate) ──
  async getContact(this: PostgresKyselyStorage, ownerGhii: string, contactId: string): Promise<ContactConsentRecord | null> {
    const r = await this.db.selectFrom('ContactConsent').selectAll().where('id', '=', contactDocId(ownerGhii, contactId)).executeTakeFirst();
    return r ? toContactRecord(r) : null;
  },

  async setContactState(this: PostgresKyselyStorage, ownerGhii: string, contactId: string, state: ContactConsentRecord['state'], firstMessageId?: string): Promise<ContactConsentRecord> {
    const now = new Date();
    const id = contactDocId(ownerGhii, contactId);
    const rows = await this.db.insertInto('ContactConsent').values({
      id, ownerGhii, contactId, state, firstMessageId: firstMessageId ?? null, createdAt: now, updatedAt: now,
    }).onConflict(oc => oc.column('id').doUpdateSet({
      state, updatedAt: now, ...(firstMessageId ? { firstMessageId } : {}),
    })).returningAll().execute();
    return toContactRecord(rows[0]);
  },

  async listContacts(this: PostgresKyselyStorage, ownerGhii: string, opts?: { state?: ContactConsentRecord['state'] }): Promise<ContactConsentRecord[]> {
    let q = this.db.selectFrom('ContactConsent').selectAll().where('ownerGhii', '=', ownerGhii);
    if (opts?.state) q = q.where('state', '=', opts.state);
    return (await q.orderBy('updatedAt', 'desc').execute()).map(toContactRecord);
  },
};
