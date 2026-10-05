/**
 * @file src/storage/providers/sqlite/methods/federation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/federation.ts (federationMethods), so
 *   a fix in one provider finds its twin by file name. Bodies moved verbatim from the files named in the
 *   version history; bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure federationMethods
 * @usage Object.assign(SqliteStorage.prototype, federationMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — 21 methods (createPeeringRequest, getPeeringRequest, listPeeringRequests, …) moved
 *     here from identity-nodes.ts; createGenesisPeer, getGenesisPeer, getGenesisPeerByNodeId,
 *     listGenesisPeers, updateGenesisPeer, deleteGenesisPeer, deserializeGenesisPeer moved here from
 *     community.ts; saveFederationPeer, listFederationPeers, deleteFederationPeer moved here from
 *     federation-oauth.ts so the file mirrors postgres-kysely/methods/federation.ts (secaudit 2026-10, M8).
 */
import type {
  PeeringRequestRecord, PersonalNodeRecord, MailboxItemRecord, GenesisPeerRecord, FederationPeerRecord,
} from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

export const federationMethods = {
  // ══════════════════════════════════════════════════════════
  // ── Peering Requests ──
  // ══════════════════════════════════════════════════════════

  async createPeeringRequest(this: SqliteStorage, req: PeeringRequestRecord): Promise<PeeringRequestRecord> {
    this.db.prepare(
      `INSERT INTO peering_requests (id, fromNodeUrl, fromNodeId, toNodeId, targetUrl, publicKey, message, status, tier, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req.id, req.fromNodeUrl, req.fromNodeId ?? null,
      req.toNodeId ?? null, req.targetUrl ?? null,
      req.publicKey ?? null, req.message ?? null,
      req.status, req.tier ?? null, req.createdAt, req.updatedAt,
    );
    return req;
  },

  async getPeeringRequest(this: SqliteStorage, id: string): Promise<PeeringRequestRecord | null> {
    const row = this.db.prepare('SELECT * FROM peering_requests WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializePeeringRequest(row) : null;
  },

  async listPeeringRequests(this: SqliteStorage, status?: string): Promise<PeeringRequestRecord[]> {
    let sql = 'SELECT * FROM peering_requests';
    const params: unknown[] = [];
    if (status) { sql += ' WHERE status = ?'; params.push(status); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializePeeringRequest(r));
  },

  async updatePeeringRequest(this: SqliteStorage, id: string, updates: Partial<PeeringRequestRecord>): Promise<PeeringRequestRecord | null> {
    const existing = await this.getPeeringRequest(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE peering_requests SET fromNodeUrl = ?, fromNodeId = ?, toNodeId = ?, targetUrl = ?,
       publicKey = ?, message = ?, status = ?, tier = ?, createdAt = ?, updatedAt = ? WHERE id = ?`
    ).run(
      updated.fromNodeUrl, updated.fromNodeId ?? null,
      updated.toNodeId ?? null, updated.targetUrl ?? null,
      updated.publicKey ?? null, updated.message ?? null,
      updated.status, updated.tier ?? null, updated.createdAt, updated.updatedAt, id,
    );
    return updated;
  },

  async deletePeeringRequest(this: SqliteStorage, id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM peering_requests WHERE id = ?').run(id);
    return result.changes > 0;
  },

  deserializePeeringRequest(this: SqliteStorage, row: Record<string, unknown>): PeeringRequestRecord {
    const record: PeeringRequestRecord = {
      id: row.id as string,
      fromNodeUrl: row.fromNodeUrl as string,
      status: row.status as PeeringRequestRecord['status'],
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.fromNodeId) record.fromNodeId = row.fromNodeId as string;
    if (row.toNodeId) record.toNodeId = row.toNodeId as string;
    if (row.targetUrl) record.targetUrl = row.targetUrl as string;
    if (row.publicKey) record.publicKey = row.publicKey as string;
    if (row.message) record.message = row.message as string;
    if (row.tier) record.tier = row.tier as PeeringRequestRecord['tier'];
    return record;
  },

  // ══════════════════════════════════════════════════════════
  // ── Personal Nodes ──
  // ══════════════════════════════════════════════════════════

  async createPersonalNode(this: SqliteStorage, node: PersonalNodeRecord): Promise<PersonalNodeRecord> {
    this.db.prepare(
      `INSERT INTO personal_nodes (nodeId, ownerName, anchorNodeId, publicKey, status, agentGaiis,
       lastSeen, mailboxQuotaBytes, mailboxUsedBytes, visibility, createdAt, updatedAt, semantic)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      node.nodeId, node.ownerName, node.anchorNodeId, node.publicKey,
      node.status, JSON.stringify(node.agentGaiis), node.lastSeen,
      node.mailboxQuotaBytes, node.mailboxUsedBytes, node.visibility,
      node.createdAt, node.updatedAt,
      node.semantic ? JSON.stringify(node.semantic) : null,
    );
    return { ...node };
  },

  async getPersonalNode(this: SqliteStorage, nodeId: string): Promise<PersonalNodeRecord | null> {
    const row = this.db.prepare('SELECT * FROM personal_nodes WHERE nodeId = ?').get(nodeId) as Record<string, unknown> | undefined;
    return row ? this.deserializePersonalNode(row) : null;
  },

  async getPersonalNodeByOwner(this: SqliteStorage, ownerName: string): Promise<PersonalNodeRecord | null> {
    const row = this.db.prepare('SELECT * FROM personal_nodes WHERE ownerName = ?').get(ownerName) as Record<string, unknown> | undefined;
    return row ? this.deserializePersonalNode(row) : null;
  },

  async listPersonalNodes(this: SqliteStorage, opts?: { status?: string }): Promise<PersonalNodeRecord[]> {
    let sql = 'SELECT * FROM personal_nodes';
    const params: unknown[] = [];
    if (opts?.status) { sql += ' WHERE status = ?'; params.push(opts.status); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializePersonalNode(r));
  },

  async updatePersonalNode(this: SqliteStorage, nodeId: string, updates: Partial<PersonalNodeRecord>): Promise<PersonalNodeRecord | null> {
    const existing = await this.getPersonalNode(nodeId);
    if (!existing) return null;
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    this.db.prepare(
      `UPDATE personal_nodes SET ownerName = ?, anchorNodeId = ?, publicKey = ?, status = ?,
       agentGaiis = ?, lastSeen = ?, mailboxQuotaBytes = ?, mailboxUsedBytes = ?,
       visibility = ?, createdAt = ?, updatedAt = ?, semantic = ? WHERE nodeId = ?`
    ).run(
      updated.ownerName, updated.anchorNodeId, updated.publicKey, updated.status,
      JSON.stringify(updated.agentGaiis), updated.lastSeen,
      updated.mailboxQuotaBytes, updated.mailboxUsedBytes,
      updated.visibility, updated.createdAt, updated.updatedAt,
      updated.semantic ? JSON.stringify(updated.semantic) : null,
      nodeId,
    );
    return { ...updated };
  },

  async deletePersonalNode(this: SqliteStorage, nodeId: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM personal_nodes WHERE nodeId = ?').run(nodeId);
    return result.changes > 0;
  },

  deserializePersonalNode(this: SqliteStorage, row: Record<string, unknown>): PersonalNodeRecord {
    const record: PersonalNodeRecord = {
      nodeId: row.nodeId as string,
      ownerName: row.ownerName as string,
      anchorNodeId: row.anchorNodeId as string,
      publicKey: row.publicKey as string,
      status: row.status as PersonalNodeRecord['status'],
      agentGaiis: JSON.parse(row.agentGaiis as string) as string[],
      lastSeen: row.lastSeen as string,
      mailboxQuotaBytes: row.mailboxQuotaBytes as number,
      mailboxUsedBytes: row.mailboxUsedBytes as number,
      visibility: row.visibility as PersonalNodeRecord['visibility'],
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.semantic) record.semantic = JSON.parse(row.semantic as string);
    return record;
  },

  // ══════════════════════════════════════════════════════════
  // ── Mailbox ──
  // ══════════════════════════════════════════════════════════

  async createMailboxItem(this: SqliteStorage, item: MailboxItemRecord): Promise<MailboxItemRecord> {
    this.db.prepare(
      `INSERT INTO mailbox_items (id, personalNodeId, type, fromGaii, toGaii, payload, sizeBytes, retentionDays, expiresAt, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      item.id, item.personalNodeId, item.type, item.fromGaii, item.toGaii,
      item.payload, item.sizeBytes, item.retentionDays, item.expiresAt, item.createdAt,
    );
    // Update the personal node's mailbox usage
    this.db.prepare(
      'UPDATE personal_nodes SET mailboxUsedBytes = mailboxUsedBytes + ? WHERE nodeId = ?'
    ).run(item.sizeBytes, item.personalNodeId);
    return { ...item };
  },

  async getMailboxItem(this: SqliteStorage, id: string): Promise<MailboxItemRecord | null> {
    const row = this.db.prepare('SELECT * FROM mailbox_items WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeMailboxItem(row) : null;
  },

  async listMailboxItems(this: SqliteStorage, personalNodeId: string, opts?: { type?: string; limit?: number }): Promise<MailboxItemRecord[]> {
    let sql = 'SELECT * FROM mailbox_items WHERE personalNodeId = ?';
    const params: unknown[] = [personalNodeId];
    if (opts?.type) { sql += ' AND type = ?'; params.push(opts.type); }
    sql += ' ORDER BY createdAt ASC';
    if (opts?.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeMailboxItem(r));
  },

  async deleteMailboxItem(this: SqliteStorage, id: string): Promise<boolean> {
    const item = await this.getMailboxItem(id);
    if (!item) return false;
    // Update the personal node's mailbox usage
    this.db.prepare(
      'UPDATE personal_nodes SET mailboxUsedBytes = MAX(0, mailboxUsedBytes - ?) WHERE nodeId = ?'
    ).run(item.sizeBytes, item.personalNodeId);
    const result = this.db.prepare('DELETE FROM mailbox_items WHERE id = ?').run(id);
    return result.changes > 0;
  },

  async deleteMailboxItemsByNode(this: SqliteStorage, personalNodeId: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM mailbox_items WHERE personalNodeId = ?').run(personalNodeId);
    this.db.prepare(
      'UPDATE personal_nodes SET mailboxUsedBytes = 0 WHERE nodeId = ?'
    ).run(personalNodeId);
    return result.changes;
  },

  async getMailboxStats(this: SqliteStorage, personalNodeId: string): Promise<{ count: number; totalBytes: number }> {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count, COALESCE(SUM(sizeBytes), 0) as totalBytes FROM mailbox_items WHERE personalNodeId = ?'
    ).get(personalNodeId) as Record<string, unknown>;
    return {
      count: row.count as number,
      totalBytes: row.totalBytes as number,
    };
  },

  async cleanExpiredMailboxItems(this: SqliteStorage): Promise<number> {
    const now = new Date().toISOString();
    // Get expired items to update personal node usage
    const expiredItems = this.db.prepare(
      'SELECT personalNodeId, sizeBytes FROM mailbox_items WHERE expiresAt < ?'
    ).all(now) as Record<string, unknown>[];

    // Aggregate by personalNodeId
    const bytesPerNode = new Map<string, number>();
    for (const item of expiredItems) {
      const nodeId = item.personalNodeId as string;
      bytesPerNode.set(nodeId, (bytesPerNode.get(nodeId) ?? 0) + (item.sizeBytes as number));
    }

    // Delete expired items
    const result = this.db.prepare('DELETE FROM mailbox_items WHERE expiresAt < ?').run(now);

    // Update personal node usage
    for (const [nodeId, bytes] of bytesPerNode) {
      this.db.prepare(
        'UPDATE personal_nodes SET mailboxUsedBytes = MAX(0, mailboxUsedBytes - ?) WHERE nodeId = ?'
      ).run(bytes, nodeId);
    }

    return result.changes;
  },

  deserializeMailboxItem(this: SqliteStorage, row: Record<string, unknown>): MailboxItemRecord {
    return {
      id: row.id as string,
      personalNodeId: row.personalNodeId as string,
      type: row.type as MailboxItemRecord['type'],
      fromGaii: row.fromGaii as string,
      toGaii: row.toGaii as string,
      payload: row.payload as string,
      sizeBytes: row.sizeBytes as number,
      retentionDays: row.retentionDays as number,
      expiresAt: row.expiresAt as string,
      createdAt: row.createdAt as string,
    };
  },

  // ══════════════════════════════════════════════════════════
  // ── Genesis Peers ──
  // ══════════════════════════════════════════════════════════

  async createGenesisPeer(this: SqliteStorage, record: GenesisPeerRecord): Promise<GenesisPeerRecord> {
    this.db.prepare(
      `INSERT INTO genesis_peers (id, genesisNodeId, genesisUrl, publicKey, status, lastSyncAt, catalogueHash, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.genesisNodeId, record.genesisUrl, record.publicKey,
      record.status, record.lastSyncAt, record.catalogueHash,
      record.createdAt, record.updatedAt,
    );
    return record;
  },

  async getGenesisPeer(this: SqliteStorage, id: string): Promise<GenesisPeerRecord | null> {
    const row = this.db.prepare('SELECT * FROM genesis_peers WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeGenesisPeer(row) : null;
  },

  async getGenesisPeerByNodeId(this: SqliteStorage, nodeId: string): Promise<GenesisPeerRecord | null> {
    const row = this.db.prepare('SELECT * FROM genesis_peers WHERE genesisNodeId = ?').get(nodeId) as Record<string, unknown> | undefined;
    return row ? this.deserializeGenesisPeer(row) : null;
  },

  async listGenesisPeers(this: SqliteStorage, opts?: { status?: string }): Promise<GenesisPeerRecord[]> {
    let sql = 'SELECT * FROM genesis_peers';
    const params: unknown[] = [];
    if (opts?.status) { sql += ' WHERE status = ?'; params.push(opts.status); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeGenesisPeer(r));
  },

  async updateGenesisPeer(this: SqliteStorage, id: string, updates: Partial<GenesisPeerRecord>): Promise<GenesisPeerRecord | null> {
    const existing = await this.getGenesisPeer(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE genesis_peers SET genesisNodeId = ?, genesisUrl = ?, publicKey = ?, status = ?,
       lastSyncAt = ?, catalogueHash = ?, createdAt = ?, updatedAt = ? WHERE id = ?`
    ).run(
      updated.genesisNodeId, updated.genesisUrl, updated.publicKey, updated.status,
      updated.lastSyncAt, updated.catalogueHash, updated.createdAt, updated.updatedAt, id,
    );
    return updated;
  },

  async deleteGenesisPeer(this: SqliteStorage, id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM genesis_peers WHERE id = ?').run(id);
    return result.changes > 0;
  },

  deserializeGenesisPeer(this: SqliteStorage, row: Record<string, unknown>): GenesisPeerRecord {
    return {
      id: row.id as string,
      genesisNodeId: row.genesisNodeId as string,
      genesisUrl: row.genesisUrl as string,
      publicKey: row.publicKey as string,
      status: row.status as GenesisPeerRecord['status'],
      lastSyncAt: row.lastSyncAt as string,
      catalogueHash: row.catalogueHash as string,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
  },

  // ══════════════════════════════════════════════════════════
  // ── Federation Peers (persisted active peer connections) ──
  // ══════════════════════════════════════════════════════════

  async saveFederationPeer(this: SqliteStorage, peer: FederationPeerRecord): Promise<void> {
    this.db.prepare(
      `INSERT OR REPLACE INTO federation_peers (nodeId, url, publicKey, status, addedAt, lastSeen, shareCatalogue, replicateMemory, allowRouting, allowMessaging, allowBroadcast, allowSettlement, supportUpstream, peerMode, allowFederatedAuth, federationAuthScopes, tier, availability, expiresAt, heartbeatOk, heartbeatTotal, availabilityWindow, availabilityPct, softwareVersion, nodeCardHash, relayClaimAt, relayClaim, lastClaimedRelayAt, lastUnclaimedRelayAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(peer.nodeId, peer.url, peer.publicKey, peer.status, peer.addedAt, peer.lastSeen,
      peer.shareCatalogue ? 1 : 0, peer.replicateMemory ? 1 : 0, peer.allowRouting ? 1 : 0,
      peer.allowMessaging ? 1 : 0, peer.allowBroadcast ? 1 : 0, peer.allowSettlement ? 1 : 0,
      peer.supportUpstream ? 1 : 0,
      peer.peerMode || 'federation', peer.allowFederatedAuth ? 1 : 0,
      (peer.federationAuthScopes ?? []).join(','),
      peer.tier ?? 'member', peer.availability ?? null, peer.expiresAt ?? null,
      peer.heartbeatOk ?? 0, peer.heartbeatTotal ?? 0, peer.availabilityWindow ?? null, peer.availabilityPct ?? null,
      peer.softwareVersion ?? null, peer.nodeCardHash ?? null, peer.relayClaimAt ?? null,
      peer.relayClaim ?? null, peer.lastClaimedRelayAt ?? null, peer.lastUnclaimedRelayAt ?? null);
  },

  async listFederationPeers(this: SqliteStorage): Promise<FederationPeerRecord[]> {
    const rows = this.db.prepare('SELECT * FROM federation_peers').all() as Record<string, unknown>[];
    return rows.map(r => ({
      nodeId: r.nodeId as string,
      url: r.url as string,
      publicKey: r.publicKey as string,
      status: r.status as string,
      addedAt: r.addedAt as string,
      lastSeen: r.lastSeen as string,
      shareCatalogue: r.shareCatalogue === 1,
      replicateMemory: r.replicateMemory === 1,
      allowRouting: r.allowRouting === 1,
      // The migration backfills these three to 1 and supportUpstream to 0, so a peer that predates
      // the columns keeps exactly what it could already do and gains no support routing.
      allowMessaging: r.allowMessaging === 1,
      allowBroadcast: r.allowBroadcast === 1,
      allowSettlement: r.allowSettlement === 1,
      supportUpstream: r.supportUpstream === 1,
      peerMode: (r.peerMode as FederationPeerRecord['peerMode']) || 'federation',
      allowFederatedAuth: r.allowFederatedAuth === 1,
      federationAuthScopes: ((r.federationAuthScopes as string) || '').split(',').filter(Boolean),
      tier: (r.tier as FederationPeerRecord['tier']) || 'member',
      availability: (r.availability as FederationPeerRecord['availability']) ?? null,
      expiresAt: (r.expiresAt as string) ?? null,
      heartbeatOk: (r.heartbeatOk as number) ?? 0,
      heartbeatTotal: (r.heartbeatTotal as number) ?? 0,
      availabilityWindow: (r.availabilityWindow as string) ?? null,
      availabilityPct: r.availabilityPct == null ? null : (r.availabilityPct as number),
      softwareVersion: (r.softwareVersion as string) ?? null,
      nodeCardHash: (r.nodeCardHash as string) ?? null,
      relayClaimAt: (r.relayClaimAt as string) ?? null,
      // Only the two words the gate knows; anything else follows the node, like a row without one.
      relayClaim: r.relayClaim === 'optional' || r.relayClaim === 'required' ? r.relayClaim : null,
      lastClaimedRelayAt: (r.lastClaimedRelayAt as string) ?? null,
      lastUnclaimedRelayAt: (r.lastUnclaimedRelayAt as string) ?? null,
    }));
  },

  async deleteFederationPeer(this: SqliteStorage, nodeId: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM federation_peers WHERE nodeId = ?').run(nodeId);
    return result.changes > 0;
  },
};
