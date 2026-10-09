/**
 * @file src/storage/providers/sqlite/methods/node-infra.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/node-infra.ts (nodeInfraMethods), so
 *   a fix in one provider finds its twin by file name. Bodies moved verbatim from the files named in the
 *   version history; bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure nodeInfraMethods
 * @usage Object.assign(SqliteStorage.prototype, nodeInfraMethods) in ../index.ts
 * @version-history
 *   v1.1.0 — 2026-10-09 — deleteVerificationNonce returns whether it removed the row.
 *   v1.0.0 — 2026-10-05 — 18 methods (createPushSubscription, markPushSubscriptionDelivered,
 *     getPushSubscription, …) moved here from community.ts; addSiteChangeLog, listSiteChangeLog moved here
 *     from extensions-notify.ts so the file mirrors postgres-kysely/methods/node-infra.ts (secaudit 2026-10,
 *     M8).
 */
import type {
  PushSubscriptionRecord, TrustedIssuerRecord, VerificationNonceRecord, RealtimeRoomRecord,
  SiteChangeLogEntry,
} from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

/** One push_subscriptions row → the record. Shared by the three readers so they cannot drift. */
function toPushSubscription(row: Record<string, unknown>): PushSubscriptionRecord {
  return {
    ownerName: row.ownerName as string,
    endpoint: row.endpoint as string,
    keys: JSON.parse(row.keys as string),
    createdAt: row.createdAt as string,
    lastUsedAt: (row.lastUsedAt as string | null) || null,
    appId: (row.appId as string | null) ?? null,
  };
}

