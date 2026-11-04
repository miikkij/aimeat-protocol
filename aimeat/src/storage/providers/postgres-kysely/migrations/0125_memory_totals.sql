-- 0125_memory_totals.sql
-- Each principal's memory as the write ceilings count it, kept by the database in the statement that
-- changes a row (codebase analysis 2026-11-03, item C3). Every memory write summed "byteSize" over
-- every row of the writer, and a write that added a key also counted them: two scans of up to
-- 100 000 rows per write. storage.getMemoryTotals reads these rows instead (src/storage/memory-totals.ts).
--
-- WHAT IS COUNTED, the answers of the two queries it replaces, exactly:
--   keys  = countMemory([owner], { excludePrefixes: MEMORY_COUNT_EXCLUDED_PREFIXES }): rows not in the
--           bin ("deletedAt" IS NULL), not archived, whose key is outside 'commerce.ucp.idem.' and
--           'commerce.ucp.session.' (the literals below are that list, src/storage/memory-totals.ts).
--   bytes = sumMemoryBytes(owner): "byteSize" of every row not archived, a row in the bin included.
--
-- DELTA ROWS, NOT ONE ROW PER OWNER. Each statement that changes "Memory" appends one row per owner it
-- touched, holding the change; the totals are the sum of an owner's rows. Appending takes no lock that
-- another writer waits for, so two transactions that write the same owners in a different order cannot
-- deadlock on the totals, as they could if each updated one shared row. The memory TTL job folds each
-- owner's rows into one (compactMemoryTotals). An owner whose rows sum to zero, as after the owner
-- cascade, leaves no row behind after the fold.

CREATE TABLE IF NOT EXISTS "MemoryTotals" (
  "id"        BIGSERIAL PRIMARY KEY,
  "ownerGaii" TEXT NOT NULL,
  "keys"      BIGINT NOT NULL,
  "bytes"     BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "MemoryTotals_ownerGaii_idx" ON "MemoryTotals" ("ownerGaii");

-- One row's share of `keys` and of `bytes`.
CREATE OR REPLACE FUNCTION memory_totals_key_share("key" TEXT, "archived" BOOLEAN, "deletedAt" TIMESTAMPTZ)
  RETURNS BIGINT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN $3 IS NULL AND NOT $2
    AND $1 NOT LIKE 'commerce.ucp.idem.%' AND $1 NOT LIKE 'commerce.ucp.session.%' THEN 1 ELSE 0 END::BIGINT
$$;
CREATE OR REPLACE FUNCTION memory_totals_byte_share("archived" BOOLEAN, "byteSize" INTEGER)
  RETURNS BIGINT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN NOT $1 THEN $2 ELSE 0 END::BIGINT
$$;

-- The statement's change per owner: the new rows counted in, the old rows counted out.
CREATE OR REPLACE FUNCTION memory_totals_on_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "MemoryTotals" ("ownerGaii", "keys", "bytes")
    SELECT "ownerGaii", sum(k), sum(b) FROM (
      SELECT "ownerGaii", memory_totals_key_share("key", "archived", "deletedAt") AS k,
             memory_totals_byte_share("archived", "byteSize") AS b FROM new_rows
    ) d GROUP BY "ownerGaii" HAVING sum(k) <> 0 OR sum(b) <> 0;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO "MemoryTotals" ("ownerGaii", "keys", "bytes")
    SELECT "ownerGaii", sum(k), sum(b) FROM (
      SELECT "ownerGaii", memory_totals_key_share("key", "archived", "deletedAt") AS k,
             memory_totals_byte_share("archived", "byteSize") AS b FROM new_rows
      UNION ALL
      SELECT "ownerGaii", -memory_totals_key_share("key", "archived", "deletedAt"),
             -memory_totals_byte_share("archived", "byteSize") FROM old_rows
    ) d GROUP BY "ownerGaii" HAVING sum(k) <> 0 OR sum(b) <> 0;
  ELSE
    INSERT INTO "MemoryTotals" ("ownerGaii", "keys", "bytes")
    SELECT "ownerGaii", -sum(k), -sum(b) FROM (
      SELECT "ownerGaii", memory_totals_key_share("key", "archived", "deletedAt") AS k,
             memory_totals_byte_share("archived", "byteSize") AS b FROM old_rows
    ) d GROUP BY "ownerGaii" HAVING sum(k) <> 0 OR sum(b) <> 0;
  END IF;
  RETURN NULL;
END
$$;

-- TRUNCATE fires no row or statement DELETE trigger; it empties the totals with the table.
CREATE OR REPLACE FUNCTION memory_totals_on_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "MemoryTotals";
  RETURN NULL;
END
$$;

-- No write may land between the count below and the triggers taking over: the lock is held until this
-- migration's transaction commits, and a writer waits for it.
LOCK TABLE "Memory" IN SHARE ROW EXCLUSIVE MODE;

DROP TRIGGER IF EXISTS "Memory_totals_insert" ON "Memory";
DROP TRIGGER IF EXISTS "Memory_totals_update" ON "Memory";
DROP TRIGGER IF EXISTS "Memory_totals_delete" ON "Memory";
DROP TRIGGER IF EXISTS "Memory_totals_truncate" ON "Memory";
CREATE TRIGGER "Memory_totals_insert" AFTER INSERT ON "Memory"
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION memory_totals_on_change();
CREATE TRIGGER "Memory_totals_update" AFTER UPDATE ON "Memory"
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION memory_totals_on_change();
CREATE TRIGGER "Memory_totals_delete" AFTER DELETE ON "Memory"
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION memory_totals_on_change();
CREATE TRIGGER "Memory_totals_truncate" AFTER TRUNCATE ON "Memory"
  FOR EACH STATEMENT EXECUTE FUNCTION memory_totals_on_truncate();

-- The rows already there, counted once.
DELETE FROM "MemoryTotals";
INSERT INTO "MemoryTotals" ("ownerGaii", "keys", "bytes")
SELECT "ownerGaii", sum(memory_totals_key_share("key", "archived", "deletedAt")),
       sum(memory_totals_byte_share("archived", "byteSize"))
FROM "Memory" GROUP BY "ownerGaii"
HAVING sum(memory_totals_key_share("key", "archived", "deletedAt")) <> 0
    OR sum(memory_totals_byte_share("archived", "byteSize")) <> 0;
