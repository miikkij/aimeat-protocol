-- 0124_memory_query_indexes.sql
-- Indexes for three query shapes on "Memory" that no index served (codebase analysis 2026-11-03,
-- item C6). Additive: three indexes, no column and no row changes.

-- 1. The TTL sweep (core:memory-ttl-cleanup, every five minutes; deleteExpiredMemory): the rows that
--    carry a time to live, by the moment it ends. The expression is the sweep's own, so the planner
--    matches it; timestamp(3) + double * interval is immutable, which an index expression requires.
--    Without it the sweep was a sequential scan of the whole table 288 times a day.
CREATE INDEX IF NOT EXISTS "Memory_expiry_idx"
  ON "Memory" (("createdAt" + ("ttlHours" * interval '1 hour')))
  WHERE "ttlHours" IS NOT NULL AND "ttlHours" <> 0;

-- 2. Public records newest first (GET /v1/public/activity-ticker and /v1/public/node-stats-today,
--    listAllMemory with visibility 'public' and newestFirst): the columns of its ORDER BY, so the
--    window is read in order and stops at the LIMIT instead of sorting every public row.
CREATE INDEX IF NOT EXISTS "Memory_public_recent_idx"
  ON "Memory" ("updatedAt" DESC, "key", "ownerGaii")
  WHERE "visibility" = 'public' AND "deletedAt" IS NULL;

-- 3. One owner's keys under a prefix (listMemory and listMemoryMeta with a prefix, key LIKE 'p%'), and
--    the page of a listing in byte order (MemoryListOpts limit and after, item C1). A LIKE prefix uses a
--    btree as a range only under the C collation or a pattern operator class; the database collation
--    of the development and test servers is en_US.utf8, where the unique ("ownerGaii", "key") index
--    serves the owner and not the prefix. A key column in COLLATE "C" serves both shapes.
CREATE INDEX IF NOT EXISTS "Memory_owner_key_c_idx"
  ON "Memory" ("ownerGaii", "key" COLLATE "C");
