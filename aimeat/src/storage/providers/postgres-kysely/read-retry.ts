/**
 * @file src/storage/providers/postgres-kysely/read-retry.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A read that met a lost connection is tried once more, on another connection. When
 *   the database fails over to its standby, restarts, or ends a session (`57P01`), every statement
 *   in flight on the old connections fails, and the request that made it answered 500 although
 *   asking again a moment later would have worked. A read can be asked again with no effect beyond
 *   its answer; a write cannot be known to have not happened, so it fails to its caller as before.
 *
 *   WHAT IS TRIED AGAIN. A SELECT built with the query builder (its root node is a SelectQueryNode,
 *   with no common table expression that writes), outside a transaction, that failed with:
 *     - a lost connection: SQLSTATE class 08 (connection exception), 57P01 admin_shutdown,
 *       57P02 crash_shutdown, 57P03 cannot_connect_now, a socket reset (ECONNRESET, EPIPE), or the
 *       driver's "Connection terminated". It runs again once on a connection taken from the pool
 *       after the lost one was given back;
 *     - 40001 serialization_failure (also what a standby answers when replay cancels a read). It
 *       runs again once on the same connection, which is sound.
 *   Once only: the second error reaches the caller as it is. A raw `sql` statement is never tried
 *   again, since nothing tells whether it writes. Inside a transaction nothing is tried again: the
 *   transaction is gone with its connection, and its caller answers for it as before.
 *
 *   A LOST CONNECTION LEAVES THE POOL. node-postgres rejects the query with the server's 57P01
 *   before the socket's end marks the client broken, so a client given back at once went back to
 *   the pool and the next caller met the same dead socket. dropLostConnections() marks a client
 *   whose query failed that way, and its release destroys it.
 * @structure lostConnection(err) · retryableRead(err) · isIdempotentRead(query) ·
 *   dropLostConnections(pool) · withReadRetry(dialect, onRetry)
 * @usage
 *   dropLostConnections(pool);
 *   new Kysely({ dialect: withReadRetry(new PostgresDialect({ pool }), info => logger.warn(...)) });
 * @version-history
 *   v1.0.1 — 2026-11-07 — release(false) destroys a lost client too. Kysely 0.29.8 gives every
 *            connection back with release(false), and `??` passed that `false` on, so a client lost
 *            to 57P01 went back to the pool and the retry met the same dead socket.
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item HA stage 3).
 */
import type {
  CompiledQuery, DatabaseConnection, DatabaseIntrospector, Dialect, DialectAdapter, Driver,
  QueryCompiler, QueryResult, TransactionSettings,
} from 'kysely';
import type pg from 'pg';

/** SQLSTATEs of a session the server ended (class 08 is matched by its prefix). */
const LOST_SESSION_CODES: ReadonlySet<string> = new Set(['57P01', '57P02', '57P03']);
/** Socket errors node raises when the connection is reset under a query. */
const LOST_SOCKET_CODES: ReadonlySet<string> = new Set(['ECONNRESET', 'EPIPE']);

/** True when `err` says the connection under the statement is gone. */
export function lostConnection(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && (code.startsWith('08') || LOST_SESSION_CODES.has(code) || LOST_SOCKET_CODES.has(code))) return true;
  const message = err instanceof Error ? err.message : '';
  return message.startsWith('Connection terminated');
}

/** How a failed read is tried again: on another connection, on the same one, or not at all. */
export function retryableRead(err: unknown): 'connection' | 'serialization' | null {
  if ((err as { code?: unknown } | null)?.code === '40001') return 'serialization';
  return lostConnection(err) ? 'connection' : null;
}

interface Node { readonly kind: string }
interface SelectNode extends Node { readonly with?: { readonly expressions: ReadonlyArray<{ readonly expression: Node }> } }

/** A query-builder SELECT none of whose common table expressions writes. */
export function isIdempotentRead(query: Node): boolean {
  if (query.kind !== 'SelectQueryNode') return false;
  const ctes = (query as SelectNode).with?.expressions ?? [];
  return ctes.every(cte => isIdempotentRead(cte.expression));
}

/**
 * Mark a pooled client whose query failed on a lost connection, and destroy it at its release
 * instead of putting it back. Wraps the promise form of `pool.connect()`, as pool-limits.ts does.
 */
export function dropLostConnections(pool: pg.Pool): void {
  const lost = new WeakSet<pg.PoolClient>();
  const watched = new WeakSet<pg.PoolClient>();
  const original = pool.connect.bind(pool) as (...args: unknown[]) => unknown;
  (pool as unknown as { connect: (...args: unknown[]) => unknown }).connect = (...args: unknown[]) => {
    if (args.length > 0) return original(...args);
    return (original() as Promise<pg.PoolClient>).then((client) => {
      if (!watched.has(client)) {
        watched.add(client);
        // The client's query method is looked up at each call (its class's, unless the client had one
        // of its own), so whatever wraps pg.Client.prototype.query later still sees every statement.
        type Query = (...a: unknown[]) => unknown;
        const own = Object.prototype.hasOwnProperty.call(client, 'query') ? client.query as Query : null;
        (client as unknown as { query: Query }).query = function (this: unknown, ...a: unknown[]) {
          const query = own ?? (Object.getPrototypeOf(client) as { query: Query }).query;
          const out = query.apply(client, a);
          if (out && typeof (out as Promise<unknown>).then === 'function') {
            // A side branch: the caller still gets `out`, rejection and all.
            (out as Promise<unknown>).then(undefined, (err: unknown) => { if (lostConnection(err)) lost.add(client); });
          }
          return out;
        };
      }
      // pg-pool gives the client a new release() at each checkout. Kysely's driver gives it back with
      // release(false) when it did not discard it, so `false` counts as "no error" here, not as an answer.
      const release = client.release.bind(client);
      client.release = (err?: Error | boolean) => release(err || (lost.has(client) ? new Error('postgres: the connection was lost') : undefined));
      return client;
    });
  };
}

