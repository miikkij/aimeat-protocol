/**
 * @file src/storage/providers/postgres-kysely/index.ts
 * @description PostgreSQL + Kysely storage provider — the Prisma-free backend chosen by the Phase-4
 *   benchmark (dev-organism doc-s4hgvp5 / doc-ve32ack). Mirrors the SQLite provider's shape: a class
 *   holding the Kysely instance + pg pool, a `ready` promise that runs the SQL migrations on first boot,
 *   and a declaration-merge (`interface … extends Storage`) plus a runtime `Object.assign(prototype, …)`
 *   of per-domain method groups. Domains are filled in incrementally (build+verify order in the plan);
 *   a not-yet-implemented method is absent from the prototype and throws when called — its E2E suite
 *   stays red until that domain lands. Memory is the first domain (graduated from the Phase-4 adapter).
 * @structure
 *   - class PostgresKyselyStorage: db + pool + ready + close
 *   - interface PostgresKyselyStorage extends Storage, PgKyselyInternals (declaration merge)
 *   - Object.assign(prototype, memoryMethods, …future groups)
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: provider skeleton + migration runner + memory domain.
 */
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { ChunkedUploadRecord, MemoryRecord, Storage } from '../../interface.js';
import type { DB } from './db-types.js';
import { runMigrations } from './migrate.js';
import { memoryMethods } from './methods/memory.js';
import { systemMethods } from './methods/system.js';
import { identityMethods } from './methods/identity.js';
import { walletMethods } from './methods/wallet.js';
import { sessionMethods } from './methods/sessions.js';
import { schemaMethods } from './methods/schema.js';
import { agentOnboardingMethods } from './methods/agent-onboarding.js';
import { fileMethods } from './methods/files.js';
import { microMemoryMethods } from './methods/micro-memory.js';
import { organismMethods } from './methods/organisms.js';
import { boardMethods } from './methods/boards.js';
import { consentMethods } from './methods/consent.js';
import { workMethods } from './methods/work.js';
import { deviceAuthMethods } from './methods/device-auth.js';
import { startupCompatMethods } from './methods/startup-compat.js';

/** Internal helpers the method groups call on `this` but that are NOT part of the public Storage API. */
interface PgKyselyInternals {
  _rawMemory(ownerGaii: string, key: string): Promise<MemoryRecord | null>;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- intentional class+interface merge: the interface below declares the methods Object.assign installs on the prototype.
export class PostgresKyselyStorage {
  readonly db: Kysely<DB>;
  readonly pool: pg.Pool;
  /** Resolves once the schema migrations have been applied — awaited by the storage factory. */
  readonly ready: Promise<void>;
  /** Transient chunked-upload buffer (never persisted), same as the other backends. */
  readonly chunkedUploads = new Map<string, ChunkedUploadRecord>();

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 20 });
    this.db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: this.pool }) });
    this.ready = runMigrations(this.pool);
  }

  async close(): Promise<void> {
    await this.db.destroy();   // ends the pool too
  }
}

// Declaration merge: the class gains the whole Storage surface at the type level (the prototype is filled
// domain by domain below). Unimplemented methods exist in the type but throw at runtime until assigned.
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- see note above; runtime methods come from the prototype merge, not the class body.
export interface PostgresKyselyStorage extends Storage, PgKyselyInternals {}

Object.assign(
  PostgresKyselyStorage.prototype,
  memoryMethods,
  systemMethods,
  identityMethods,
  walletMethods,
  sessionMethods,
  schemaMethods,
  agentOnboardingMethods,
  fileMethods,
  microMemoryMethods,
  organismMethods,
  boardMethods,
  consentMethods,
  workMethods,
  deviceAuthMethods,
  startupCompatMethods,
);
