/**
 * @file src/storage/repositories/memory-tally.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Backend-agnostic contract for the memory write tally — who has had their hands on a
 *   key, and how often. Two grains, both upserts, both permanent.
 *
 *   THERE IS NO PRUNE METHOD, and there is not going to be one. Every other rollup on this node
 *   keeps a window; this one keeps everything, because the count IS the record. A key gets rewritten
 *   and the value changes, and how many hands were on it is the part nobody can reconstruct
 *   afterwards. A column on the memory row could not hold it — the next write overwrites it, so it
 *   would only ever name the last writer — and the row has to outlive the key: a deleted key whose
 *   tally says "four principals, 900 writes" is exactly what somebody answering a deletion request
 *   needs.
 *
 *   TWO GRAINS. The per-KEY grain answers "how many hands on this one record", which is the question
 *   a deletion request asks, and it is what memory-hands and the data map read. The per-FAMILY grain
 *   is written beside it by the same buffer so the question can one day be asked per family without
 *   scanning 18,446 keys for one owner; its reader was deleted on 2026-09-09 for having no caller,
 *   so today it accumulates and nothing reads it.
 *
 *   `keyCount` is deliberately not a column. A distinct-key count is not derivable from an upsert,
 *   and holding it in the write buffer would be wrong across a restart; when it is needed it is one
 *   COUNT(DISTINCT key) against the (ownerGaii, key) index.
 *
 *   ERASURE runs inside deleteOwner on each provider (pseudonymiseWriter on SQLite,
 *   pseudonymiseTallyWriterDb on Postgres): rows where the erased owner was the WRITER into somebody
 *   else's namespace keep their counts under a stable `erased:{hash}` marker, because they are the
 *   receiving owner's record of who touched their data.
 * @structure MemoryWriteTallyRow · MemoryTallyUpsert · MemoryTallyRepository
 * @usage implemented by both storage providers; called through Storage.
 * @version-history
 *   v1.1.0 — 2026-09-09 — listMemoryFamilyTally, countTalliedKeys and pseudonymiseTallyWriter deleted
 *     from the Storage surface: no caller outside their own unit test. The erasure stays as a
 *     provider-level function the owner cascade calls directly. MemoryFamilyTallyRow went with its reader.
 *   v1.0.0 — 2026-08-24 — Initial creation for TARGET-073 step 8.
 */

/** One (key, principal) pair. */
export interface MemoryWriteTallyRow {
  ownerGaii: string;
  key: string;
  writerPrincipal: string;
  writeCount: number;
  deleteCount: number;
  firstAt: string;
  lastAt: string;
}

/** One touch to fold in. Counts are DELTAS to add, never absolutes to set. */
export interface MemoryTallyUpsert {
  ownerGaii: string;
  writerPrincipal: string;
  writeCount: number;
  deleteCount: number;
  at: string;
}

export interface MemoryWriteTallyUpsert extends MemoryTallyUpsert { key: string }
export interface MemoryFamilyTallyUpsert extends MemoryTallyUpsert { keyFamily: string; tier: string }

export interface MemoryTallyRepository {
  /**
   * Fold touches into the per-key tally. Adds the deltas, keeps the EARLIEST firstAt and the LATEST
   * lastAt, and creates the row when it is the first sighting of that pair.
   */
  upsertMemoryWriteTally(rows: MemoryWriteTallyUpsert[]): Promise<void>;
  /** The same, folded to the family. `tier` is written on insert and refreshed on update. */
  upsertMemoryFamilyTally(rows: MemoryFamilyTallyUpsert[]): Promise<void>;

  /** Hands on one key, or on everything under a prefix. */
  listMemoryWriteTally(filter: {
    ownerGaii: string; key?: string; keyPrefix?: string; limit?: number;
  }): Promise<MemoryWriteTallyRow[]>;
}
