/**
 * @file src/storage/providers/sqlite/schema-memory-indexes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The SQLite twins of PostgreSQL migration 0124_memory_query_indexes.sql: indexes for
 *   the query shapes on `memory` that no index served (codebase analysis 2026-11-03, item C6).
 *   - idx_memory_expiry: the TTL sweep (repos/memory.ts deleteExpiredMemory), by the expression the
 *     sweep compares, only over rows that carry a time to live. julianday() of a stored column is
 *     deterministic, which an index expression requires.
 *   - idx_memory_public_recent: the newest public records (listAllMemory and listAllMemoryMeta with a
 *     visibility and newestFirst). The visibility is the first column rather than a partial-index
 *     condition, because the statement binds it as a parameter and SQLite uses a partial index only
 *     when the statement names the condition's literal; the bin condition is a literal there.
 *   - The owner prefix list needs no index here: the primary key (ownerGaii, key) is BINARY, and a
 *     GLOB prefix is a range on it.
 *   Run from SqliteStorage's constructor after initializeSchema, on every start (IF NOT EXISTS).
 * @structure applyMemoryQueryIndexes(db)
 * @usage applyMemoryQueryIndexes(db);
 * @version-history
 *   2026-11-04 — Initial (codebase analysis 2026-11-03, item C6).
 */
import type Database from 'better-sqlite3';

export function applyMemoryQueryIndexes(db: Database.Database): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memory_expiry ON memory ((julianday(createdAt) + ttlHours / 24.0))
      WHERE ttlHours IS NOT NULL AND ttlHours <> 0;
    CREATE INDEX IF NOT EXISTS idx_memory_public_recent ON memory (visibility, updatedAt DESC, key, ownerGaii)
      WHERE deletedAt IS NULL;
  `);
}