/** What a retry tells its caller, for a log line. */
export interface ReadRetryInfo { reason: 'connection' | 'serialization'; code: string | undefined; error: string }

class ReadRetryConnection implements DatabaseConnection {
  inTransaction = false;
  #conn: DatabaseConnection | null;

  constructor(private readonly driver: Driver, conn: DatabaseConnection, private readonly onRetry?: (info: ReadRetryInfo) => void) {
    this.#conn = conn;
  }

  /** The connection under this one now. */
  current(): DatabaseConnection {
    if (!this.#conn) throw new Error('postgres: the connection was lost and no other could be taken');
    return this.#conn;
  }

  /** Hand the connection under this one to the caller, which gives it back; nothing is left here. */
  detach(): DatabaseConnection | null {
    const c = this.#conn;
    this.#conn = null;
    return c;
  }

  async executeQuery<R>(compiledQuery: CompiledQuery, options?: Parameters<DatabaseConnection['executeQuery']>[1]): Promise<QueryResult<R>> {
    const conn = this.current();
    try {
      return await conn.executeQuery<R>(compiledQuery, options);
    } catch (err) {
      const reason = this.inTransaction || !isIdempotentRead(compiledQuery.query) ? null : retryableRead(err);
      if (!reason) throw err;
      this.onRetry?.({ reason, code: (err as { code?: string }).code, error: String(err) });
      if (reason === 'serialization') return await conn.executeQuery<R>(compiledQuery, options);
      // Give the lost connection back first (the pool destroys it), so a pool of one has one to give.
      this.#conn = null;
      await this.driver.releaseConnection(conn);
      let fresh: DatabaseConnection;
      try {
        fresh = await this.driver.acquireConnection(options);
      } catch {
        throw err;   // no connection to try again on: the caller gets the error it would have got
      }
      this.#conn = fresh;
      return await fresh.executeQuery<R>(compiledQuery, options);
    }
  }

  streamQuery<R>(compiledQuery: CompiledQuery, chunkSize: number, options?: Parameters<DatabaseConnection['streamQuery']>[2]): AsyncIterableIterator<QueryResult<R>> {
    return this.current().streamQuery<R>(compiledQuery, chunkSize, options);
  }

  async cancelQuery(provider: Parameters<NonNullable<DatabaseConnection['cancelQuery']>>[0]): Promise<void> {
    await this.#conn?.cancelQuery?.(provider);
  }

  async killSession(provider: Parameters<NonNullable<DatabaseConnection['killSession']>>[0]): Promise<void> {
    await this.#conn?.killSession?.(provider);
  }

  async collectSessionInfo(): Promise<void> {
    await this.#conn?.collectSessionInfo?.();
  }
}

class ReadRetryDriver implements Driver {
  constructor(private readonly inner: Driver, private readonly onRetry?: (info: ReadRetryInfo) => void) {
    if (inner.savepoint) this.savepoint = (c, name, compile) => inner.savepoint!(unwrap(c), name, compile);
    if (inner.rollbackToSavepoint) this.rollbackToSavepoint = (c, name, compile) => inner.rollbackToSavepoint!(unwrap(c), name, compile);
    if (inner.releaseSavepoint) this.releaseSavepoint = (c, name, compile) => inner.releaseSavepoint!(unwrap(c), name, compile);
  }

  savepoint?: Driver['savepoint'];
  rollbackToSavepoint?: Driver['rollbackToSavepoint'];
  releaseSavepoint?: Driver['releaseSavepoint'];

  init(options?: Parameters<Driver['init']>[0]): Promise<void> { return this.inner.init(options); }

  async acquireConnection(options?: Parameters<Driver['acquireConnection']>[0]): Promise<DatabaseConnection> {
    return new ReadRetryConnection(this.inner, await this.inner.acquireConnection(options), this.onRetry);
  }

  async beginTransaction(connection: DatabaseConnection, settings: TransactionSettings): Promise<void> {
    const c = connection as ReadRetryConnection;
    c.inTransaction = true;
    await this.inner.beginTransaction(c.current(), settings);
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    const c = connection as ReadRetryConnection;
    try { await this.inner.commitTransaction(c.current()); } finally { c.inTransaction = false; }
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    const c = connection as ReadRetryConnection;
    try { await this.inner.rollbackTransaction(c.current()); } finally { c.inTransaction = false; }
  }

  async releaseConnection(connection: DatabaseConnection, options?: Parameters<Driver['releaseConnection']>[1]): Promise<void> {
    const under = (connection as ReadRetryConnection).detach();
    if (under) await this.inner.releaseConnection(under, options);
  }

  destroy(options?: Parameters<Driver['destroy']>[0]): Promise<void> { return this.inner.destroy(options); }
}

const unwrap = (c: DatabaseConnection): DatabaseConnection => (c as ReadRetryConnection).current();

/** `dialect`, with a read that met a lost connection tried once more (see the file header). */
export function withReadRetry(dialect: Dialect, onRetry?: (info: ReadRetryInfo) => void): Dialect {
  const wrapped: Dialect = {
    createDriver: (): Driver => new ReadRetryDriver(dialect.createDriver(), onRetry),
    createQueryCompiler: (): QueryCompiler => dialect.createQueryCompiler(),
    createAdapter: (): DialectAdapter => dialect.createAdapter(),
    createIntrospector: (db): DatabaseIntrospector => dialect.createIntrospector(db),
  };
  return wrapped;
}
