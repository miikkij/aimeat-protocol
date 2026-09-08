/**
 * @file src/storage/providers/sqlite/methods/memory-tally.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite method group for the memory write tally (MemoryTallyRepository). Thin async
 *   wrappers over ../repos/memory-tally.ts, which holds the SQL.
 * @structure memoryTallyMethods
 * @usage Object.assign(SqliteStorage.prototype, memoryTallyMethods) in ../index.ts
 * @version-history
 *   v1.1.0 — 2026-09-09 — listMemoryFamilyTally, countTalliedKeys and pseudonymiseTallyWriter deleted:
 *     no caller outside their unit test. deleteOwner calls repo.pseudonymiseWriter directly.
 *   v1.0.0 — 2026-08-24 — Initial creation for TARGET-073 step 8.
 */
import type { SqliteStorage } from '../index.js';
import type {
  MemoryWriteTallyRow,
  MemoryWriteTallyUpsert, MemoryFamilyTallyUpsert,
} from '../../../repositories/memory-tally.repository.js';
import * as repo from '../repos/memory-tally.js';

export const memoryTallyMethods = {
  async upsertMemoryWriteTally(this: SqliteStorage, rows: MemoryWriteTallyUpsert[]): Promise<void> {
    repo.upsertWriteTally(this.db, rows);
  },
  async upsertMemoryFamilyTally(this: SqliteStorage, rows: MemoryFamilyTallyUpsert[]): Promise<void> {
    repo.upsertFamilyTally(this.db, rows);
  },
  async listMemoryWriteTally(
    this: SqliteStorage, filter: { ownerGaii: string; key?: string; keyPrefix?: string; limit?: number },
  ): Promise<MemoryWriteTallyRow[]> {
    return repo.listWriteTally(this.db, filter);
  },
};
