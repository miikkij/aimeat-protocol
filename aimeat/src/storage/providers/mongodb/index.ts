/**
 * @file mongodb/index.ts
 * @description Prisma-backed Storage implementation, shared by the MongoDB and
 *   PostgreSQL backends. The class `PrismaStorage` holds all the query logic and
 *   uses only portable Prisma Client CRUD; `MongoStorage` and `PostgresStorage`
 *   are thin subclasses that differ only in which Prisma schema + generated client
 *   they load (via the `schemaFileName()` / `prismaClientSpecifier()` hooks).
 *   Auto-syncs the schema on startup via `prisma db push`.
 *
 * To use:
 *   1. pnpm add @prisma/client prisma
 *   2. npx prisma generate  (MongoDB) / pnpm db:generate:postgres (PostgreSQL)
 *   3. Set DATABASE_URL environment variable
 *   4. Start with: aimeat --db mongodb (or --db postgresql)
 *
 * @version-history
 *   v1.0.0 — 2025-01-15 — Initial MongoDB storage implementation
 *   v1.1.0 — 2026-05-21 — Auto-sync Prisma schema on startup (prisma db push)
 *   v1.1.1 — 2026-05-28 — createStorageFile uses upsert to match SQLite's
 *                          INSERT OR REPLACE semantics (re-uploads to the same
 *                          key now replace the file instead of throwing on the
 *                          (ownerGaii, key) unique constraint).
 *   v1.2.0 — 2026-06-05 — Add normalizeAppOwnerNames() to rewrite legacy
 *                          full-GHII app ownerName values to the bare owner name.
 *   v1.2.1 — 2026-06-05 — deleteAgentTask now removes any non-active task
 *                          (status != 'active'), not just draft/queued.
 *   v1.3.0 — 2026-06-05 — Generalised MongoStorage into a shared `PrismaStorage`
 *                          base (schemaFileName/prismaClientSpecifier hooks) so the
 *                          PostgreSQL backend can reuse the same query logic;
 *                          MongoStorage kept as a thin back-compat subclass.
 *   v1.4.0 — 2026-06-09 — Add mergeForkedAppBuckets() to consolidate ownerGaii
 *                          buckets forked across an owner's identity forms into one
 *                          canonical bucket with a unified version line.
 *   v1.5.0 — 2026-06-12 — Add SubdomainSite CRUD (operator-managed
 *                          subdomain → published-app/redirect mappings).
 *   v1.6.0 — 2026-06-15 — Persist ecosystem-app `capabilities` + `automation`
 *                          (JSON) on EcosystemApp + EcoAuth for the eco-capability
 *                          scheduler.
 *   v1.7.0 — 2026-06-15 — Add EcoAutomationRecipe CRUD (feature B4): per-(owner, app)
 *                          rule materialising agent tasks on a matching data publish.
 *   v1.8.0 — 2026-06-15 — Persist AgentTask `automation` (JSON) — ecosystem-app recipe
 *                          provenance/routing for B5 (organism) + B6 (email on completion).
 *   v1.8.1 — 2026-06-19 — Security (CR-1): reject negative/non-finite amounts in
 *                          debitBalance/creditBalance/creditBalanceCapped/transferBalance
 *                          to prevent negative-amount morsel minting (0 still allowed —
 *                          free/0-cost work escrow).
 *   v1.9.0 — 2026-06-20 — Add AppGrant CRUD (owner-issued app authorizations →
 *                          agent tokens; refresh-hash lookup, list-by-owner, rotate/revoke).
 *   v1.10.0 — 2026-07-13 — Split the method bodies into ./methods/<group>.ts modules
 *                          (prototype-assignment + interface-merge) so every file is
 *                          ≤800 lines; bodies byte-identical, `prisma`/`chunkedUploads`/
 *                          `ensureReady` widened to public for the groups, `PrismaRow`
 *                          exported, the 3 pattern helpers moved to ./methods/helpers.ts.
 *   v1.11.0 — 2026-07-14 — Background byteSize backfill on startup (backendKind() branch): sets the
 *                          exact per-row byteSize on legacy Memory rows so the total-size quota +
 *                          ?include=meta listing read correct sizes without loading values.
 * @structure PrismaStorage keeps fields, constructor, schema hooks, and lifecycle
 *   (init/syncSchema/findPrismaSchema/backfillArchiveFlag/ensureReady); every domain
 *   method group lives in ./methods/<group>.ts as an exported object literal (method
 *   shorthand, `this: PrismaStorage`) merged onto the prototype via Object.assign. The
 *   `interface PrismaStorage extends Storage, PrismaInternals` declaration merge tells
 *   the type-checker the class has every method the merge supplies at runtime.
 *   MongoStorage / PostgresStorage remain thin subclasses.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../../../utils/logger.js';
import type { Storage, ChunkedUploadRecord } from '../../interface.js';

import type { PrismaInternals } from './methods/internal.js';
import { ownerMethods } from './methods/owners.js';
import { ownerMemoryBulkMethods } from './methods/owners-memory-bulk.js';
import { ownerMemoryScopeMethods } from './methods/owner-memory-scope.js';
import { workMethods } from './methods/work.js';
import { identityMethods } from './methods/identity.js';
import { governanceMethods } from './methods/governance.js';
import { marketplaceMethods } from './methods/marketplace.js';
import { sessionsMethods } from './methods/sessions.js';
import { appsMethods } from './methods/apps.js';
import { knowledgeMethods } from './methods/knowledge.js';
import { ecosystemMethods } from './methods/ecosystem.js';
import { packagesMethods } from './methods/packages.js';
import { tasksMethods } from './methods/tasks.js';
import { messagingMethods } from './methods/messaging.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma rows are dynamically typed; two generated clients (mongo/postgres) with different shapes, so no single static row type applies.
export type PrismaRow = any;

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- intentional class+interface merge: see the interface declaration below.
export class PrismaStorage {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma client loaded dynamically; two generated clients (mongo/postgres) with different types, so no single static type applies.
    prisma: any; // PrismaClient — loaded dynamically; two generated clients exist
    chunkedUploads = new Map<string, ChunkedUploadRecord>(); // kept in-memory (transient)
    readonly ready: Promise<void>;

    constructor(databaseUrl: string) {
        // Dynamic import to avoid requiring a generated Prisma client at compile time
        this.prisma = null;
        this.ready = this.init(databaseUrl);
    }

    /**
     * Prisma schema filename this backend syncs from (under `prisma/`).
     * Overridden by PostgresStorage to point at `schema.postgres.prisma`.
     */
    protected schemaFileName(): string { return 'schema.prisma'; }

    /**
     * Module specifier for the generated Prisma client. MongoDB uses the default
     * `@prisma/client`; PostgresStorage returns an absolute path to its own
     * custom-output client so both backends can coexist in one build.
     */
    protected prismaClientSpecifier(): string { return '@prisma/client'; }

    /** Which Prisma backend this instance is — lets backend-specific migrations (raw Mongo commands vs
     *  SQL) branch. PostgresStorage overrides. */
    protected backendKind(): 'mongodb' | 'postgresql' { return 'mongodb'; }

    private async init(databaseUrl: string) {
        this.syncSchema(databaseUrl);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma client loaded dynamically; two generated clients (mongo/postgres) with different types, so no single static type applies.
        let PrismaClient: any;
        try {
            ({ PrismaClient } = await import(this.prismaClientSpecifier()));
        } catch (err) {
            throw new Error(
                `Failed to load the Prisma client (${this.prismaClientSpecifier()}). ` +
                `Generate it first — run "pnpm db:generate:postgres" for PostgreSQL or ` +
                `"pnpm db:generate" for MongoDB.`,
                { cause: err },
            );
        }
        this.prisma = new PrismaClient({ datasourceUrl: databaseUrl });
        await this.prisma.$connect();
        await this.backfillArchiveFlag();
        await this.ensureMemoryTextIndex();
        // byteSize backfill runs in the BACKGROUND — it may touch every legacy row, so it must not
        // delay readiness. Rows self-heal within moments of startup; the quota + meta listing read the
        // exact size once a row is backfilled (or on its next write). Best-effort.
        void this.backfillMemoryByteSize().catch(err =>
            logger.warn(`byteSize backfill failed: ${(err as { message?: string })?.message ?? err}`));
    }

    /**
     * Ensure the MongoDB `$text` index on Memory.searchBlob exists so searchText() runs an INDEXED text
     * search instead of a per-token regex full-scan (which was ~650ms over one owner's ~12k rows).
     * Idempotent createIndexes — a no-op once the index is present. MongoDB-only (Postgres uses its own
     * search path); best-effort, so a failure just leaves searchText on its scan fallback. Fast on any
     * realistic collection; awaited so search is indexed immediately after startup.
     */
    private async ensureMemoryTextIndex(): Promise<void> {
        if (!this.prisma || this.backendKind() !== 'mongodb') return;
        // Create the indexes EXPLICITLY via createIndexes rather than relying on `prisma db push` — Prisma's
        // MongoDB `db push` does not reliably materialise `@@index` entries (the key-prefix scans stayed at
        // ~110ms with @@index([key]) alone). createIndexes is idempotent (a no-op once present).
        //   - searchBlob $text: indexed librarian search (Prisma can't express $text at all).
        //   - key: owner-AGNOSTIC key-prefix lookups (listAllMemory: workspace-access, write-guards,
        //     publish, catalogue) filter `key` with no ownerGaii; an anchored startsWith uses this btree.
        const indexes: Array<{ key: Record<string, unknown>; name: string }> = [
            { key: { searchBlob: 'text' }, name: 'searchBlob_text' },
            { key: { key: 1 }, name: 'key_1' },
        ];
        for (const idx of indexes) {
            try {
                await this.prisma.$runCommandRaw({ createIndexes: 'Memory', indexes: [idx] });
                logger.info(`Memory index ensured: ${idx.name}`);
            } catch (err) {
                logger.warn(`Memory index ${idx.name} not created: ${(err as { message?: string })?.message ?? err}`);
            }
        }
    }

    /**
     * Backfill the per-row `byteSize` onto memory rows written BEFORE that column existed (they read as
     * 0). Both the total-size quota (sumMemoryBytes) and the `?include=meta` listing sum this column
     * DB-side WITHOUT loading values, so a 0 there under-counts usage and shows 0 bytes in the profile
     * Memory tab. We set the EXACT `Buffer.byteLength(JSON.stringify(value))` — identical to what every
     * new write stores and to the SQLite startup backfill — so legacy and fresh rows agree.
     *
     * MongoDB legacy docs LACK the field entirely; `@default(0)` applies only on READ, so a
     * `where: { byteSize: 0 }` query would not match them — we first make the field explicit 0 with a
     * raw `$set` (mirrors backfillArchiveFlag). Postgres got 0 from the add-column default already.
     * No stored value serialises to 0 bytes, so byteSize === 0 reliably means "not yet computed."
     * Runs in the background; idempotent (a completed backfill finds nothing to do).
     */
    private async backfillMemoryByteSize(): Promise<void> {
        if (!this.prisma) return;
        if (this.backendKind() === 'mongodb') {
            try {
                await this.prisma.$runCommandRaw({
                    update: 'Memory',
                    updates: [{ q: { byteSize: { $exists: false } }, u: { $set: { byteSize: 0 } }, multi: true }],
                });
            } catch (err) {
                logger.warn(`byteSize backfill (field init) skipped: ${(err as { message?: string })?.message ?? err}`);
                return;
            }
        }
        const BATCH = 500;
        let total = 0;
        for (;;) {
            const rows: Array<{ ownerGaii: string; key: string; value: unknown }> =
                await this.prisma.memory.findMany({ where: { byteSize: 0 }, select: { ownerGaii: true, key: true, value: true }, take: BATCH });
            if (!rows.length) break;
            for (const r of rows) {
                const bs = Buffer.byteLength(JSON.stringify(r.value ?? null), 'utf8') || 1; // never re-select a computed row
                await this.prisma.memory.update({ where: { ownerGaii_key: { ownerGaii: r.ownerGaii, key: r.key } }, data: { byteSize: bs } });
            }
            total += rows.length;
            if (rows.length < BATCH) break;
            await new Promise(resolve => setTimeout(resolve, 50)); // gentle on the pool during a large backfill
        }
        if (total > 0) logger.info(`byteSize backfill: set exact byteSize on ${total} legacy Memory row(s)`);
    }

    /**
     * Backfill `archived: false` onto documents written BEFORE the archive feature added the field.
     * In MongoDB such docs simply lack the field, and the default-exclude read filter does NOT match a
     * missing field — so without this, ALL pre-archive content (workspaces, manifests, registries,
     * records) silently vanishes from every default read. SQLite gets this for free via
     * `safeAddColumn(... DEFAULT 0)`; MongoDB needs an explicit one-time, idempotent backfill (only
     * touches docs missing the field; a no-op once every doc has it). Collections are the Prisma model
     * names (no @@map). Best-effort: logged, never fatal.
     */
    private async backfillArchiveFlag(): Promise<void> {
        if (!this.prisma) return;
        for (const collection of ['Memory', 'Organism']) {
            try {
                const res: { nModified?: number; n?: number } = await this.prisma.$runCommandRaw({
                    update: collection,
                    updates: [{ q: { archived: { $exists: false } }, u: { $set: { archived: false } }, multi: true }],
                });
                const n = res?.nModified ?? res?.n ?? 0;
                if (n > 0) logger.info(`Archive backfill: set archived=false on ${n} legacy ${collection} document(s)`);
            } catch (err) {
                logger.warn(`Archive backfill skipped for ${collection}: ${(err as { message?: string })?.message ?? err}`);
            }
        }
    }

    /**
     * Run `prisma db push --skip-generate` to create any missing
     * tables/collections & indexes. Safe and idempotent — never drops data.
     * Skips silently if the prisma CLI is not available.
     */
    private syncSchema(databaseUrl: string): void {
        const schemaPath = this.findPrismaSchema();
        if (!schemaPath) {
            logger.warn(`prisma/${this.schemaFileName()} not found — skipping auto schema sync`);
            return;
        }

        try {
            execSync(`npx prisma db push --skip-generate --schema "${schemaPath}"`, {
                stdio: 'pipe',
                env: { ...process.env, DATABASE_URL: databaseUrl },
                timeout: 30_000,
            });
            logger.info('Prisma schema synced');
        } catch (err) {
            const stderr = (err as { stderr?: { toString(): string } }).stderr?.toString() ?? '';
            logger.warn(`Auto schema sync skipped — run "pnpm db:push" manually if needed. ${stderr || (err instanceof Error ? err.message : String(err))}`);
        }
    }

    /** Walk up from this file to find the nearest prisma/<schema file> */
    private findPrismaSchema(): string | null {
        let dir = dirname(fileURLToPath(import.meta.url));
        for (let i = 0; i < 10; i++) {
            const candidate = resolve(dir, 'prisma', this.schemaFileName());
            if (existsSync(candidate)) return candidate;
            const parent = dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
        return null;
    }

    ensureReady() {
        if (!this.prisma) throw new Error('Prisma storage not yet initialized');
    }
}

// Declaration merge: the class value provides fields + constructor + lifecycle; the
// Object.assign below installs every Storage/internal method on the prototype at
// runtime, and this interface tells the type-checker they exist.
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- intentional class+interface merge: the interface declares the methods Object.assign installs on the prototype.
export interface PrismaStorage extends Storage, PrismaInternals {}

Object.assign(
  PrismaStorage.prototype,
  ownerMethods,
  ownerMemoryBulkMethods,
  ownerMemoryScopeMethods,
  workMethods,
  identityMethods,
  governanceMethods,
  marketplaceMethods,
  sessionsMethods,
  appsMethods,
  knowledgeMethods,
  ecosystemMethods,
  packagesMethods,
  tasksMethods,
  messagingMethods,
);

/**
 * MongoDB-backed storage. Thin subclass of {@link PrismaStorage} kept so existing
 * imports (`new MongoStorage(url)`) keep working; the MongoDB defaults
 * (`schema.prisma` + `@prisma/client`) live in the base class.
 */
export class MongoStorage extends PrismaStorage {}
