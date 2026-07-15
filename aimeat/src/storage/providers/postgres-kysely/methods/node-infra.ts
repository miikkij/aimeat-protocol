/**
 * @file src/storage/providers/postgres-kysely/methods/node-infra.ts
 * @description Node-infrastructure storage domain for the Postgres+Kysely backend: web-push
 *   subscriptions, trusted federation issuers, OIDC/EUDIW verification nonces, realtime rooms, and the
 *   site change log. Translated 1:1 from the Prisma (Mongo) implementation against the same tables.
 *   Excludes node key / maintenance / extensions / escrow / cortex (implemented elsewhere).
 * @structure
 *   - module-level mappers (toPushSub / toTrustedIssuer / toVerificationNonce / toRealtimeRoom / toSiteChangeLog)
 *   - nodeInfraMethods: push-subscription upsert+CRUD, trusted-issuer CRUD, nonce CRUD + expiry sweep,
 *     realtime-room CRUD, site-change-log append + cursor-paginated list
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: node-infra domain on Postgres+Kysely.
 */
import type { Selectable } from 'kysely';
import type {
  PushSubscriptionRecord, RealtimeRoomRecord, SiteChangeLogEntry, TrustedIssuerRecord, VerificationNonceRecord,
} from '../../../interface.js';
import type { PushSubscription, RealtimeRoom, SiteChangeLog, TrustedIssuer, VerificationNonce } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();

function toPushSub(r: Selectable<PushSubscription>): PushSubscriptionRecord {
  return {
    ownerName: r.ownerName, endpoint: r.endpoint,
    keys: r.keys as unknown as PushSubscriptionRecord['keys'],
    createdAt: iso(r.createdAt), lastUsedAt: iso(r.lastUsedAt),
  };
}
function toTrustedIssuer(r: Selectable<TrustedIssuer>): TrustedIssuerRecord {
  return {
    id: r.id, name: r.name, url: r.url, publicKey: r.publicKey,
    type: r.type as TrustedIssuerRecord['type'], trusted: r.trusted, addedBy: r.addedBy, createdAt: iso(r.createdAt),
  };
}
function toVerificationNonce(r: Selectable<VerificationNonce>): VerificationNonceRecord {
  return {
    id: r.id, owner: r.owner, type: r.type as VerificationNonceRecord['type'], state: r.state, nonce: r.nonce,
    redirectUri: r.redirectUri, createdAt: iso(r.createdAt), expiresAt: iso(r.expiresAt),
  };
}
function toRealtimeRoom(r: Selectable<RealtimeRoom>): RealtimeRoomRecord {
  return {
    id: r.id, appType: r.appType, name: r.name, createdBy: r.createdBy, maxPeers: r.maxPeers,
    isPublic: r.isPublic, tags: r.tags ?? [], peerCount: r.peerCount,
    createdAt: iso(r.createdAt), lastActivityAt: iso(r.lastActivityAt),
  };
}
function toSiteChangeLog(r: Selectable<SiteChangeLog>): SiteChangeLogEntry {
  return { id: r.id, action: r.action as SiteChangeLogEntry['action'], summary: r.summary, changedBy: r.changedBy, changedAt: iso(r.changedAt) };
}

