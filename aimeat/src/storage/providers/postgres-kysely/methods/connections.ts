/**
 * @file src/storage/providers/postgres-kysely/methods/connections.ts
 * @description Postgres+Kysely implementation of the outbound connection store (TARGET-057).
 *
 *   Two methods here are concurrency primitives rather than CRUD, and both exist because of failures
 *   this codebase has actually produced:
 *
 *   claimConnectionRefresh() is a CONDITIONAL UPDATE, not read-then-write. Postgres serialises the
 *   row update, so exactly one concurrent caller sees a rowcount of 1 and the rest see 0. Doing this
 *   in application code would leave the window it is meant to close.
 *
 *   openPublishAttempt() is an INSERT ... ON CONFLICT DO NOTHING followed by a read of whatever is
 *   now there. The unique index does the arbitration; a check-then-insert would let two racing
 *   retries both publish, which is the double-post this table exists to prevent.
 * @structure connectionMethods — connections · delegations · publish attempts
 * @usage merged onto PostgresKyselyStorage.prototype in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-08-02 — TARGET-057 Phase 1. Schema: migrations/0021_connections.sql.
 */
import type { Selectable } from 'kysely';
import type { ConnectionQuery, PublishAttemptQuery } from '../../../repositories/connection.repository.js';
import type {
  ConnectionRecord, ConnectionStatus, CredentialShape, ConnectionMode,
  DelegationRecord, ModerationMode, PublishAttempt, NewPublishAttempt, PublishStatus,
  ProviderClientRecord,
} from '../../../../models/connection-schemas.js';
import type {
  Connection as ConnectionRow,
  ConnectionDelegation as DelegationRow,
  PublishAttempt as PublishAttemptRow,
  ProviderClient as ProviderClientRow,
  Json,
} from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

