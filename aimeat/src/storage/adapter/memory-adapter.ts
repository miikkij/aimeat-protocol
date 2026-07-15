/**
 * @file src/storage/adapter/memory-adapter.ts
 * @description The THIN, workload-shaped storage-adapter contract for the memory domain — the bottom
 *   layer of the data-access redesign (see dev-organism notes doc-id925fp / doc-nswlymr). An adapter
 *   exposes ONLY the primitives that are unavoidably backend-specific (indexed prefix reads,
 *   cross-owner IN reads, full-text search, DB-side aggregates, bulk writes, transactions). It carries
 *   NO business logic and NO cross-domain knowledge — the MemoryRepository composes these primitives
 *   into domain operations, and the MemoryDbService orchestrates whole operations on top.
 *
 *   Deliberately NOT a generic `findMany(where)`: every primitive is named for the workload it serves
 *   so each backend (SQLite FTS5 / Mongo $text / a future Postgres tsvector) can implement it the
 *   optimal way. Phase 0 ships one implementation — {@link ./legacy-memory-adapter.js} — that wraps the
 *   existing fat `Storage` provider so the new layer coexists with zero behaviour change.
 *
 * @structure
 *   - ListOpts / CountOpts / KeyPrefixOpts: the query-shaping option bags (subset of the old Storage opts)
 *   - Transactor: the withTransaction seam (UnitOfWork consumes this)
 *   - MemoryStorageAdapter: the primitive set (read / cross-owner read / meta / aggregate / write / bulk / search)
 *
 * @usage
 *   const adapter: MemoryStorageAdapter = new LegacyMemoryAdapter(storage);
 *   const rows = await adapter.findByOwners(gaiis, { prefix: 'organism.' });
 *
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 0 scaffolding: contract defined; wraps existing Storage (coexist).
 */
import type { ArchiveFilter, MemoryRecord } from '../interface.js';
import type {
  MemoryMetaRow,
  MemoryTextHit,
  MemoryTextSearchOpts,
  MemoryVersionRecord,
} from '../repositories/memory.repository.js';

export type { MemoryMetaRow, MemoryTextHit, MemoryTextSearchOpts, MemoryVersionRecord };

/** Filters for a keyspace listing (single owner or an IN-set of owners). Mirrors the existing
 *  Storage.listMemory options so the wrap is behaviour-preserving. */
export interface ListOpts {
  prefix?: string;
  visibility?: string;
  tags?: string[];
  maxFlags?: number;
  archived?: ArchiveFilter;
}

/** Filters for a DISTINCT-key count across an IN-set of owners (no values loaded). */
export interface CountOpts {
  prefix?: string;
  visibility?: string;
  archived?: ArchiveFilter;
}

/** Filters for the owner-agnostic, key-prefix admin scan (organism content is keyed `organism.{id}.*`
 *  but owned by member GHIIs, so it is found by KEY not owner). */
export interface KeyPrefixOpts {
  prefix?: string;
  ownerPrefix?: string;
  visibility?: string;
  limit?: number;
  offset?: number;
  archived?: ArchiveFilter;
}

/** A (ownerGaii, key) pair — the address of one memory row, used by the bulk-delete primitive. */
export interface MemoryRef {
  ownerGaii: string;
  key: string;
}

/**
 * The transaction seam. A UnitOfWork runs a multi-step operation inside `withTransaction` so shared
 * entities are staged and committed atomically. Phase 0's legacy adapter runs the callback directly
 * (no real transaction — the fat provider offers none at this seam); per-backend adapters (Phase 4)
 * implement a real ACID transaction here. Kept as its own interface so the UnitOfWork depends on the
 * capability, not on the whole adapter.
 */