export const nodeInfraMethods = {
  // ── Push subscriptions (one per owner; upsert on ownerName) ──
  async createPushSubscription(this: PostgresKyselyStorage, record: PushSubscriptionRecord): Promise<PushSubscriptionRecord> {
    const shared = { endpoint: record.endpoint, keys: jsonb(record.keys), lastUsedAt: new Date(record.lastUsedAt) };
    await this.db.insertInto('PushSubscription')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({ id: record.ownerName, ownerName: record.ownerName, createdAt: new Date(record.createdAt), ...shared } as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .onConflict(oc => oc.column('ownerName').doUpdateSet(shared as any)).execute();
    return record;
  },
  async getPushSubscription(this: PostgresKyselyStorage, ownerName: string): Promise<PushSubscriptionRecord | null> {
    const r = await this.db.selectFrom('PushSubscription').selectAll().where('ownerName', '=', ownerName).executeTakeFirst();
    return r ? toPushSub(r) : null;
  },
  async deletePushSubscription(this: PostgresKyselyStorage, ownerName: string): Promise<boolean> {
    const r = await this.db.deleteFrom('PushSubscription').where('ownerName', '=', ownerName).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },
  async listPushSubscriptions(this: PostgresKyselyStorage): Promise<PushSubscriptionRecord[]> {
    return (await this.db.selectFrom('PushSubscription').selectAll().execute()).map(toPushSub);
  },

  // ── Trusted issuers (federation / OIDC verifiers) ──
  async createTrustedIssuer(this: PostgresKyselyStorage, record: TrustedIssuerRecord): Promise<TrustedIssuerRecord> {
    await this.db.insertInto('TrustedIssuer').values({
      id: record.id, name: record.name, url: record.url, publicKey: record.publicKey, type: record.type,
      trusted: record.trusted, addedBy: record.addedBy, createdAt: new Date(record.createdAt),
    }).execute();
    return record;
  },
  async getTrustedIssuer(this: PostgresKyselyStorage, id: string): Promise<TrustedIssuerRecord | null> {
    const r = await this.db.selectFrom('TrustedIssuer').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toTrustedIssuer(r) : null;
  },
  async getTrustedIssuerByUrl(this: PostgresKyselyStorage, url: string): Promise<TrustedIssuerRecord | null> {
    const r = await this.db.selectFrom('TrustedIssuer').selectAll().where('url', '=', url).executeTakeFirst();
    return r ? toTrustedIssuer(r) : null;
  },
  async listTrustedIssuers(this: PostgresKyselyStorage, opts?: { type?: string }): Promise<TrustedIssuerRecord[]> {
    let q = this.db.selectFrom('TrustedIssuer').selectAll();
    if (opts?.type) q = q.where('type', '=', opts.type);
    return (await q.execute()).map(toTrustedIssuer);
  },
  async deleteTrustedIssuer(this: PostgresKyselyStorage, id: string): Promise<boolean> {
    const r = await this.db.deleteFrom('TrustedIssuer').where('id', '=', id).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  // ── Verification nonces (EUDIW/FTN/OIDC state tracking) ──
  async createVerificationNonce(this: PostgresKyselyStorage, record: VerificationNonceRecord): Promise<VerificationNonceRecord> {
    await this.db.insertInto('VerificationNonce').values({
      id: record.id, owner: record.owner, type: record.type, state: record.state, nonce: record.nonce,
      redirectUri: record.redirectUri ?? '', createdAt: new Date(record.createdAt), expiresAt: new Date(record.expiresAt),
    }).execute();
    return record;
  },
  async getVerificationNonce(this: PostgresKyselyStorage, state: string): Promise<VerificationNonceRecord | null> {
    const r = await this.db.selectFrom('VerificationNonce').selectAll().where('state', '=', state).executeTakeFirst();
    return r ? toVerificationNonce(r) : null;
  },
  async deleteVerificationNonce(this: PostgresKyselyStorage, state: string): Promise<void> {
    await this.db.deleteFrom('VerificationNonce').where('state', '=', state).execute();
  },
  async cleanExpiredNonces(this: PostgresKyselyStorage): Promise<number> {
    const r = await this.db.deleteFrom('VerificationNonce').where('expiresAt', '<', new Date()).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },

  // ── Realtime rooms ──
  async createRealtimeRoom(this: PostgresKyselyStorage, record: RealtimeRoomRecord): Promise<RealtimeRoomRecord> {
    await this.db.insertInto('RealtimeRoom').values({
      id: record.id, appType: record.appType, name: record.name, createdBy: record.createdBy, maxPeers: record.maxPeers,
      isPublic: record.isPublic, tags: record.tags, peerCount: record.peerCount,
      createdAt: new Date(record.createdAt), lastActivityAt: new Date(record.lastActivityAt),
    }).execute();
    return record;
  },
  async getRealtimeRoom(this: PostgresKyselyStorage, id: string): Promise<RealtimeRoomRecord | null> {
    const r = await this.db.selectFrom('RealtimeRoom').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toRealtimeRoom(r) : null;
  },
  async listRealtimeRooms(this: PostgresKyselyStorage, filter?: { appType?: string; isPublic?: boolean }): Promise<RealtimeRoomRecord[]> {
    let q = this.db.selectFrom('RealtimeRoom').selectAll();
    if (filter?.appType) q = q.where('appType', '=', filter.appType);
    if (filter?.isPublic !== undefined) q = q.where('isPublic', '=', filter.isPublic);
    return (await q.execute()).map(toRealtimeRoom);
  },
  async updateRealtimeRoom(this: PostgresKyselyStorage, id: string, updates: Partial<RealtimeRoomRecord>): Promise<RealtimeRoomRecord | null> {
    const data: Record<string, unknown> = {};
    if (updates.peerCount !== undefined) data.peerCount = updates.peerCount;
    if (updates.lastActivityAt !== undefined) data.lastActivityAt = new Date(updates.lastActivityAt);
    if (updates.name !== undefined) data.name = updates.name;
    if (updates.isPublic !== undefined) data.isPublic = updates.isPublic;
    if (updates.tags !== undefined) data.tags = updates.tags;
    if (Object.keys(data).length === 0) return this.getRealtimeRoom(id);
    const rows = await this.db.updateTable('RealtimeRoom').set(data as never).where('id', '=', id).returningAll().execute();
    return rows[0] ? toRealtimeRoom(rows[0]) : null;
  },
  async deleteRealtimeRoom(this: PostgresKyselyStorage, id: string): Promise<boolean> {
    const r = await this.db.deleteFrom('RealtimeRoom').where('id', '=', id).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  // ── Site change log (cursor-paginated, newest first) ──
  async addSiteChangeLog(this: PostgresKyselyStorage, entry: SiteChangeLogEntry): Promise<SiteChangeLogEntry> {
    await this.db.insertInto('SiteChangeLog').values({
      id: entry.id, action: entry.action, summary: entry.summary, changedBy: entry.changedBy, changedAt: new Date(entry.changedAt),
    }).execute();
    return entry;
  },
  async listSiteChangeLog(this: PostgresKyselyStorage, limit: number, cursor?: string): Promise<SiteChangeLogEntry[]> {
    let entries = (await this.db.selectFrom('SiteChangeLog').selectAll().orderBy('changedAt', 'desc').execute()).map(toSiteChangeLog);
    if (cursor) {
      const idx = entries.findIndex(e => e.id === cursor);
      if (idx >= 0) entries = entries.slice(idx + 1);
    }
    return entries.slice(0, limit);
  },
};
