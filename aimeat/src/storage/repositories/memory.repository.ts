/**
 * @file src/storage/repositories/memory.repository.ts
 * @description Backend-agnostic storage contract for the memory subsystem — set/get/list/delete/count,
 *   optimistic-locked updates, per-owner and cross-owner substring search, native ranked full-text
 *   search (the Tier-1 librarian primitive), flag counting, admin-wide listing, and version-history
 *   for trackable keys. Implemented per storage backend (SQLite FTS5 / MongoDB $text / Postgres).
 *
 * @structure
 *   - MemoryVersionRecord / MemoryTextHit / MemoryTextSearchOpts: supporting types for history + FTS
 *   - MemoryRepository: the interface (setMemory, getMemory, listMemory, countMemory, searchMemory)
 *   - searchText(query, opts): indexed, best-first cross-owner full-text retrieval
 *   - listMemoryVersions/listAllMemory: trackable-key history and admin-wide enumeration
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { ArchiveFilter, MemoryRecord } from '../interface.js';

/** One archived prior version of a TRACKABLE memory key — appended to the history table when the key
 *  is overwritten, so memory keeps only the latest version while history is queried on demand. */
export interface MemoryVersionRecord {
  ownerGaii: string;
  key: string;
  version: number;
  value: unknown;
  /** Who/what caused the change that retired this version (optional, set by the writer). */
  actor?: string | null;
  /** A short label for the change (e.g. a structure-diff summary), optional. */
  event?: string | null;
  /** ISO timestamp this version was archived (the retired version's updatedAt). */
  recordedAt: string;
}

/** A single ranked full-text hit from {@link MemoryRepository.searchText}. */
export interface MemoryTextHit {
  record: MemoryRecord;
  /** Relevance score, backend-normalized so HIGHER is always better (best-first order). */
  score: number;
}

/** Options for {@link MemoryRepository.searchText} — the Tier-1 librarian retrieval primitive. */
export interface MemoryTextSearchOpts {
  /** Restrict to memory owned by any of these GAIIs/GHIIs (OR). Omit to search every owner. */
  ownerGaiis?: string[];
  /** Restrict to keys beginning with this prefix (e.g. `organism.{id}.`). */
  keyPrefix?: string;
  /** Restrict to a single visibility value. */
  visibility?: string;
  /** Drop records whose flagCount exceeds this. */
  maxFlags?: number;
  /** Max hits to return (default 50). */
  limit?: number;
  /** Archived-row handling. Default `exclude` (live FTS index only) → archived content never leaks into
   *  a normal librarian search; `only` searches the archive index; `include` searches both. */
  archived?: ArchiveFilter;
}

export interface MemoryRepository {
  setMemory(record: MemoryRecord): Promise<MemoryRecord>;
  /** Atomically update memory only if the current version matches expectedVersion. Returns null on conflict. */
  setMemoryIfVersion?(record: MemoryRecord, expectedVersion: number): Promise<MemoryRecord | null>;
  getMemory(ownerGaii: string, key: string): Promise<MemoryRecord | null>;
  listMemory(ownerGaii: string, opts?: { prefix?: string; visibility?: string; tags?: string[]; maxFlags?: number; archived?: ArchiveFilter }): Promise<MemoryRecord[]>;
  /**
   * Count DISTINCT memory keys across the given owner identities (GHII + agents + GEAIs) — cheap
   * (no values loaded/transferred), mirroring listOwnerScopeMemory's key-dedup. For stat displays
   * (e.g. "N Muistit") that need only the number, not the records.
   */
  countMemory(ownerGaiis: string[], opts?: { prefix?: string; visibility?: string; archived?: ArchiveFilter }): Promise<number>;
  deleteMemory(ownerGaii: string, key: string): Promise<boolean>;
  deleteAllMemory(ownerGaii: string): Promise<number>;
  incrementMemoryFlagCount(ownerGaii: string, key: string): Promise<void>;
  searchMemory(ownerGaii: string, query: string, opts?: { visibility?: string; maxFlags?: number; prefix?: string; archived?: ArchiveFilter; limit?: number }): Promise<MemoryRecord[]>;
  /**
   * Native full-text search over memory values (Tier-1 librarian retrieval). Indexed + ranked
   * (SQLite FTS5 / MongoDB `$text`), best-first. Unlike {@link searchMemory} (single owner, O(n)
   * substring scan) this is the cross-owner primitive the librarian fans across organisms with.
   */
  searchText(query: string, opts?: MemoryTextSearchOpts): Promise<MemoryTextHit[]>;
  /** List all memory across all owners with optional filtering and pagination (admin). */
  listAllMemory(opts?: { prefix?: string; ownerPrefix?: string; visibility?: string; limit?: number; offset?: number; archived?: ArchiveFilter }): Promise<{ items: MemoryRecord[]; total: number }>;
  /**
   * List archived prior versions of a TRACKABLE memory key, newest version first. Only keys marked
   * `trackable` accumulate history (the latest value always lives in `getMemory`). Empty for keys that
   * were never trackable or never overwritten. Backs the organism structure timeline (Osa D).
   */
  listMemoryHistory(ownerGaii: string, key: string, opts?: { limit?: number }): Promise<MemoryVersionRecord[]>;

  /**
   * ARCHIVE — flag every currently-ACTIVE memory row under a key (exact or prefix) as archived,
   * stamping archivedAt/By/Root. Operates by KEY across all owners (organism content is keyed
   * `organism.{id}.*` but owned by member GHIIs), so it cascades a record-table / workspace /
   * organism in one statement. Already-archived rows are left untouched so they keep their own
   * `archivedRoot` (smart restore). Returns the number of rows newly archived.
   */
  archiveMemoryByKey(keyOrPrefix: string, opts: { archivedRoot: string; archivedBy: string; archivedAt: string; match?: 'exact' | 'prefix' | 'subtree' }): Promise<number>;
  /**
   * UNARCHIVE — clear the archive flag on every row whose `archivedRoot` matches (smart restore:
   * restores ONLY what THIS root's archival flagged; rows archived under a different root stay
   * archived). Used by CONTAINER unarchive (organism/workspace/space). Returns rows restored.
   */
  unarchiveMemoryByRoot(archivedRoot: string): Promise<number>;
  /**
   * UNARCHIVE BY KEY — clear the archive flag on every archived row under a key (exact/prefix/subtree),
   * regardless of which `archivedRoot` flagged it. Used by RECORD-level unarchive: "make THIS record
   * active" is unambiguous, so it restores the whole instance even if parts were archived by an
   * earlier container cascade (or, in a multi-writer workspace, a co-owner's copy). Returns rows restored.
   */
  unarchiveMemoryByKey(keyOrPrefix: string, opts?: { match?: 'exact' | 'prefix' | 'subtree' }): Promise<number>;
  /** Count active vs archived memory rows under a key prefix (for "N active, M archived" overview counts). */
  countArchivedByKeyPrefix(keyPrefix: string): Promise<{ active: number; archived: number }>;
}
