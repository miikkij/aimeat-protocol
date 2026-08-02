/**
 * @file src/storage/providers/sqlite/methods/connections.ts
 * @description SQLite implementation of the outbound connection store (TARGET-057). Mirrors the
 *   Postgres provider; the two concurrency primitives are the parts worth reading.
 *
 *   claimConnectionRefresh() is a conditional UPDATE and reports `changes`, so exactly one caller
 *   wins even though better-sqlite3 runs synchronously — the guarantee comes from the statement,
 *   not from the runtime happening to be single-threaded, and that is what keeps it equivalent to
 *   the Postgres path.
 *
 *   openPublishAttempt() is INSERT ... ON CONFLICT DO NOTHING followed by a read of whatever is now
 *   there. The unique index arbitrates; a check-then-insert would leave the double-post window open.
 * @structure connectionMethods — connections · delegations · publish attempts
 * @usage merged onto SqliteStorage.prototype in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-08-02 — TARGET-057 Phase 1.
 */
import type { ConnectionQuery, PublishAttemptQuery } from '../../../repositories/connection.repository.js';
import type {
  ConnectionRecord, ConnectionStatus, CredentialShape, ConnectionMode,
  DelegationRecord, ModerationMode, PublishAttempt, NewPublishAttempt, PublishStatus,
  ProviderClientRecord, PublishMetricSample,
} from '../../../../models/connection-schemas.js';
import type { SqliteStorage } from '../index.js';

type Row = Record<string, unknown>;

function toConnection(r: Row): ConnectionRecord {
  return {
    id: r.id as string,
    principal: r.principal as string,
    mode: r.mode as ConnectionMode,
    provider: r.provider as string,
    instance: (r.instance as string | null) ?? null,
    accountLabel: r.accountLabel as string,
    externalId: r.externalId as string,
    credential: r.credential as string,
    credentialShape: r.credentialShape as CredentialShape,
    scopes: JSON.parse((r.scopes as string) || '[]') as string[],
    expiresAt: (r.expiresAt as string | null) ?? null,
    status: r.status as ConnectionStatus,
    lastOkAt: (r.lastOkAt as string | null) ?? null,
    lastError: (r.lastError as string | null) ?? null,
    providerClientId: (r.providerClientId as string | null) ?? null,
    createdAt: r.createdAt as string,
    updatedAt: r.updatedAt as string,
  };
}

function toDelegation(r: Row): DelegationRecord {
  const limit = r.perUserLimit as string | null;
  return {
    id: r.id as string,
    connectionId: r.connectionId as string,
    appId: r.appId as string,
    action: r.action as string,
    fixed: JSON.parse((r.fixed as string) || '{}') as Record<string, unknown>,
    perUserLimit: limit ? (JSON.parse(limit) as { count: number; windowHours: number }) : null,
    moderation: r.moderation as ModerationMode,
    enabled: Number(r.enabled) === 1,
    createdAt: r.createdAt as string,
    updatedAt: r.updatedAt as string,
  };
}

function toAttempt(r: Row): PublishAttempt {
  return {
    id: r.id as string,
    idempotencyKey: r.idempotencyKey as string,
    publisher: r.publisher as string,
    connectionId: r.connectionId as string,
    delegationId: (r.delegationId as string | null) ?? null,
    storageKey: r.storageKey as string,
    status: r.status as PublishStatus,
    externalRef: (r.externalRef as string | null) ?? null,
    error: (r.error as string | null) ?? null,
    createdAt: r.createdAt as string,
    updatedAt: r.updatedAt as string,
  };
}

function toMetric(r: Row): PublishMetricSample {
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  return {
    id: r.id as string,
    attemptId: r.attemptId as string,
    fetchedAt: r.fetchedAt as string,
    // null stays null. A provider that does not report a number reported nothing, and turning that
    // into 0 invents a measurement.
    impressions: num(r.impressions),
    likes: num(r.likes),
    comments: num(r.comments),
    shares: num(r.shares),
    raw: JSON.parse((r.raw as string) || '{}') as Record<string, unknown>,
  };
}

