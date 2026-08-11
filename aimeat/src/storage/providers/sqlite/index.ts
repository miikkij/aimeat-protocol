/**
 * @file sqlite/index.ts
 * @description SQLite Storage implementation (better-sqlite3) of the full Storage
 *   interface. Synchronous prepared statements; schema created/migrated on
 *   construction via initializeSchema(). Backs `:memory:`, dev, and personal nodes.
 * @structure SqliteStorage class holds the fields, constructor and close(); every
 *   domain method group lives in ./methods/<group>.ts as an exported object literal
 *   (method shorthand, `this: SqliteStorage`) and is merged onto the prototype via
 *   Object.assign. The `interface SqliteStorage extends Storage, SqliteInternals`
 *   declaration merge tells the type-checker the class has every method the merge
 *   supplies at runtime. Split out of one 7.2k-line file to satisfy max-file-lines.
 * @usage new SqliteStorage(dbPath) — dbPath may be ':memory:' or a file path.
 * @version-history
 *   v1.0.0 — pre-2026-06 — Initial SQLite storage implementation
 *   v1.1.0 — 2026-06-05 — Add normalizeAppOwnerNames() to strip the legacy
 *     `@node` suffix from app ownerName values (bare-name normalization).
 *   v1.2.0 — 2026-06-09 — Add mergeForkedAppBuckets() to consolidate ownerGaii
 *     buckets forked across an owner's identity forms into one canonical bucket.
 *   v1.3.0 — 2026-06-12 — Add subdomain_sites CRUD (operator-managed
 *     subdomain → published-app/redirect mappings).
 *   v1.3.1 — 2026-06-19 — Security (CR-1): reject negative/non-finite amounts in
 *     debitBalance/creditBalance/creditBalanceCapped/transferBalance to prevent
 *     negative-amount morsel minting (0 still allowed — free/0-cost work escrow).
 *   v1.4.0 — 2026-06-20 — Add app_grants CRUD (owner-issued app authorizations →
 *     agent tokens; refresh-hash lookup, list-by-owner, rotate/revoke).
 *   v1.6.0 — 2026-08-11 — Storage.transaction(): BEGIN/COMMIT/ROLLBACK, transactions serialised
 *     against each other, and an async-context guard so a write started outside an open
 *     transaction waits rather than landing inside it. SQLite gives the process one connection,
 *     so without the guard another request's write would be discarded by somebody else's rollback.
 *   v1.5.0 — 2026-07-13 — Split the method bodies into ./methods/<group>.ts modules
 *     (prototype-assignment + interface-merge) so every file is ≤800 lines; bodies
 *     are byte-identical, `db`/`chunkedUploads` widened to public for the groups.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Storage, ChunkedUploadRecord } from '../../interface.js';
import { initializeSchema } from './schema.js';

import type { SqliteInternals } from './methods/internal.js';
import { ownerMethods } from './methods/owner.js';
import { cascadeMethods } from './methods/owner-cascade.js';
import { ownerMemoryBulkMethods } from './methods/owner-memory-bulk.js';
import { ownerMemoryScopeMethods } from './methods/owner-memory-scope.js';
import { workMethods } from './methods/work.js';
import { identityNodesMethods } from './methods/identity-nodes.js';
import { governanceMethods } from './methods/governance.js';
import { communityMethods } from './methods/community.js';
import { extensionsNotifyMethods } from './methods/extensions-notify.js';
import { appsMethods } from './methods/apps.js';
import { federationOauthMethods } from './methods/federation-oauth.js';
import { packagesMethods } from './methods/packages.js';
import { capabilityAgentsMethods } from './methods/capability-agents.js';
import { messagingMethods } from './methods/messaging.js';
import { aiProvenanceMethods } from './methods/ai-provenance.js';
import { connectionMethods } from './methods/connections.js';
import { financeMethods } from './methods/finance.js';
import { outboundMethods } from './methods/outbound.js';
import { companyMethods } from './methods/companies.js';

/**
 * Marks the async context of an open transaction, so a write can tell whether it is a step OF the
 * transaction or a bystander that merely started while one was open. A global flag cannot: both
 * run in the same process on the same connection.
 */
const txContext = new AsyncLocalStorage<SqliteStorage>();

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- intentional class+interface merge: the interface below declares the methods Object.assign installs on the prototype.
export class SqliteStorage {
  db: Database.Database;
  chunkedUploads = new Map<string, ChunkedUploadRecord>();

