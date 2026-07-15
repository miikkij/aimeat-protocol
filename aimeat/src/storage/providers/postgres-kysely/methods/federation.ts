/**
 * @file src/storage/providers/postgres-kysely/methods/federation.ts
 * @description Federation domain for the Postgres+Kysely backend: approved-peer registry
 *   (FederationPeer, PK = nodeId), peering-request lifecycle (PeeringRequest, business key
 *   `requestId` ↔ record `id`), personal-node registration + per-node mailbox store-and-forward
 *   queue (with best-effort mailboxUsedBytes accounting), and the genesis-peer registry. Translated
 *   1:1 from the Prisma (Mongo) provider against the same tables.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: federation on Postgres+Kysely.
 */
import { sql } from 'kysely';
import type { Selectable } from 'kysely';
import type {
  FederationPeerRecord, PeeringRequestRecord, PersonalNodeRecord, MailboxItemRecord, GenesisPeerRecord,
} from '../../../interface.js';
import type { FederationPeer, PeeringRequest, PersonalNode, MailboxItem, GenesisPeer } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();

function toFederationPeer(r: Selectable<FederationPeer>): FederationPeerRecord {
  return {
    nodeId: r.nodeId, url: r.url, publicKey: r.publicKey, status: r.status,
    addedAt: iso(r.addedAt), lastSeen: iso(r.lastSeen),
    shareCatalogue: r.shareCatalogue ?? true, replicateMemory: r.replicateMemory ?? true, allowRouting: r.allowRouting ?? true,
    peerMode: (r.peerMode || 'federation') as FederationPeerRecord['peerMode'],
    allowFederatedAuth: r.allowFederatedAuth ?? false,
    federationAuthScopes: r.federationAuthScopes ?? [],
    tier: (r.tier ?? 'member') as FederationPeerRecord['tier'],
    availability: (r.availability ?? null) as FederationPeerRecord['availability'],
    expiresAt: r.expiresAt ? iso(r.expiresAt) : null,
    heartbeatOk: r.heartbeatOk ?? 0, heartbeatTotal: r.heartbeatTotal ?? 0,
    availabilityWindow: r.availabilityWindow ?? null,
    availabilityPct: r.availabilityPct ?? null,
    softwareVersion: r.softwareVersion ?? null,
    nodeCardHash: r.nodeCardHash ?? null,
  };
}
function toPeeringRequest(r: Selectable<PeeringRequest>): PeeringRequestRecord {
  return {
    id: r.requestId, fromNodeUrl: r.fromNodeUrl, fromNodeId: r.fromNodeId ?? undefined, toNodeId: r.toNodeId ?? undefined,
    targetUrl: r.targetUrl ?? undefined, publicKey: r.publicKey ?? undefined, message: r.message ?? undefined,
    status: r.status as PeeringRequestRecord['status'], createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt),
  };
}
function toPersonalNode(r: Selectable<PersonalNode>): PersonalNodeRecord {
  return {
    nodeId: r.id, ownerName: r.ownerName, anchorNodeId: r.anchorNodeId, publicKey: r.publicKey,
    status: r.status as PersonalNodeRecord['status'], agentGaiis: r.agentGaiis ?? [], lastSeen: iso(r.lastSeen),
    mailboxQuotaBytes: r.mailboxQuotaBytes, mailboxUsedBytes: r.mailboxUsedBytes,
    visibility: r.visibility as PersonalNodeRecord['visibility'], createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt),
  };
}
function toMailboxItem(r: Selectable<MailboxItem>): MailboxItemRecord {
  return {
    id: r.id, personalNodeId: r.personalNodeId, type: r.type as MailboxItemRecord['type'], fromGaii: r.fromGaii,
    toGaii: r.toGaii, payload: r.payload, sizeBytes: r.sizeBytes, retentionDays: r.retentionDays,
    expiresAt: iso(r.expiresAt), createdAt: iso(r.createdAt),
  };
}
function toGenesisPeer(r: Selectable<GenesisPeer>): GenesisPeerRecord {
  return {
    id: r.id, genesisNodeId: r.genesisNodeId, genesisUrl: r.genesisUrl, publicKey: r.publicKey,
    status: r.status as GenesisPeerRecord['status'], lastSyncAt: iso(r.lastSyncAt), catalogueHash: r.catalogueHash,
    createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt),
  };
}

