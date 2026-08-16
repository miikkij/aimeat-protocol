/**
 * @file src/storage/providers/sqlite/methods/outbound.ts
 * @description SQLite (better-sqlite3) implementation of the outbound door (recipient
 *   registry + send log). Schema: schema-tables-3.ts. Email lookups compare lower-cased,
 *   matching the unique index.
 * @structure outboundMethods — contacts · send log
 * @usage merged onto SqliteStorage.prototype in ../index.ts
 * @version-history
 *   v1.1.0 — 2026-08-17 — TARGET-063: emailHash/links/relation (safeAddColumn in schema.ts) and
 *     the cross-owner promotion lookup findUnresolvedOutboundContactsByEmailHash.
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 2.
 */
import type { OutboundRepository } from '../../../repositories/outbound.repository.js';
import type {
  OutboundContactRecord, OutboundContactQuery, OutboundContactLink,
  OutboundMessageRecord, OutboundLogQuery, OutboundChannel, OutboundKind, OutboundStatus,
} from '../../../../models/outbound-schemas.js';
import type { SqliteStorage } from '../index.js';

type Row = Record<string, unknown>;

function toContact(r: Row): OutboundContactRecord {
  return {
    id: r.id as string,
    ownerGhii: r.ownerGhii as string,
    name: r.name as string,
    email: r.email as string,
    emailHash: (r.emailHash as string | null) ?? '',
    ghii: (r.ghii as string | null) ?? null,
    tags: JSON.parse((r.tags as string) || '[]') as string[],
    links: JSON.parse((r.links as string) || '[]') as OutboundContactLink[],
    relation: (r.relation as string | null) ?? null,
    optedOut: Number(r.optedOut) === 1,
    optOutAt: (r.optOutAt as string | null) ?? null,
    optOutToken: r.optOutToken as string,
    bounceCount: Number(r.bounceCount),
    suppressedAt: (r.suppressedAt as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    createdAt: r.createdAt as string,
    updatedAt: r.updatedAt as string,
  };
}

function toMessage(r: Row): OutboundMessageRecord {
  return {
    id: r.id as string,
    ownerGhii: r.ownerGhii as string,
    contactId: r.contactId as string,
    channel: r.channel as OutboundChannel,
    kind: r.kind as OutboundKind,
    subject: r.subject as string,
    templateId: (r.templateId as string | null) ?? null,
    status: r.status as OutboundStatus,
    error: (r.error as string | null) ?? null,
    invoiceId: (r.invoiceId as string | null) ?? null,
    createdAt: r.createdAt as string,
  };
}

function contactWhere(query: OutboundContactQuery): { sql: string; params: unknown[] } {
  const clauses = ['ownerGhii = ?'];
  const params: unknown[] = [query.ownerGhii];
  if (query.optedOut !== undefined) { clauses.push('optedOut = ?'); params.push(query.optedOut ? 1 : 0); }
  if (query.suppressed !== undefined) clauses.push(query.suppressed ? 'suppressedAt IS NOT NULL' : 'suppressedAt IS NULL');
  if (query.tag) {
    clauses.push(`EXISTS (SELECT 1 FROM json_each(outbound_contacts.tags) WHERE json_each.value = ?)`);
    params.push(query.tag);
  }
  return { sql: clauses.join(' AND '), params };
}

function logWhere(query: OutboundLogQuery): { sql: string; params: unknown[] } {
  const clauses = ['ownerGhii = ?'];
  const params: unknown[] = [query.ownerGhii];
  if (query.contactId) { clauses.push('contactId = ?'); params.push(query.contactId); }
  if (query.kind) { clauses.push('kind = ?'); params.push(query.kind); }
  if (query.status) { clauses.push('status = ?'); params.push(query.status); }
  return { sql: clauses.join(' AND '), params };
}

export const outboundMethods: OutboundRepository & ThisType<SqliteStorage> = {
  async createOutboundContact(this: SqliteStorage, row: OutboundContactRecord): Promise<void> {
    this.db.prepare(`
      INSERT INTO outbound_contacts (
        id, ownerGhii, name, email, emailHash, ghii, tags, links, relation,
        optedOut, optOutAt, optOutToken,
        bounceCount, suppressedAt, notes, createdAt, updatedAt
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      row.id, row.ownerGhii, row.name, row.email, row.emailHash, row.ghii,
      JSON.stringify(row.tags), JSON.stringify(row.links), row.relation,
      row.optedOut ? 1 : 0, row.optOutAt, row.optOutToken, row.bounceCount,
      row.suppressedAt, row.notes, row.createdAt, row.updatedAt,
    );
  },

  async getOutboundContact(this: SqliteStorage, id: string): Promise<OutboundContactRecord | undefined> {
    const r = this.db.prepare('SELECT * FROM outbound_contacts WHERE id = ?').get(id) as Row | undefined;
    return r ? toContact(r) : undefined;
  },

  async findOutboundContactByEmail(this: SqliteStorage, ownerGhii: string, email: string): Promise<OutboundContactRecord | undefined> {
    const r = this.db.prepare('SELECT * FROM outbound_contacts WHERE ownerGhii = ? AND lower(email) = ?')
      .get(ownerGhii, email.toLowerCase()) as Row | undefined;
    return r ? toContact(r) : undefined;
  },

  async findOutboundContactByToken(this: SqliteStorage, optOutToken: string): Promise<OutboundContactRecord | undefined> {
    const r = this.db.prepare('SELECT * FROM outbound_contacts WHERE optOutToken = ?').get(optOutToken) as Row | undefined;
    return r ? toContact(r) : undefined;
  },

  async findUnresolvedOutboundContactsByEmailHash(this: SqliteStorage, emailHash: string): Promise<OutboundContactRecord[]> {
    // An empty hash is what a row written before the column existed carries. Matching on it would
    // return every legacy row for every verification, so it is refused rather than queried.
    if (!emailHash) return [];
    const rows = this.db.prepare('SELECT * FROM outbound_contacts WHERE emailHash = ? AND ghii IS NULL')
      .all(emailHash) as Row[];
    return rows.map(toContact);
  },

  async listOutboundContacts(this: SqliteStorage, query: OutboundContactQuery): Promise<OutboundContactRecord[]> {
    const { sql, params } = contactWhere(query);
    let stmt = `SELECT * FROM outbound_contacts WHERE ${sql} ORDER BY createdAt DESC`;
    if (query.limit !== undefined) { stmt += ' LIMIT ?'; params.push(query.limit); }
    if (query.offset !== undefined) { stmt += ' OFFSET ?'; params.push(query.offset); }
    const rows = this.db.prepare(stmt).all(...params) as Row[];
    return rows.map(toContact);
  },

  async countOutboundContacts(this: SqliteStorage, query: OutboundContactQuery): Promise<number> {
    const { sql, params } = contactWhere(query);
    const r = this.db.prepare(`SELECT COUNT(*) AS n FROM outbound_contacts WHERE ${sql}`).get(...params) as { n: number };
    return Number(r.n);
  },

  async updateOutboundContact(this: SqliteStorage, row: OutboundContactRecord): Promise<void> {
    this.db.prepare(`
      UPDATE outbound_contacts SET
        name = ?, email = ?, emailHash = ?, ghii = ?, tags = ?, links = ?, relation = ?,
        optedOut = ?, optOutAt = ?,
        bounceCount = ?, suppressedAt = ?, notes = ?, updatedAt = ?
      WHERE id = ?
    `).run(
      row.name, row.email, row.emailHash, row.ghii, JSON.stringify(row.tags),
      JSON.stringify(row.links), row.relation, row.optedOut ? 1 : 0,
      row.optOutAt, row.bounceCount, row.suppressedAt, row.notes, row.updatedAt, row.id,
    );
  },

  async deleteOutboundContact(this: SqliteStorage, id: string): Promise<boolean> {
    const r = this.db.prepare('DELETE FROM outbound_contacts WHERE id = ?').run(id);
    return r.changes > 0;
  },

  async createOutboundMessage(this: SqliteStorage, row: OutboundMessageRecord): Promise<void> {
    this.db.prepare(`
      INSERT INTO outbound_messages (id, ownerGhii, contactId, channel, kind, subject, templateId, status, error, invoiceId, createdAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      row.id, row.ownerGhii, row.contactId, row.channel, row.kind, row.subject,
      row.templateId, row.status, row.error, row.invoiceId, row.createdAt,
    );
  },

  async listOutboundMessages(this: SqliteStorage, query: OutboundLogQuery): Promise<OutboundMessageRecord[]> {
    const { sql, params } = logWhere(query);
    let stmt = `SELECT * FROM outbound_messages WHERE ${sql} ORDER BY createdAt DESC`;
    if (query.limit !== undefined) { stmt += ' LIMIT ?'; params.push(query.limit); }
    if (query.offset !== undefined) { stmt += ' OFFSET ?'; params.push(query.offset); }
    const rows = this.db.prepare(stmt).all(...params) as Row[];
    return rows.map(toMessage);
  },

  async countOutboundMessages(this: SqliteStorage, query: OutboundLogQuery): Promise<number> {
    const { sql, params } = logWhere(query);
    const r = this.db.prepare(`SELECT COUNT(*) AS n FROM outbound_messages WHERE ${sql}`).get(...params) as { n: number };
    return Number(r.n);
  },

  async countOutboundMessagesSince(this: SqliteStorage, ownerGhii: string, sinceIso: string): Promise<number> {
    const r = this.db.prepare(`SELECT COUNT(*) AS n FROM outbound_messages WHERE ownerGhii = ? AND status = 'sent' AND createdAt >= ?`)
      .get(ownerGhii, sinceIso) as { n: number };
    return Number(r.n);
  },
};