  /**
   * Depth of the transaction open on this instance. SQLite gives the whole process ONE connection, so
   * a transaction here is process-wide: this counter is what tells an inner call it is already inside
   * one (join, do not re-BEGIN) and what tells the write guard below to let it through.
   */
  private txDepth = 0;
  /**
   * Transactions run one at a time. Without this two concurrent operations would interleave their
   * statements inside a single BEGIN and one ROLLBACK would discard the other's work.
   */
  private txQueue: Promise<unknown> = Promise.resolve();

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');
    initializeSchema(this.db);
  }

  /**
   * True when the CALLER is running inside this instance's open transaction. The async-context
   * marker, not the depth counter, is what distinguishes "a step of the transaction" from "another
   * request that happens to be running while it is open" — and only the second one must wait.
   */
  get insideTransaction(): boolean {
    return txContext.getStore() === this;
  }

  /** Resolves when no transaction is open. Awaited by every async write made from outside one. */
  waitForNoTransaction(): Promise<unknown> {
    return this.txQueue;
  }

  /**
   * Run `fn` in one transaction. Nested calls join the open one. See the contract on
   * `Storage.transaction`; the SQLite-specific part of it is enforced here rather than trusted:
   * transactions are serialised against each other, and `guardWrites` below makes an async write
   * started outside the transaction wait until it commits instead of landing inside it.
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.insideTransaction) return fn();
    const run = async (): Promise<T> => {
      this.txDepth = 1;
      this.db.exec('BEGIN');
      try {
        const out = await txContext.run(this, fn);
        this.db.exec('COMMIT');
        return out;
      } catch (err) {
        // A ROLLBACK that itself fails means the BEGIN never took, so there is nothing to undo. The
        // caller's error below is the real one and must not be replaced by this one.
        // eslint-disable-next-line aimeat/no-silent-catch -- see above: nothing was open to roll back
        try { this.db.exec('ROLLBACK'); } catch { /* nothing was open */ }
        throw err;
      } finally {
        this.txDepth = 0;
      }
    };
    // Queue behind any transaction already running, whether it succeeded or threw.
    const mine = this.txQueue.then(run, run);
    this.txQueue = mine.then(() => undefined, () => undefined);
    return mine;
  }

  /** Close the database connection */
  close(): void {
    this.db.close();
  }
}

/**
 * Make every ASYNC write on the prototype wait while a transaction is open. better-sqlite3 runs each
 * statement synchronously, so the only way another request's write lands inside somebody else's
 * transaction is by being scheduled at an `await` boundary — which is exactly what this closes. A
 * call made from INSIDE the transaction passes straight through, or it would wait on the
 * transaction that is waiting on it.
 *
 * Only async functions are wrapped: several internal helpers (cascadeDeleteAgentData, the
 * deserialize* mappers) are synchronous and callers depend on that, and wrapping them would turn a
 * plain value into a promise.
 */
const WRITE_METHOD = /^(create|set|update|delete|add|remove|insert|upsert|write|debit|credit|transfer|enqueue|revoke|grant|mint|save|publish|archive|deactivate|activate|link|unlink|bulk|record|append|clear|reset|mark|increment|decrement)/;

function guardWrites(proto: Record<string, unknown>): void {
  for (const name of Object.keys(proto)) {
    if (!WRITE_METHOD.test(name)) continue;
    const fn = proto[name];
    if (typeof fn !== 'function' || fn.constructor.name !== 'AsyncFunction') continue;
    const original = fn as (this: SqliteStorage, ...args: unknown[]) => Promise<unknown>;
    proto[name] = async function (this: SqliteStorage, ...args: unknown[]): Promise<unknown> {
      if (!this.insideTransaction) await this.waitForNoTransaction();
      return original.apply(this, args);
    };
  }
}

// Declaration merge: the class value provides fields + constructor + close();
// Object.assign below installs every Storage/internal method on the prototype at
// runtime, and this interface tells the type-checker they exist.
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- see note above; runtime methods come from the prototype merge, not the class body.
export interface SqliteStorage extends Storage, SqliteInternals {}

Object.assign(
  SqliteStorage.prototype,
  ownerMethods,
  cascadeMethods,
  ownerMemoryBulkMethods,
  ownerMemoryScopeMethods,
  workMethods,
  identityNodesMethods,
  governanceMethods,
  communityMethods,
  extensionsNotifyMethods,
  appsMethods,
  federationOauthMethods,
  packagesMethods,
  capabilityAgentsMethods,
  messagingMethods,
  aiProvenanceMethods,
  connectionMethods,
  financeMethods,
  outboundMethods,
  companyMethods,
);

// Applied after the merge so it wraps every method group, including any added later.
guardWrites(SqliteStorage.prototype as unknown as Record<string, unknown>);