function toProviderClient(r: Row): ProviderClientRecord {
  return {
    id: r.id as string,
    provider: r.provider as string,
    instance: (r.instance as string | null) ?? null,
    principal: (r.principal as string | null) ?? null,
    clientId: r.clientId as string,
    clientSecret: r.clientSecret as string,
    registeredAt: r.registeredAt as string,
  };
}

/** Shared WHERE builder for the listing and the two counters, so a gate and a display cannot drift. */
function attemptWhere(query: PublishAttemptQuery): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (query.publisher) { clauses.push('publisher = ?'); params.push(query.publisher); }
  if (query.connectionId) { clauses.push('connectionId = ?'); params.push(query.connectionId); }
  if (query.delegationId) { clauses.push('delegationId = ?'); params.push(query.delegationId); }
  if (query.status) {
    const list = Array.isArray(query.status) ? query.status : [query.status];
    clauses.push(`status IN (${list.map(() => '?').join(',')})`);
    params.push(...list);
  }
  if (query.since) { clauses.push('createdAt >= ?'); params.push(query.since); }
  return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}

export const connectionMethods = {
  async createConnection(this: SqliteStorage, row: ConnectionRecord): Promise<void> {
    this.db.prepare(`
      INSERT INTO connections (id, principal, mode, provider, instance, accountLabel, externalId,
        credential, credentialShape, scopes, expiresAt, status, lastOkAt, lastError,
        providerClientId, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id, row.principal, row.mode, row.provider, row.instance, row.accountLabel, row.externalId,
      row.credential, row.credentialShape, JSON.stringify(row.scopes), row.expiresAt, row.status,
      row.lastOkAt, row.lastError, row.providerClientId, row.createdAt, row.updatedAt,
    );
  },

  async getConnection(this: SqliteStorage, id: string): Promise<ConnectionRecord | undefined> {
    const r = this.db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as Row | undefined;
    return r ? toConnection(r) : undefined;
  },

  async findConnection(
    this: SqliteStorage,
    principal: string, provider: string, externalId: string, instance: string | null,
  ): Promise<ConnectionRecord | undefined> {
    // COALESCE mirrors the unique index. `instance = NULL` is never true, so a bare comparison would
    // miss every fixed-endpoint provider's row and each reconnect would insert a duplicate.
    const r = this.db.prepare(`
      SELECT * FROM connections
      WHERE principal = ? AND provider = ? AND externalId = ? AND COALESCE(instance, '') = ?
    `).get(principal, provider, externalId, instance ?? '') as Row | undefined;
    return r ? toConnection(r) : undefined;
  },

  async listConnections(this: SqliteStorage, query: ConnectionQuery = {}): Promise<ConnectionRecord[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (query.principal) { clauses.push('principal = ?'); params.push(query.principal); }
    if (query.provider) { clauses.push('provider = ?'); params.push(query.provider); }
    if (query.mode) { clauses.push('mode = ?'); params.push(query.mode); }
    if (query.status) { clauses.push('status = ?'); params.push(query.status); }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(
      `SELECT * FROM connections${where} ORDER BY createdAt DESC`,
    ).all(...params) as Row[];
    return rows.map(toConnection);
  },

  async updateConnectionCredential(
    this: SqliteStorage,
    id: string, credential: string, expiresAt: string | null, scopes?: string[],
  ): Promise<void> {
    const now = new Date().toISOString();
    // A successful token exchange IS the evidence that whatever was wrong no longer is, so status
    // and lastError clear here rather than needing a second call somebody could forget to make.
    if (scopes) {
      this.db.prepare(`
        UPDATE connections SET credential = ?, expiresAt = ?, scopes = ?,
          status = 'active', lastError = NULL, updatedAt = ? WHERE id = ?
      `).run(credential, expiresAt, JSON.stringify(scopes), now, id);
    } else {
      this.db.prepare(`
        UPDATE connections SET credential = ?, expiresAt = ?,
          status = 'active', lastError = NULL, updatedAt = ? WHERE id = ?
      `).run(credential, expiresAt, now, id);
    }
  },

  async setConnectionStatus(
    this: SqliteStorage, id: string, status: ConnectionStatus, error?: string | null,
  ): Promise<void> {
    const now = new Date().toISOString();
    if (error !== undefined) {
      this.db.prepare('UPDATE connections SET status = ?, lastError = ?, updatedAt = ? WHERE id = ?')
        .run(status, error, now, id);
    } else {
      this.db.prepare('UPDATE connections SET status = ?, updatedAt = ? WHERE id = ?')
        .run(status, now, id);
    }
  },

  async touchConnectionOk(this: SqliteStorage, id: string): Promise<void> {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE connections SET lastOkAt = ?, updatedAt = ? WHERE id = ?').run(now, now, id);
  },

  async deleteConnection(this: SqliteStorage, id: string): Promise<void> {
    this.db.prepare('DELETE FROM connections WHERE id = ?').run(id);
  },

  /**
   * The claim is granted by the WHERE clause and reported by `changes`. Expressing it as one
   * statement rather than a read followed by a write is what keeps this equivalent to the Postgres
   * path instead of relying on better-sqlite3 being synchronous.
   */
  async claimConnectionRefresh(this: SqliteStorage, id: string, staleAfterMs: number): Promise<boolean> {
    const now = Date.now();
    const res = this.db.prepare(`
      UPDATE connections SET refreshClaimedAt = ?
      WHERE id = ? AND (refreshClaimedAt IS NULL OR refreshClaimedAt < ?)
    `).run(
      new Date(now).toISOString(), id,
      // A crash mid-refresh must not wedge the connection permanently.
      new Date(now - staleAfterMs).toISOString(),
    );
    return res.changes > 0;
  },

  async releaseConnectionRefresh(this: SqliteStorage, id: string): Promise<void> {
    this.db.prepare('UPDATE connections SET refreshClaimedAt = NULL WHERE id = ?').run(id);
  },

  async upsertDelegation(this: SqliteStorage, row: DelegationRecord): Promise<void> {
    this.db.prepare(`
      INSERT INTO connection_delegations
        (id, connectionId, appId, action, fixed, perUserLimit, moderation, enabled, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(connectionId, appId, action) DO UPDATE SET
        fixed = excluded.fixed, perUserLimit = excluded.perUserLimit,
        moderation = excluded.moderation, enabled = excluded.enabled, updatedAt = excluded.updatedAt
    `).run(
      row.id, row.connectionId, row.appId, row.action, JSON.stringify(row.fixed),
      row.perUserLimit ? JSON.stringify(row.perUserLimit) : null,
      row.moderation, row.enabled ? 1 : 0, row.createdAt, row.updatedAt,
    );
  },

  async getDelegation(this: SqliteStorage, id: string): Promise<DelegationRecord | undefined> {
    const r = this.db.prepare('SELECT * FROM connection_delegations WHERE id = ?').get(id) as Row | undefined;
    return r ? toDelegation(r) : undefined;
  },

  async findDelegation(
    this: SqliteStorage, appId: string, action: string,
  ): Promise<DelegationRecord | undefined> {
    const r = this.db.prepare(
      'SELECT * FROM connection_delegations WHERE appId = ? AND action = ?',
    ).get(appId, action) as Row | undefined;
    return r ? toDelegation(r) : undefined;
  },

  async listDelegations(this: SqliteStorage, connectionId?: string): Promise<DelegationRecord[]> {
    const rows = connectionId
      ? this.db.prepare(
        'SELECT * FROM connection_delegations WHERE connectionId = ? ORDER BY createdAt DESC',
      ).all(connectionId) as Row[]
      : this.db.prepare('SELECT * FROM connection_delegations ORDER BY createdAt DESC').all() as Row[];
    return rows.map(toDelegation);
  },

  async setDelegationEnabled(this: SqliteStorage, id: string, enabled: boolean): Promise<void> {
    this.db.prepare('UPDATE connection_delegations SET enabled = ?, updatedAt = ? WHERE id = ?')
      .run(enabled ? 1 : 0, new Date().toISOString(), id);
  },

  /**
   * Insert-if-new, then read back whatever is there. The unique index arbitrates, so a retry racing
   * a slow success gets the FIRST attempt's row and its outcome. The caller tells the two cases
   * apart by comparing the returned id with the one it passed in.
   */
  async openPublishAttempt(this: SqliteStorage, row: NewPublishAttempt): Promise<PublishAttempt> {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO publish_attempts
        (id, idempotencyKey, publisher, connectionId, delegationId, storageKey, status,
         externalRef, error, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
      ON CONFLICT(idempotencyKey) DO NOTHING
    `).run(
      row.id, row.idempotencyKey, row.publisher, row.connectionId, row.delegationId,
      row.storageKey, row.status, now, now,
    );
    const r = this.db.prepare('SELECT * FROM publish_attempts WHERE idempotencyKey = ?')
      .get(row.idempotencyKey) as Row;
    // Guaranteed present: either this insert placed it or the conflicting one did.
    return toAttempt(r);
  },

  async getPublishAttempt(this: SqliteStorage, id: string): Promise<PublishAttempt | undefined> {
    const r = this.db.prepare('SELECT * FROM publish_attempts WHERE id = ?').get(id) as Row | undefined;
    return r ? toAttempt(r) : undefined;
  },

  async updatePublishAttempt(
    this: SqliteStorage,
    id: string, patch: Partial<Pick<PublishAttempt, 'status' | 'externalRef' | 'error'>>,
  ): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status); }
    if (patch.externalRef !== undefined) { sets.push('externalRef = ?'); params.push(patch.externalRef); }
    if (patch.error !== undefined) { sets.push('error = ?'); params.push(patch.error); }
    sets.push('updatedAt = ?'); params.push(new Date().toISOString());
    params.push(id);
    this.db.prepare(`UPDATE publish_attempts SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  },

  async listPublishAttempts(
    this: SqliteStorage, query: PublishAttemptQuery = {},
  ): Promise<PublishAttempt[]> {
    const w = attemptWhere(query);
    const rows = this.db.prepare(
      `SELECT * FROM publish_attempts${w.sql} ORDER BY createdAt DESC`,
    ).all(...w.params) as Row[];
    return rows.map(toAttempt);
  },

  async countPublishAttempts(this: SqliteStorage, query: PublishAttemptQuery): Promise<number> {
    const w = attemptWhere(query);
    const r = this.db.prepare(
      `SELECT COUNT(*) AS n FROM publish_attempts${w.sql}`,
    ).get(...w.params) as { n: number };
    return Number(r?.n ?? 0);
  },

  /**
   * Insert-if-new, then read back. Two users arriving from the same Mastodon instance at the same
   * moment must converge on ONE registration; a check-then-insert would let both register and orphan
   * the loser's credentials at the instance with nothing pointing at them.
   */
  async upsertProviderClient(
    this: SqliteStorage, row: ProviderClientRecord,
  ): Promise<ProviderClientRecord> {
    this.db.prepare(`
      INSERT INTO provider_clients (id, provider, instance, principal, clientId, clientSecret, registeredAt)
      VALUES (?, ?, ?, NULL, ?, ?, ?)
      -- The conflict target has to repeat the partial index's own WHERE clause; without it SQLite
      -- cannot match the index and raises instead of doing nothing.
      ON CONFLICT(provider, instance) WHERE instance IS NOT NULL AND principal IS NULL DO NOTHING
    `).run(row.id, row.provider, row.instance, row.clientId, row.clientSecret, row.registeredAt);
    const r = this.db.prepare(
      'SELECT * FROM provider_clients WHERE provider = ? AND instance = ? AND principal IS NULL',
    ).get(row.provider, row.instance) as Row;
    return toProviderClient(r);
  },

  async getProviderClient(
    this: SqliteStorage, provider: string, instance: string,
  ): Promise<ProviderClientRecord | undefined> {
    const r = this.db.prepare(
      'SELECT * FROM provider_clients WHERE provider = ? AND instance = ? AND principal IS NULL',
    ).get(provider, instance) as Row | undefined;
    return r ? toProviderClient(r) : undefined;
  },

  /**
   * A principal's own client. The principal is IN the query rather than checked after: a lookup
   * that can return someone else's row and is then filtered is a lookup that leaks the day somebody
   * forgets the filter.
   */
  async addPublishMetric(this: SqliteStorage, row: PublishMetricSample): Promise<void> {
    this.db.prepare(`
      INSERT INTO publish_metrics (id, attemptId, fetchedAt, impressions, likes, comments, shares, raw)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.id, row.attemptId, row.fetchedAt, row.impressions, row.likes, row.comments,
      row.shares, JSON.stringify(row.raw ?? {}));
  },

  /** One query for every attempt on the page. N+1 here is a history view that takes a second. */
  async latestPublishMetrics(
    this: SqliteStorage, attemptIds: string[],
  ): Promise<Map<string, PublishMetricSample>> {
    const out = new Map<string, PublishMetricSample>();
    if (attemptIds.length === 0) return out;
    const holes = attemptIds.map(() => '?').join(',');
    const rows = this.db.prepare(`
      SELECT m.* FROM publish_metrics m
      JOIN (SELECT attemptId, MAX(fetchedAt) AS t FROM publish_metrics
            WHERE attemptId IN (${holes}) GROUP BY attemptId) latest
        ON latest.attemptId = m.attemptId AND latest.t = m.fetchedAt
    `).all(...attemptIds) as Row[];
    for (const r of rows) out.set(r.attemptId as string, toMetric(r));
    return out;
  },

  async listPublishMetrics(this: SqliteStorage, attemptId: string): Promise<PublishMetricSample[]> {
    const rows = this.db.prepare(
      'SELECT * FROM publish_metrics WHERE attemptId = ? ORDER BY fetchedAt ASC',
    ).all(attemptId) as Row[];
    return rows.map(toMetric);
  },

  async getPrincipalProviderClient(
    this: SqliteStorage, provider: string, principal: string,
  ): Promise<ProviderClientRecord | undefined> {
    const r = this.db.prepare(
      'SELECT * FROM provider_clients WHERE provider = ? AND principal = ?',
    ).get(provider, principal) as Row | undefined;
    return r ? toProviderClient(r) : undefined;
  },

  async getProviderClientById(
    this: SqliteStorage, id: string,
  ): Promise<ProviderClientRecord | undefined> {
    const r = this.db.prepare('SELECT * FROM provider_clients WHERE id = ?')
      .get(id) as Row | undefined;
    return r ? toProviderClient(r) : undefined;
  },

  async listPrincipalProviderClients(
    this: SqliteStorage, principal: string,
  ): Promise<ProviderClientRecord[]> {
    const rows = this.db.prepare(
      'SELECT * FROM provider_clients WHERE principal = ? ORDER BY provider',
    ).all(principal) as Row[];
    return rows.map(toProviderClient);
  },

  /** Replaces rather than accumulates: one brought-along client per principal per provider. */
  async upsertPrincipalProviderClient(
    this: SqliteStorage, row: ProviderClientRecord,
  ): Promise<ProviderClientRecord> {
    this.db.prepare(`
      INSERT INTO provider_clients (id, provider, instance, principal, clientId, clientSecret, registeredAt)
      VALUES (?, ?, NULL, ?, ?, ?, ?)
      ON CONFLICT(provider, principal) WHERE principal IS NOT NULL
        DO UPDATE SET clientId = excluded.clientId, clientSecret = excluded.clientSecret,
                      registeredAt = excluded.registeredAt
    `).run(row.id, row.provider, row.principal, row.clientId, row.clientSecret, row.registeredAt);
    const r = this.db.prepare(
      'SELECT * FROM provider_clients WHERE provider = ? AND principal = ?',
    ).get(row.provider, row.principal) as Row;
    return toProviderClient(r);
  },

  async deletePrincipalProviderClient(
    this: SqliteStorage, provider: string, principal: string,
  ): Promise<boolean> {
    const r = this.db.prepare(
      'DELETE FROM provider_clients WHERE provider = ? AND principal = ?',
    ).run(provider, principal);
    return r.changes > 0;
  },

  async countConnectionsByProviderClient(this: SqliteStorage, providerClientId: string): Promise<number> {
    const r = this.db.prepare(
      'SELECT COUNT(*) AS n FROM connections WHERE providerClientId = ?',
    ).get(providerClientId) as { n: number };
    return r.n;
  },
};
