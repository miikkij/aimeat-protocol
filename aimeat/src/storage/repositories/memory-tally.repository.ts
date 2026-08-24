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
 *   TWO GRAINS, AND BOTH EARN THEIR KEEP. The per-KEY grain answers "how many hands on this one
 *   record", which is the question a deletion request asks. The per-FAMILY grain is what a data-map
 *   row renders and what the coverage view sums, without scanning 18,446 keys for one owner. Folding
 *   to one would lose one of those two questions outright.
 *
 *   `keyCount` is deliberately not a column. A distinct-key count is not derivable from an upsert,
 *   and holding it in the write buffer would be wrong across a restart; countTalliedKeys does it in
 *   SQL against the (ownerGaii, key) index instead.
 * @structure MemoryWriteTallyRow · MemoryFamilyTallyRow · MemoryTallyUpsert · MemoryTallyRepository
 * @usage implemented by both storage providers; called through Storage.
 * @version-history
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

/** The same, folded to the key family, with the basis the family was identified on at write time. */
export interface MemoryFamilyTallyRow extends Omit<MemoryWriteTallyRow, 'key'> {
  keyFamily: string;
  tier: string;
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

  /** Hands on one family, or on all of an owner's families. */
  listMemoryFamilyTally(filter: {
    ownerGaii: string; family?: string; limit?: number;
  }): Promise<MemoryFamilyTallyRow[]>;

  /** How many DISTINCT keys a family has actually seen written. Not derivable from an upsert. */
  countTalliedKeys(ownerGaii: string, familyPrefix: string): Promise<number>;

  /**
   * Erasure. When an owner is deleted, rows in THEIR OWN namespace go with the rest of their data —
   * a released username would otherwise hand the next registrant somebody else's history. But a row
   * where they were the WRITER into somebody else's namespace belongs to the receiving owner: it is
   * that owner's record of who touched their data, and deleting it would turn their "four hands"
   * into three. So the writer is pseudonymised instead — `erased:{12 hex of sha256}`, a stable hash
   * so two erased writers do not merge into one.
   *
   * Returns how many rows were rewritten.
   */
  pseudonymiseTallyWriter(ownerName: string, nodeId: string): Promise<number>;
}
