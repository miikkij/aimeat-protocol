/**
 * @file src/storage/providers/postgres-kysely/methods/outbound.ts
 * @description Postgres+Kysely implementation of the outbound door (recipient registry +
 *   send log). Schema: migrations/0027_outbound.sql. Email lookups compare lower-cased,
 *   matching the unique index — the same address with different casing is one contact.
 * @structure outboundMethods — contacts · send log
 * @usage merged onto PostgresKyselyStorage.prototype in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 2.
 */
import { sql, type Selectable } from 'kysely';
import type { OutboundRepository } from '../../../repositories/outbound.repository.js';
import type {
  OutboundContactRecord, OutboundContactQuery,
  OutboundMessageRecord, OutboundLogQuery, OutboundChannel, OutboundKind, OutboundStatus,
} from '../../../../models/outbound-schemas.js';
import type { OutboundContact as ContactRow, OutboundMessage as MessageRow, Json } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

function toContact(r: Selectable<ContactRow>): OutboundContactRecord {
  return {
    id: r.id,
    ownerGhii: r.ownerGhii,
    name: r.name,
    email: r.email,
    ghii: r.ghii ?? null,
    tags: (r.tags as string[] | null) ?? [],
    optedOut: r.optedOut,
    optOutAt: r.optOutAt ?? null,
    optOutToken: r.optOutToken,
    bounceCount: r.bounceCount,
    suppressedAt: r.suppressedAt ?? null,
    notes: r.notes ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toMessage(r: Selectable<MessageRow>): OutboundMessageRecord {
  return {
    id: r.id,
    ownerGhii: r.ownerGhii,
    contactId: r.contactId,
    channel: r.channel as OutboundChannel,
    kind: r.kind as OutboundKind,
    subject: r.subject,
    templateId: r.templateId ?? null,
    status: r.status as OutboundStatus,
    error: r.error ?? null,
    invoiceId: r.invoiceId ?? null,
    createdAt: r.createdAt,
  };
}

export const outboundMethods: OutboundRepository & ThisType<PostgresKyselyStorage> = {
  async createOutboundContact(this: PostgresKyselyStorage, row: OutboundContactRecord): Promise<void> {
    await this.db.insertInto('OutboundContact').values({
      id: row.id, ownerGhii: row.ownerGhii, name: row.name, email: row.email,
      ghii: row.ghii, tags: jsonb(row.tags) as unknown as Json,
      optedOut: row.optedOut, optOutAt: row.optOutAt, optOutToken: row.optOutToken,
      bounceCount: row.bounceCount, suppressedAt: row.suppressedAt, notes: row.notes,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    }).execute();
  },

  async getOutboundContact(this: PostgresKyselyStorage, id: string): Promise<OutboundContactRecord | undefined> {
    const r = await this.db.selectFrom('OutboundContact').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toContact(r) : undefined;
  },

  async findOutboundContactByEmail(this: PostgresKyselyStorage, ownerGhii: string, email: string): Promise<OutboundContactRecord | undefined> {
    const r = await this.db.selectFrom('OutboundContact').selectAll()
      .where('ownerGhii', '=', ownerGhii)
      .where(sql<boolean>`lower("email") = ${email.toLowerCase()}`)
      .executeTakeFirst();
    return r ? toContact(r) : undefined;
  },

  async findOutboundContactByToken(this: PostgresKyselyStorage, optOutToken: string): Promise<OutboundContactRecord | undefined> {
    const r = await this.db.selectFrom('OutboundContact').selectAll()
      .where('optOutToken', '=', optOutToken)
      .executeTakeFirst();
    return r ? toContact(r) : undefined;
  },

  async listOutboundContacts(this: PostgresKyselyStorage, query: OutboundContactQuery): Promise<OutboundContactRecord[]> {
    let q = this.db.selectFrom('OutboundContact').selectAll().where('ownerGhii', '=', query.ownerGhii);
    if (query.optedOut !== undefined) q = q.where('optedOut', '=', query.optedOut);
    if (query.suppressed !== undefined) q = query.suppressed ? q.where('suppressedAt', 'is not', null) : q.where('suppressedAt', 'is', null);
    if (query.tag) q = q.where(sql<boolean>`"tags" @> ${JSON.stringify([query.tag])}::jsonb`);
    q = q.orderBy('createdAt', 'desc');
    if (query.limit !== undefined) q = q.limit(query.limit);
    if (query.offset !== undefined) q = q.offset(query.offset);
    const rows = await q.execute();
    return rows.map(toContact);
  },

  async countOutboundContacts(this: PostgresKyselyStorage, query: OutboundContactQuery): Promise<number> {
    let q = this.db.selectFrom('OutboundContact').select(sql<number>`count(*)`.as('n')).where('ownerGhii', '=', query.ownerGhii);
    if (query.optedOut !== undefined) q = q.where('optedOut', '=', query.optedOut);
    if (query.suppressed !== undefined) q = query.suppressed ? q.where('suppressedAt', 'is not', null) : q.where('suppressedAt', 'is', null);
    if (query.tag) q = q.where(sql<boolean>`"tags" @> ${JSON.stringify([query.tag])}::jsonb`);
    const r = await q.executeTakeFirst();
    return Number(r?.n ?? 0);
  },

  async updateOutboundContact(this: PostgresKyselyStorage, row: OutboundContactRecord): Promise<void> {
    await this.db.updateTable('OutboundContact').set({
      name: row.name, email: row.email, ghii: row.ghii,
      tags: jsonb(row.tags) as unknown as Json,
      optedOut: row.optedOut, optOutAt: row.optOutAt,
      bounceCount: row.bounceCount, suppressedAt: row.suppressedAt, notes: row.notes,
      updatedAt: row.updatedAt,
    }).where('id', '=', row.id).execute();
  },

  async deleteOutboundContact(this: PostgresKyselyStorage, id: string): Promise<boolean> {
    const r = await this.db.deleteFrom('OutboundContact').where('id', '=', id).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  async createOutboundMessage(this: PostgresKyselyStorage, row: OutboundMessageRecord): Promise<void> {
    await this.db.insertInto('OutboundMessage').values({
      id: row.id, ownerGhii: row.ownerGhii, contactId: row.contactId,
      channel: row.channel, kind: row.kind, subject: row.subject,
      templateId: row.templateId, status: row.status, error: row.error,
      invoiceId: row.invoiceId, createdAt: row.createdAt,
    }).execute();
  },

  async listOutboundMessages(this: PostgresKyselyStorage, query: OutboundLogQuery): Promise<OutboundMessageRecord[]> {
    let q = this.db.selectFrom('OutboundMessage').selectAll().where('ownerGhii', '=', query.ownerGhii);
    if (query.contactId) q = q.where('contactId', '=', query.contactId);
    if (query.kind) q = q.where('kind', '=', query.kind);
    if (query.status) q = q.where('status', '=', query.status);
    q = q.orderBy('createdAt', 'desc');
    if (query.limit !== undefined) q = q.limit(query.limit);
    if (query.offset !== undefined) q = q.offset(query.offset);
    const rows = await q.execute();
    return rows.map(toMessage);
  },

  async countOutboundMessages(this: PostgresKyselyStorage, query: OutboundLogQuery): Promise<number> {
    let q = this.db.selectFrom('OutboundMessage').select(sql<number>`count(*)`.as('n')).where('ownerGhii', '=', query.ownerGhii);
    if (query.contactId) q = q.where('contactId', '=', query.contactId);
    if (query.kind) q = q.where('kind', '=', query.kind);
    if (query.status) q = q.where('status', '=', query.status);
    const r = await q.executeTakeFirst();
    return Number(r?.n ?? 0);
  },

  async countOutboundMessagesSince(this: PostgresKyselyStorage, ownerGhii: string, sinceIso: string): Promise<number> {
    const r = await this.db.selectFrom('OutboundMessage')
      .select(sql<number>`count(*)`.as('n'))
      .where('ownerGhii', '=', ownerGhii)
      .where('status', '=', 'sent')
      .where('createdAt', '>=', sinceIso)
      .executeTakeFirst();
    return Number(r?.n ?? 0);
  },
};