export interface Transactor {
  withTransaction<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * The memory-domain storage adapter — the thin primitive set. Every method maps to at most one
 * round-trip per backend. Composition (owner-scope union, dedup, quota orchestration) lives ABOVE
 * this, in the repository/service. Do not add business logic or cross-domain reads here.
 */
export interface MemoryStorageAdapter extends Transactor {
  // ── Point + cross-owner reads ──────────────────────────────────────
  /** One row by exact (ownerGaii, key). */
  getByKey(ownerGaii: string, key: string): Promise<MemoryRecord | null>;
  /** One key across MANY identities in a single IN query (owner-scope point read). Rows may repeat the
   *  key under several owners; the caller dedups. */
  getByOwners(ownerGaiis: string[], key: string): Promise<MemoryRecord[]>;
  /** MANY keys under ONE owner in a single `key IN (…)` query (batched existing-row lookup for a bulk
   *  write). Returns only live keys that exist; order is not guaranteed. */
  getByKeys(ownerGaii: string, keys: string[]): Promise<MemoryRecord[]>;

  // ── Keyspace listings ──────────────────────────────────────────────
  /** One owner's keyspace. */
  findByOwner(ownerGaii: string, opts?: ListOpts): Promise<MemoryRecord[]>;
  /** MANY owners' keyspaces in one IN query (owner-scope union, pre-dedup). */
  findByOwners(ownerGaiis: string[], opts?: ListOpts): Promise<MemoryRecord[]>;
  /** Value-free META rows for one owner (`?include=meta`). */
  findMetaByOwner(ownerGaii: string, opts?: ListOpts): Promise<MemoryMetaRow[]>;
  /** Value-free META rows across MANY owners in one IN query. */
  findMetaByOwners(ownerGaiis: string[], opts?: ListOpts): Promise<MemoryMetaRow[]>;
  /** Owner-agnostic key-prefix scan with paging + total (admin/discover; organism content by key). */
  findByKeyPrefix(opts?: KeyPrefixOpts): Promise<{ items: MemoryRecord[]; total: number }>;

  // ── DB-side aggregates (no values transferred) ─────────────────────
  /** DISTINCT-key count across an IN-set of owners. */
  countByOwners(ownerGaiis: string[], opts?: CountOpts): Promise<number>;
  /** Sum of value byteSize for one owner. */
  sumBytesByOwner(ownerGaii: string): Promise<number>;
  /** Sum of value byteSize across an IN-set of owners. */
  sumBytesByOwners(ownerGaiis: string[]): Promise<number>;

  // ── Full-text search ───────────────────────────────────────────────
  /** Indexed, ranked cross-owner full-text search (the Tier-1 librarian primitive). */
  textSearch(query: string, opts?: MemoryTextSearchOpts): Promise<MemoryTextHit[]>;

  // ── Writes ─────────────────────────────────────────────────────────
  /** Upsert one row (version bump + history handled by the backend). */
  upsert(record: MemoryRecord): Promise<MemoryRecord>;
  /** Optimistic-locked upsert — null on version conflict. Undefined when the backend lacks it. */
  upsertIfVersion?(record: MemoryRecord, expectedVersion: number): Promise<MemoryRecord | null>;
  /** Upsert MANY rows. Phase 0: sequential over {@link upsert}; per-backend adapters replace this with
   *  a single bulk statement (COPY / bulkWrite / multi-row INSERT). */
  bulkUpsert(records: MemoryRecord[]): Promise<MemoryRecord[]>;

  // ── Deletes ────────────────────────────────────────────────────────
  /** Delete one row; true if a row was removed. */
  deleteByKey(ownerGaii: string, key: string): Promise<boolean>;
  /** Delete MANY rows by (ownerGaii, key); returns the number removed. Phase 0: sequential. */
  bulkDelete(refs: MemoryRef[]): Promise<number>;
  /** Delete a record's whole family (`baseKey` + `baseKey.*` children) under one owner in one statement,
   *  WITHOUT matching a sibling `baseKeyX`. Returns rows removed. */
  deleteSubtree(ownerGaii: string, baseKey: string): Promise<number>;

  // ── History ────────────────────────────────────────────────────────
  /** Archived prior versions of a trackable key, newest first. */
  history(ownerGaii: string, key: string, opts?: { limit?: number }): Promise<MemoryVersionRecord[]>;
}