export const nodeInfraMethods = {

  // ══════════════════════════════════════════════════════════
  // ── Push Subscriptions ──
  // ══════════════════════════════════════════════════════════

  // One row per DEVICE, keyed (ownerName, endpoint) — see the table comment in schema-tables-1.ts.
  async createPushSubscription(this: SqliteStorage, record: PushSubscriptionRecord): Promise<PushSubscriptionRecord> {
    // ON CONFLICT rather than INSERT OR REPLACE: the same device re-subscribing refreshes its keys
    // and keeps its createdAt, and a DIFFERENT device does not collide at all.
    this.db.prepare(
      // The conflict path refreshes the keys and nothing else: re-subscribing is not a delivery, and
      // writing lastUsedAt here is what made the column mean either (migration 0074).
      `INSERT INTO push_subscriptions (ownerName, endpoint, keys, createdAt, lastUsedAt, appId)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(ownerName, endpoint) DO UPDATE SET keys = excluded.keys, appId = excluded.appId`
    ).run(
      record.ownerName, record.endpoint,
      JSON.stringify(record.keys), record.createdAt, record.lastUsedAt,
      record.appId ?? null,
    );
    return record;
  },

  async markPushSubscriptionDelivered(this: SqliteStorage, ownerName: string, endpoint: string, at: string): Promise<void> {
    this.db.prepare(
      'UPDATE push_subscriptions SET lastUsedAt = ? WHERE ownerName = ? AND endpoint = ?'
    ).run(at, ownerName, endpoint);
  },

  async getPushSubscription(this: SqliteStorage, ownerName: string): Promise<PushSubscriptionRecord | null> {
    const row = this.db.prepare(
      'SELECT * FROM push_subscriptions WHERE ownerName = ? ORDER BY lastUsedAt DESC, endpoint ASC LIMIT 1'
    ).get(ownerName) as Record<string, unknown> | undefined;
    return row ? toPushSubscription(row) : null;
  },

  async listPushSubscriptionsByOwner(this: SqliteStorage, ownerName: string): Promise<PushSubscriptionRecord[]> {
    const rows = this.db.prepare(
      'SELECT * FROM push_subscriptions WHERE ownerName = ? ORDER BY createdAt ASC, endpoint ASC'
    ).all(ownerName) as Record<string, unknown>[];
    return rows.map(toPushSubscription);
  },

  async deletePushSubscription(this: SqliteStorage, ownerName: string, endpoint?: string): Promise<boolean> {
    const result = endpoint === undefined
      ? this.db.prepare('DELETE FROM push_subscriptions WHERE ownerName = ?').run(ownerName)
      : this.db.prepare('DELETE FROM push_subscriptions WHERE ownerName = ? AND endpoint = ?').run(ownerName, endpoint);
    return result.changes > 0;
  },

  async listPushSubscriptions(this: SqliteStorage): Promise<PushSubscriptionRecord[]> {
    const rows = this.db.prepare('SELECT * FROM push_subscriptions').all() as Record<string, unknown>[];
    return rows.map(toPushSubscription);
  },

  // ══════════════════════════════════════════════════════════
  // ── Trusted Issuers ──
  // ══════════════════════════════════════════════════════════

  async createTrustedIssuer(this: SqliteStorage, record: TrustedIssuerRecord): Promise<TrustedIssuerRecord> {
    this.db.prepare(
      `INSERT INTO trusted_issuers (id, name, url, publicKey, type, trusted, addedBy, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.name, record.url, record.publicKey,
      record.type, record.trusted ? 1 : 0, record.addedBy, record.createdAt,
    );
    return record;
  },

  async listTrustedIssuers(this: SqliteStorage, opts?: { type?: string }): Promise<TrustedIssuerRecord[]> {
    let sql = 'SELECT * FROM trusted_issuers';
    const params: unknown[] = [];
    if (opts?.type) { sql += ' WHERE type = ?'; params.push(opts.type); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeTrustedIssuer(r));
  },

  deserializeTrustedIssuer(this: SqliteStorage, row: Record<string, unknown>): TrustedIssuerRecord {
    return {
      id: row.id as string,
      name: row.name as string,
      url: row.url as string,
      publicKey: row.publicKey as string,
      type: row.type as TrustedIssuerRecord['type'],
      trusted: (row.trusted as number) === 1,
      addedBy: row.addedBy as string,
      createdAt: row.createdAt as string,
    };
  },

  // ══════════════════════════════════════════════════════════
  // ── Verification Nonces ──
  // ══════════════════════════════════════════════════════════

  async createVerificationNonce(this: SqliteStorage, record: VerificationNonceRecord): Promise<VerificationNonceRecord> {
    this.db.prepare(
      'INSERT INTO verification_nonces (id, owner, type, state, nonce, redirectUri, payload, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(record.id, record.owner, record.type, record.state, record.nonce, record.redirectUri ?? '', record.payload ?? null, record.createdAt, record.expiresAt);
    return record;
  },

  async getVerificationNonce(this: SqliteStorage, state: string): Promise<VerificationNonceRecord | null> {
    const row = this.db.prepare('SELECT * FROM verification_nonces WHERE state = ?').get(state) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      owner: row.owner as string,
      type: row.type as VerificationNonceRecord['type'],
      state: row.state as string,
      nonce: row.nonce as string,
      redirectUri: row.redirectUri as string,
      payload: (row.payload as string | null) ?? null,
      createdAt: row.createdAt as string,
      expiresAt: row.expiresAt as string,
    };
  },

  async deleteVerificationNonce(this: SqliteStorage, state: string): Promise<boolean> {
    const r = this.db.prepare('DELETE FROM verification_nonces WHERE state = ?').run(state);
    return Number(r.changes ?? 0) > 0;
  },

  async cleanExpiredNonces(this: SqliteStorage): Promise<number> {
    const now = new Date().toISOString();
    const result = this.db.prepare('DELETE FROM verification_nonces WHERE expiresAt < ?').run(now);
    return result.changes;
  },

  // ══════════════════════════════════════════════════════════
  // ── Realtime Rooms ──
  // ══════════════════════════════════════════════════════════

  async createRealtimeRoom(this: SqliteStorage, room: RealtimeRoomRecord): Promise<RealtimeRoomRecord> {
    this.db.prepare(
      `INSERT INTO realtime_rooms (id, appType, name, createdBy, maxPeers, isPublic, tags, peerCount, createdAt, lastActivityAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      room.id, room.appType, room.name, room.createdBy,
      room.maxPeers, room.isPublic ? 1 : 0,
      JSON.stringify(room.tags), room.peerCount,
      room.createdAt, room.lastActivityAt,
    );
    return room;
  },

  async getRealtimeRoom(this: SqliteStorage, id: string): Promise<RealtimeRoomRecord | null> {
    const row = this.db.prepare('SELECT * FROM realtime_rooms WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeRealtimeRoom(row) : null;
  },

  async updateRealtimeRoom(this: SqliteStorage, id: string, updates: Partial<RealtimeRoomRecord>): Promise<RealtimeRoomRecord | null> {
    const existing = await this.getRealtimeRoom(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE realtime_rooms SET appType = ?, name = ?, createdBy = ?, maxPeers = ?,
       isPublic = ?, tags = ?, peerCount = ?, createdAt = ?, lastActivityAt = ? WHERE id = ?`
    ).run(
      updated.appType, updated.name, updated.createdBy, updated.maxPeers,
      updated.isPublic ? 1 : 0, JSON.stringify(updated.tags),
      updated.peerCount, updated.createdAt, updated.lastActivityAt, id,
    );
    return updated;
  },

  async deleteRealtimeRoom(this: SqliteStorage, id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM realtime_rooms WHERE id = ?').run(id);
    return result.changes > 0;
  },

  deserializeRealtimeRoom(this: SqliteStorage, row: Record<string, unknown>): RealtimeRoomRecord {
    return {
      id: row.id as string,
      appType: row.appType as string,
      name: row.name as string,
      createdBy: row.createdBy as string,
      maxPeers: row.maxPeers as number,
      isPublic: (row.isPublic as number) === 1,
      tags: JSON.parse(row.tags as string) as string[],
      peerCount: row.peerCount as number,
      createdAt: row.createdAt as string,
      lastActivityAt: row.lastActivityAt as string,
    };
  },
  // ── Site Change Log ──
  // ══════════════════════════════════════════════════════════

  async addSiteChangeLog(this: SqliteStorage, entry: SiteChangeLogEntry): Promise<SiteChangeLogEntry> {
    this.db.prepare(
      `INSERT INTO site_changelog (id, action, summary, changedBy, changedAt) VALUES (?, ?, ?, ?, ?)`
    ).run(entry.id, entry.action, entry.summary, entry.changedBy, entry.changedAt);

    // Keep at most 200 entries (delete oldest beyond 200)
    this.db.prepare(
      `DELETE FROM site_changelog WHERE id NOT IN (SELECT id FROM site_changelog ORDER BY changedAt DESC LIMIT 200)`
    ).run();

    return entry;
  },

  async listSiteChangeLog(this: SqliteStorage, limit: number, cursor?: string): Promise<SiteChangeLogEntry[]> {
    const sql = 'SELECT * FROM site_changelog ORDER BY changedAt DESC';
    const params: unknown[] = [];

    const allRows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    let entries = allRows.map(r => ({
      id: r.id as string,
      action: r.action as SiteChangeLogEntry['action'],
      summary: r.summary as string,
      changedBy: r.changedBy as string,
      changedAt: r.changedAt as string,
    }));

    if (cursor) {
      const idx = entries.findIndex(e => e.id === cursor);
      if (idx >= 0) entries = entries.slice(idx + 1);
    }
    return entries.slice(0, limit);
  },
};
