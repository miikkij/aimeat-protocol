import type { MemoryRecord } from '../interface.js';

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
}

export interface MemoryRepository {
  setMemory(record: MemoryRecord): Promise<MemoryRecord>;
  /** Atomically update memory only if the current version matches expectedVersion. Returns null on conflict. */
  setMemoryIfVersion?(record: MemoryRecord, expectedVersion: number): Promise<MemoryRecord | null>;
  getMemory(ownerGaii: string, key: string): Promise<MemoryRecord | null>;
  listMemory(ownerGaii: string, opts?: { prefix?: string; visibility?: string; tags?: string[]; maxFlags?: number }): Promise<MemoryRecord[]>;
  /**
   * Count DISTINCT memory keys across the given owner identities (GHII + agents + GEAIs) — cheap
   * (no values loaded/transferred), mirroring listOwnerScopeMemory's key-dedup. For stat displays
   * (e.g. "N Muistit") that need only the number, not the records.
   */
  countMemory(ownerGaiis: string[], opts?: { prefix?: string; visibility?: string }): Promise<number>;
  deleteMemory(ownerGaii: string, key: string): Promise<boolean>;
  deleteAllMemory(ownerGaii: string): Promise<number>;
  incrementMemoryFlagCount(ownerGaii: string, key: string): Promise<void>;
  searchMemory(ownerGaii: string, query: string, opts?: { visibility?: string; maxFlags?: number }): Promise<MemoryRecord[]>;
  /**
   * Native full-text search over memory values (Tier-1 librarian retrieval). Indexed + ranked
   * (SQLite FTS5 / MongoDB `$text`), best-first. Unlike {@link searchMemory} (single owner, O(n)
   * substring scan) this is the cross-owner primitive the librarian fans across organisms with.
   */
  searchText(query: string, opts?: MemoryTextSearchOpts): Promise<MemoryTextHit[]>;
  /** List all memory across all owners with optional filtering and pagination (admin). */
  listAllMemory(opts?: { prefix?: string; ownerPrefix?: string; visibility?: string; limit?: number; offset?: number }): Promise<{ items: MemoryRecord[]; total: number }>;
}
