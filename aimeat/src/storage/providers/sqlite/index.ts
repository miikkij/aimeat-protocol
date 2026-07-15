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
 *   v1.5.0 — 2026-07-13 — Split the method bodies into ./methods/<group>.ts modules
 *     (prototype-assignment + interface-merge) so every file is ≤800 lines; bodies
 *     are byte-identical, `db`/`chunkedUploads` widened to public for the groups.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Storage, ChunkedUploadRecord } from '../../interface.js';
import { initializeSchema } from './schema.js';

import type { SqliteInternals } from './methods/internal.js';
import { ownerMethods } from './methods/owner.js';
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

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- intentional class+interface merge: the interface below declares the methods Object.assign installs on the prototype.
export class SqliteStorage {
  db: Database.Database;
  chunkedUploads = new Map<string, ChunkedUploadRecord>();

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');
    initializeSchema(this.db);
  }

  /** Close the database connection */
  close(): void {
    this.db.close();
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
);