export const federationMethods = {
  // ── Federation Peers (persisted active peer connections; PK = nodeId) ──
  async saveFederationPeer(this: PostgresKyselyStorage, peer: FederationPeerRecord): Promise<void> {
    const shared = {
      url: peer.url, publicKey: peer.publicKey, status: peer.status, lastSeen: new Date(peer.lastSeen),
      shareCatalogue: peer.shareCatalogue, replicateMemory: peer.replicateMemory, allowRouting: peer.allowRouting,
      peerMode: peer.peerMode || 'federation', allowFederatedAuth: peer.allowFederatedAuth ?? false,
      federationAuthScopes: peer.federationAuthScopes ?? [], tier: peer.tier ?? 'member',
      availability: peer.availability ?? null, expiresAt: peer.expiresAt ? new Date(peer.expiresAt) : null,
      heartbeatOk: peer.heartbeatOk ?? 0, heartbeatTotal: peer.heartbeatTotal ?? 0,
      availabilityWindow: peer.availabilityWindow ?? null, availabilityPct: peer.availabilityPct ?? null,
      softwareVersion: peer.softwareVersion ?? null, nodeCardHash: peer.nodeCardHash ?? null,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.db.insertInto('FederationPeer').values({ nodeId: peer.nodeId, addedAt: new Date(peer.addedAt), ...shared } as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .onConflict(oc => oc.column('nodeId').doUpdateSet(shared as any)).execute();
  },
  async listFederationPeers(this: PostgresKyselyStorage): Promise<FederationPeerRecord[]> {
    return (await this.db.selectFrom('FederationPeer').selectAll().execute()).map(toFederationPeer);
  },
  async deleteFederationPeer(this: PostgresKyselyStorage, nodeId: string): Promise<boolean> {
    const r = await this.db.deleteFrom('FederationPeer').where('nodeId', '=', nodeId).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  // ── Peering Requests (business key = requestId; DB `id` is a surrogate) ──
  async createPeeringRequest(this: PostgresKyselyStorage, req: PeeringRequestRecord): Promise<PeeringRequestRecord> {
    await this.db.insertInto('PeeringRequest').values({
      requestId: req.id, fromNodeUrl: req.fromNodeUrl, fromNodeId: req.fromNodeId ?? null, toNodeId: req.toNodeId ?? null,
      targetUrl: req.targetUrl ?? null, publicKey: req.publicKey ?? null, message: req.message ?? null, status: req.status,
      createdAt: new Date(req.createdAt), updatedAt: new Date(req.updatedAt),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
    return req;
  },
  async getPeeringRequest(this: PostgresKyselyStorage, id: string): Promise<PeeringRequestRecord | null> {
    const r = await this.db.selectFrom('PeeringRequest').selectAll().where('requestId', '=', id).executeTakeFirst();
    return r ? toPeeringRequest(r) : null;
  },
  async listPeeringRequests(this: PostgresKyselyStorage, status?: string): Promise<PeeringRequestRecord[]> {
    let q = this.db.selectFrom('PeeringRequest').selectAll();
    if (status) q = q.where('status', '=', status);
    return (await q.execute()).map(toPeeringRequest);
  },
  async updatePeeringRequest(this: PostgresKyselyStorage, id: string, updates: Partial<PeeringRequestRecord>): Promise<PeeringRequestRecord | null> {
    try {
      const data: Record<string, unknown> = { updatedAt: updates.updatedAt ? new Date(updates.updatedAt) : new Date() };
      if (updates.status !== undefined) data.status = updates.status;
      const rows = await this.db.updateTable('PeeringRequest').set(data as never).where('requestId', '=', id).returningAll().execute();
      return rows[0] ? toPeeringRequest(rows[0]) : null;
    } catch { return null; }
  },
  async deletePeeringRequest(this: PostgresKyselyStorage, id: string): Promise<boolean> {
    const r = await this.db.deleteFrom('PeeringRequest').where('requestId', '=', id).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  // ── Personal Nodes (business key = nodeId ↔ DB `id`) ──
  async createPersonalNode(this: PostgresKyselyStorage, node: PersonalNodeRecord): Promise<PersonalNodeRecord> {
    await this.db.insertInto('PersonalNode').values({
      id: node.nodeId, ownerName: node.ownerName, anchorNodeId: node.anchorNodeId, publicKey: node.publicKey,
      status: node.status, agentGaiis: node.agentGaiis, lastSeen: new Date(node.lastSeen),
      mailboxQuotaBytes: node.mailboxQuotaBytes, mailboxUsedBytes: node.mailboxUsedBytes, visibility: node.visibility,
      createdAt: new Date(node.createdAt), updatedAt: new Date(node.updatedAt ?? node.createdAt),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
    return node;
  },
  async getPersonalNode(this: PostgresKyselyStorage, nodeId: string): Promise<PersonalNodeRecord | null> {
    const r = await this.db.selectFrom('PersonalNode').selectAll().where('id', '=', nodeId).executeTakeFirst();
    return r ? toPersonalNode(r) : null;
  },
  async getPersonalNodeByOwner(this: PostgresKyselyStorage, ownerName: string): Promise<PersonalNodeRecord | null> {
    const r = await this.db.selectFrom('PersonalNode').selectAll().where('ownerName', '=', ownerName).executeTakeFirst();
    return r ? toPersonalNode(r) : null;
  },
  async listPersonalNodes(this: PostgresKyselyStorage, opts?: { status?: string }): Promise<PersonalNodeRecord[]> {
    let q = this.db.selectFrom('PersonalNode').selectAll();
    if (opts?.status) q = q.where('status', '=', opts.status);
    return (await q.execute()).map(toPersonalNode);
  },
  async updatePersonalNode(this: PostgresKyselyStorage, nodeId: string, updates: Partial<PersonalNodeRecord>): Promise<PersonalNodeRecord | null> {
    try {
      const data: Record<string, unknown> = {};
      if (updates.ownerName !== undefined) data.ownerName = updates.ownerName;
      if (updates.anchorNodeId !== undefined) data.anchorNodeId = updates.anchorNodeId;
      if (updates.publicKey !== undefined) data.publicKey = updates.publicKey;
      if (updates.status !== undefined) data.status = updates.status;
      if (updates.agentGaiis !== undefined) data.agentGaiis = updates.agentGaiis;
      if (updates.lastSeen !== undefined) data.lastSeen = new Date(updates.lastSeen);
      if (updates.mailboxQuotaBytes !== undefined) data.mailboxQuotaBytes = updates.mailboxQuotaBytes;
      if (updates.mailboxUsedBytes !== undefined) data.mailboxUsedBytes = updates.mailboxUsedBytes;
      if (updates.visibility !== undefined) data.visibility = updates.visibility;
      if (updates.createdAt !== undefined) data.createdAt = new Date(updates.createdAt);
      data.updatedAt = updates.updatedAt ? new Date(updates.updatedAt) : new Date();
      const rows = await this.db.updateTable('PersonalNode').set(data as never).where('id', '=', nodeId).returningAll().execute();
      return rows[0] ? toPersonalNode(rows[0]) : null;
    } catch { return null; }
  },
  async deletePersonalNode(this: PostgresKyselyStorage, nodeId: string): Promise<boolean> {
    const r = await this.db.deleteFrom('PersonalNode').where('id', '=', nodeId).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  // ── Mailbox (per-node store-and-forward; usage accounting is best-effort) ──
  async createMailboxItem(this: PostgresKyselyStorage, item: MailboxItemRecord): Promise<MailboxItemRecord> {
    await this.db.insertInto('MailboxItem').values({
      id: item.id, personalNodeId: item.personalNodeId, type: item.type, fromGaii: item.fromGaii, toGaii: item.toGaii,
      payload: item.payload, sizeBytes: item.sizeBytes, retentionDays: item.retentionDays,
      expiresAt: new Date(item.expiresAt), createdAt: new Date(item.createdAt),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
    await this.db.updateTable('PersonalNode').set({ mailboxUsedBytes: sql`"mailboxUsedBytes" + ${item.sizeBytes}` })
      .where('id', '=', item.personalNodeId).execute().catch(() => {});
    return item;
  },
  async getMailboxItem(this: PostgresKyselyStorage, id: string): Promise<MailboxItemRecord | null> {
    const r = await this.db.selectFrom('MailboxItem').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toMailboxItem(r) : null;
  },
  async listMailboxItems(this: PostgresKyselyStorage, personalNodeId: string, opts?: { type?: string; limit?: number }): Promise<MailboxItemRecord[]> {
    let q = this.db.selectFrom('MailboxItem').selectAll().where('personalNodeId', '=', personalNodeId);
    if (opts?.type) q = q.where('type', '=', opts.type);
    q = q.orderBy('createdAt', 'asc');
    if (opts?.limit) q = q.limit(opts.limit);
    return (await q.execute()).map(toMailboxItem);
  },
  async deleteMailboxItem(this: PostgresKyselyStorage, id: string): Promise<boolean> {
    const item = await this.db.selectFrom('MailboxItem').select(['personalNodeId', 'sizeBytes']).where('id', '=', id).executeTakeFirst();
    if (!item) return false;
    await this.db.deleteFrom('MailboxItem').where('id', '=', id).execute();
    await this.db.updateTable('PersonalNode').set({ mailboxUsedBytes: sql`"mailboxUsedBytes" - ${item.sizeBytes}` })
      .where('id', '=', item.personalNodeId).execute().catch(() => {});
    return true;
  },
  async deleteMailboxItemsByNode(this: PostgresKyselyStorage, personalNodeId: string): Promise<number> {
    const r = await this.db.deleteFrom('MailboxItem').where('personalNodeId', '=', personalNodeId).executeTakeFirst();
    await this.db.updateTable('PersonalNode').set({ mailboxUsedBytes: 0 }).where('id', '=', personalNodeId).execute().catch(() => {});
    return Number(r.numDeletedRows ?? 0);
  },
  async getMailboxStats(this: PostgresKyselyStorage, personalNodeId: string): Promise<{ count: number; totalBytes: number }> {
    const r = await this.db.selectFrom('MailboxItem')
      .select([sql<number>`coalesce(sum("sizeBytes"),0)`.as('totalBytes'), sql<number>`count(*)`.as('count')])
      .where('personalNodeId', '=', personalNodeId).executeTakeFirst();
    return { count: Number(r?.count ?? 0), totalBytes: Number(r?.totalBytes ?? 0) };
  },
  async cleanExpiredMailboxItems(this: PostgresKyselyStorage): Promise<number> {
    const now = new Date();
    const expired = await this.db.selectFrom('MailboxItem').select(['personalNodeId', 'sizeBytes']).where('expiresAt', '<', now).execute();
    if (expired.length === 0) return 0;
    const nodeBytes = new Map<string, number>();
    for (const item of expired) nodeBytes.set(item.personalNodeId, (nodeBytes.get(item.personalNodeId) ?? 0) + item.sizeBytes);
    for (const [nodeId, bytes] of nodeBytes) {
      await this.db.updateTable('PersonalNode').set({ mailboxUsedBytes: sql`"mailboxUsedBytes" - ${bytes}` })
        .where('id', '=', nodeId).execute().catch(() => {});
    }
    const r = await this.db.deleteFrom('MailboxItem').where('expiresAt', '<', now).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },

  // ── Genesis Peers (Phase 3.4; business key = record id ↔ DB `id`) ──
  async createGenesisPeer(this: PostgresKyselyStorage, record: GenesisPeerRecord): Promise<GenesisPeerRecord> {
    await this.db.insertInto('GenesisPeer').values({
      id: record.id, genesisNodeId: record.genesisNodeId, genesisUrl: record.genesisUrl, publicKey: record.publicKey,
      status: record.status, lastSyncAt: new Date(record.lastSyncAt), catalogueHash: record.catalogueHash,
      createdAt: new Date(record.createdAt), updatedAt: new Date(record.updatedAt ?? record.createdAt),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
    return record;
  },
  async getGenesisPeer(this: PostgresKyselyStorage, id: string): Promise<GenesisPeerRecord | null> {
    const r = await this.db.selectFrom('GenesisPeer').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toGenesisPeer(r) : null;
  },
  async getGenesisPeerByNodeId(this: PostgresKyselyStorage, nodeId: string): Promise<GenesisPeerRecord | null> {
    const r = await this.db.selectFrom('GenesisPeer').selectAll().where('genesisNodeId', '=', nodeId).executeTakeFirst();
    return r ? toGenesisPeer(r) : null;
  },
  async listGenesisPeers(this: PostgresKyselyStorage, opts?: { status?: string }): Promise<GenesisPeerRecord[]> {
    let q = this.db.selectFrom('GenesisPeer').selectAll();
    if (opts?.status) q = q.where('status', '=', opts.status);
    return (await q.execute()).map(toGenesisPeer);
  },
  async updateGenesisPeer(this: PostgresKyselyStorage, id: string, updates: Partial<GenesisPeerRecord>): Promise<GenesisPeerRecord | null> {
    try {
      const data: Record<string, unknown> = {};
      if (updates.genesisNodeId !== undefined) data.genesisNodeId = updates.genesisNodeId;
      if (updates.genesisUrl !== undefined) data.genesisUrl = updates.genesisUrl;
      if (updates.publicKey !== undefined) data.publicKey = updates.publicKey;
      if (updates.status !== undefined) data.status = updates.status;
      if (updates.lastSyncAt !== undefined) data.lastSyncAt = new Date(updates.lastSyncAt);
      if (updates.catalogueHash !== undefined) data.catalogueHash = updates.catalogueHash;
      if (updates.createdAt !== undefined) data.createdAt = new Date(updates.createdAt);
      data.updatedAt = updates.updatedAt ? new Date(updates.updatedAt) : new Date();
      const rows = await this.db.updateTable('GenesisPeer').set(data as never).where('id', '=', id).returningAll().execute();
      return rows[0] ? toGenesisPeer(rows[0]) : null;
    } catch { return null; }
  },
  async deleteGenesisPeer(this: PostgresKyselyStorage, id: string): Promise<boolean> {
    const r = await this.db.deleteFrom('GenesisPeer').where('id', '=', id).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },
};