function toConnection(r: Selectable<ConnectionRow>): ConnectionRecord {
  return {
    id: r.id,
    principal: r.principal,
    mode: r.mode as ConnectionMode,
    provider: r.provider,
    instance: r.instance ?? null,
    accountLabel: r.accountLabel,
    externalId: r.externalId,
    credential: r.credential,
    credentialShape: r.credentialShape as CredentialShape,
    scopes: (r.scopes as string[] | null) ?? [],
    expiresAt: r.expiresAt ?? null,
    status: r.status as ConnectionStatus,
    lastOkAt: r.lastOkAt ?? null,
    lastError: r.lastError ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toDelegation(r: Selectable<DelegationRow>): DelegationRecord {
  return {
    id: r.id,
    connectionId: r.connectionId,
    appId: r.appId,
    action: r.action,
    fixed: (r.fixed as Record<string, unknown> | null) ?? {},
    perUserLimit: (r.perUserLimit as { count: number; windowHours: number } | null) ?? null,
    moderation: r.moderation as ModerationMode,
    enabled: r.enabled,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toAttempt(r: Selectable<PublishAttemptRow>): PublishAttempt {
  return {
    id: r.id,
    idempotencyKey: r.idempotencyKey,
    publisher: r.publisher,
    connectionId: r.connectionId,
    delegationId: r.delegationId ?? null,
    storageKey: r.storageKey,
    status: r.status as PublishStatus,
    externalRef: r.externalRef ?? null,
    error: r.error ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toProviderClient(r: Selectable<ProviderClientRow>): ProviderClientRecord {
  return {
    id: r.id,
    provider: r.provider,
    instance: r.instance,
    clientId: r.clientId,
    clientSecret: r.clientSecret,
    registeredAt: r.registeredAt,
  };
}

export const connectionMethods = {
  async createConnection(this: PostgresKyselyStorage, row: ConnectionRecord): Promise<void> {
    await this.db.insertInto('Connection').values({
      id: row.id,
      principal: row.principal,
      mode: row.mode,
      provider: row.provider,
      instance: row.instance,
      accountLabel: row.accountLabel,
      externalId: row.externalId,
      credential: row.credential,
      credentialShape: row.credentialShape,
      // jsonb() yields a `<json>::jsonb` fragment; kysely-codegen types the column as the VALUE it
      // reads back, so the fragment needs one narrowing cast on the way in.
      scopes: jsonb(row.scopes) as unknown as Json,
      expiresAt: row.expiresAt,
      status: row.status,
      lastOkAt: row.lastOkAt,
      lastError: row.lastError,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }).execute();
  },

  async getConnection(this: PostgresKyselyStorage, id: string): Promise<ConnectionRecord | undefined> {
    const r = await this.db.selectFrom('Connection').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toConnection(r) : undefined;
  },

  async findConnection(
    this: PostgresKyselyStorage,
    principal: string, provider: string, externalId: string, instance: string | null,
  ): Promise<ConnectionRecord | undefined> {
    let q = this.db.selectFrom('Connection').selectAll()
      .where('principal', '=', principal)
      .where('provider', '=', provider)
      .where('externalId', '=', externalId);
    // Matches the COALESCE in the unique index: NULL never equals NULL, so a bare `= null` would
    // never find a fixed-endpoint provider's row and every reconnect would insert a duplicate.
    q = instance === null ? q.where('instance', 'is', null) : q.where('instance', '=', instance);
    const r = await q.executeTakeFirst();
    return r ? toConnection(r) : undefined;
  },

  async listConnections(this: PostgresKyselyStorage, query: ConnectionQuery = {}): Promise<ConnectionRecord[]> {
    let q = this.db.selectFrom('Connection').selectAll();
    if (query.principal) q = q.where('principal', '=', query.principal);
    if (query.provider) q = q.where('provider', '=', query.provider);
    if (query.mode) q = q.where('mode', '=', query.mode);
    if (query.status) q = q.where('status', '=', query.status);
    const rows = await q.orderBy('createdAt', 'desc').execute();
    return rows.map(toConnection);
  },

  async updateConnectionCredential(
    this: PostgresKyselyStorage,
    id: string, credential: string, expiresAt: string | null, scopes?: string[],
  ): Promise<void> {
    // A successful token exchange IS the evidence that whatever was wrong no longer is, so status
    // and lastError are cleared here rather than needing a second call somebody could forget.
    await this.db.updateTable('Connection').set({
      credential,
      expiresAt,
      ...(scopes ? { scopes: jsonb(scopes) as unknown as Json } : {}),
      status: 'active',
      lastError: null,
      updatedAt: new Date().toISOString(),
    }).where('id', '=', id).execute();
  },

  async setConnectionStatus(
    this: PostgresKyselyStorage, id: string, status: ConnectionStatus, error?: string | null,
  ): Promise<void> {
    await this.db.updateTable('Connection').set({
      status,
      ...(error !== undefined ? { lastError: error } : {}),
      updatedAt: new Date().toISOString(),
    }).where('id', '=', id).execute();
  },

  async touchConnectionOk(this: PostgresKyselyStorage, id: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.updateTable('Connection')
      .set({ lastOkAt: now, updatedAt: now })
      .where('id', '=', id).execute();
  },

  async deleteConnection(this: PostgresKyselyStorage, id: string): Promise<void> {
    await this.db.deleteFrom('Connection').where('id', '=', id).execute();
  },

  /**
   * One conditional UPDATE. The `where` accepts the claim only when nobody holds it or the holder's
   * claim has gone stale, and Postgres serialises the row, so exactly one concurrent caller comes
   * back with a rowcount of 1.
   */
  async claimConnectionRefresh(
    this: PostgresKyselyStorage, id: string, staleAfterMs: number,
  ): Promise<boolean> {
    const now = Date.now();
    const staleBefore = new Date(now - staleAfterMs).toISOString();
    const res = await this.db.updateTable('Connection')
      .set({ refreshClaimedAt: new Date(now).toISOString() })
      .where('id', '=', id)
      .where((eb) => eb.or([
        eb('refreshClaimedAt', 'is', null),
        // A crash mid-refresh must not wedge the connection permanently.
        eb('refreshClaimedAt', '<', staleBefore),
      ]))
      .executeTakeFirst();
    return (res.numUpdatedRows ?? 0n) > 0n;
  },

  async releaseConnectionRefresh(this: PostgresKyselyStorage, id: string): Promise<void> {
    await this.db.updateTable('Connection')
      .set({ refreshClaimedAt: null })
      .where('id', '=', id).execute();
  },

  async upsertDelegation(this: PostgresKyselyStorage, row: DelegationRecord): Promise<void> {
    await this.db.insertInto('ConnectionDelegation').values({
      id: row.id,
      connectionId: row.connectionId,
      appId: row.appId,
      action: row.action,
      fixed: jsonb(row.fixed) as unknown as Json,
      perUserLimit: (row.perUserLimit ? jsonb(row.perUserLimit) : null) as unknown as Json,
      moderation: row.moderation,
      enabled: row.enabled,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }).onConflict((oc) => oc.columns(['connectionId', 'appId', 'action']).doUpdateSet({
      fixed: jsonb(row.fixed) as unknown as Json,
      perUserLimit: (row.perUserLimit ? jsonb(row.perUserLimit) : null) as unknown as Json,
      moderation: row.moderation,
      enabled: row.enabled,
      updatedAt: row.updatedAt,
    })).execute();
  },

  async getDelegation(this: PostgresKyselyStorage, id: string): Promise<DelegationRecord | undefined> {
    const r = await this.db.selectFrom('ConnectionDelegation').selectAll()
      .where('id', '=', id).executeTakeFirst();
    return r ? toDelegation(r) : undefined;
  },

  async findDelegation(
    this: PostgresKyselyStorage, appId: string, action: string,
  ): Promise<DelegationRecord | undefined> {
    const r = await this.db.selectFrom('ConnectionDelegation').selectAll()
      .where('appId', '=', appId).where('action', '=', action)
      .executeTakeFirst();
    return r ? toDelegation(r) : undefined;
  },

  async listDelegations(this: PostgresKyselyStorage, connectionId?: string): Promise<DelegationRecord[]> {
    let q = this.db.selectFrom('ConnectionDelegation').selectAll();
    if (connectionId) q = q.where('connectionId', '=', connectionId);
    const rows = await q.orderBy('createdAt', 'desc').execute();
    return rows.map(toDelegation);
  },

  async setDelegationEnabled(this: PostgresKyselyStorage, id: string, enabled: boolean): Promise<void> {
    await this.db.updateTable('ConnectionDelegation')
      .set({ enabled, updatedAt: new Date().toISOString() })
      .where('id', '=', id).execute();
  },

  /**
   * Insert-if-new, then read back whatever is there. The unique index on `idempotencyKey` arbitrates,
   * so a retry racing a slow success gets the FIRST attempt's row and its outcome instead of starting
   * a second publish. The caller tells the two cases apart by comparing the returned id with the one
   * it passed in.
   */
  async openPublishAttempt(this: PostgresKyselyStorage, row: NewPublishAttempt): Promise<PublishAttempt> {
    const now = new Date().toISOString();
    await this.db.insertInto('PublishAttempt').values({
      id: row.id,
      idempotencyKey: row.idempotencyKey,
      publisher: row.publisher,
      connectionId: row.connectionId,
      delegationId: row.delegationId,
      storageKey: row.storageKey,
      status: row.status,
      externalRef: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    }).onConflict((oc) => oc.column('idempotencyKey').doNothing()).execute();

    const r = await this.db.selectFrom('PublishAttempt').selectAll()
      .where('idempotencyKey', '=', row.idempotencyKey).executeTakeFirst();
    // The row is guaranteed present: either this insert placed it or the conflicting one did.
    return toAttempt(r as Selectable<PublishAttemptRow>);
  },

  async getPublishAttempt(this: PostgresKyselyStorage, id: string): Promise<PublishAttempt | undefined> {
    const r = await this.db.selectFrom('PublishAttempt').selectAll()
      .where('id', '=', id).executeTakeFirst();
    return r ? toAttempt(r) : undefined;
  },

  async updatePublishAttempt(
    this: PostgresKyselyStorage,
    id: string, patch: Partial<Pick<PublishAttempt, 'status' | 'externalRef' | 'error'>>,
  ): Promise<void> {
    await this.db.updateTable('PublishAttempt').set({
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.externalRef !== undefined ? { externalRef: patch.externalRef } : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
      updatedAt: new Date().toISOString(),
    }).where('id', '=', id).execute();
  },

  async listPublishAttempts(
    this: PostgresKyselyStorage, query: PublishAttemptQuery = {},
  ): Promise<PublishAttempt[]> {
    let q = this.db.selectFrom('PublishAttempt').selectAll();
    if (query.publisher) q = q.where('publisher', '=', query.publisher);
    if (query.connectionId) q = q.where('connectionId', '=', query.connectionId);
    if (query.delegationId) q = q.where('delegationId', '=', query.delegationId);
    if (query.status) {
      q = Array.isArray(query.status)
        ? q.where('status', 'in', query.status)
        : q.where('status', '=', query.status);
    }
    if (query.since) q = q.where('createdAt', '>=', query.since);
    const rows = await q.orderBy('createdAt', 'desc').execute();
    return rows.map(toAttempt);
  },

  async countPublishAttempts(this: PostgresKyselyStorage, query: PublishAttemptQuery): Promise<number> {
    let q = this.db.selectFrom('PublishAttempt').select(({ fn }) => [fn.countAll<string>().as('n')]);
    if (query.publisher) q = q.where('publisher', '=', query.publisher);
    if (query.connectionId) q = q.where('connectionId', '=', query.connectionId);
    if (query.delegationId) q = q.where('delegationId', '=', query.delegationId);
    if (query.status) {
      q = Array.isArray(query.status)
        ? q.where('status', 'in', query.status)
        : q.where('status', '=', query.status);
    }
    if (query.since) q = q.where('createdAt', '>=', query.since);
    const r = await q.executeTakeFirst();
    return Number(r?.n ?? 0);
  },

  /**
   * Insert-if-new, then read back. Two users arriving from the same Mastodon instance at the same
   * moment must converge on ONE registration; a check-then-insert would let both register and orphan
   * the loser's credentials at the instance with nothing pointing at them.
   */
  async upsertProviderClient(
    this: PostgresKyselyStorage, row: ProviderClientRecord,
  ): Promise<ProviderClientRecord> {
    await this.db.insertInto('ProviderClient').values({
      id: row.id,
      provider: row.provider,
      instance: row.instance,
      clientId: row.clientId,
      clientSecret: row.clientSecret,
      registeredAt: row.registeredAt,
    }).onConflict((oc) => oc.columns(['provider', 'instance']).doNothing()).execute();

    const r = await this.db.selectFrom('ProviderClient').selectAll()
      .where('provider', '=', row.provider).where('instance', '=', row.instance)
      .executeTakeFirst();
    return toProviderClient(r as Selectable<ProviderClientRow>);
  },

  async getProviderClient(
    this: PostgresKyselyStorage, provider: string, instance: string,
  ): Promise<ProviderClientRecord | undefined> {
    const r = await this.db.selectFrom('ProviderClient').selectAll()
      .where('provider', '=', provider).where('instance', '=', instance)
      .executeTakeFirst();
    return r ? toProviderClient(r) : undefined;
  },
};
