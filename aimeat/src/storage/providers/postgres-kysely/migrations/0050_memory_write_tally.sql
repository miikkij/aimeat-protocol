-- 0050_memory_write_tally.sql — who has had their hands on a memory key, and how often.
--
-- THERE IS NO PRUNE JOB HERE, AND THAT IS DELIBERATE. Every other rollup on this node has a
-- retention window: UsageCall keeps 90 days hot, ExecutionLog 30, AccountEvent a 100-row window,
-- ConsentAudit 365 days. This one keeps everything, forever, and the next person reading it will
-- assume otherwise unless it says so here. The reason is that the count IS the record: a key gets
-- rewritten and its value changes, and what nobody can reconstruct afterwards is how many hands were
-- on it. A column on Memory could not hold that — the next write overwrites it, so it would only ever
-- name the last writer. And the row has to outlive the key itself: a deleted key whose tally says
-- "four principals, 900 writes, last hand on this date" is exactly the row somebody answering a
-- deletion request needs.
--
-- WHY AN UPSERT AND NOT A LOG. Measured on this node's heaviest owner, 2026-08-24: 18,446 memory keys
-- carrying 990,452 lifetime writes. Six keys have over 10,800 writes each — the agent statistics
-- records a scheduled job rewrites every minute. An append-only log would have written 990,452 rows
-- to hold what these two tables hold in ~18,400. Rows grow with distinct (key, principal) pairs, not
-- with write volume, so a schedule running every minute for a year adds one row and 525,600 to an
-- integer. That ratio is the whole argument for a permanent ledger being affordable here.
--
-- IT STARTS EMPTY AND FILLS AS THINGS ARE WRITTEN. Nothing seeds it and nothing can: the writer was
-- never recorded anywhere, so there is no history to read back. A key written before today and never
-- written again has no row and never will. The honest consequence, worth stating where somebody will
-- find it: this answers "who is touching things now", not "who touched everything ever". 80% of the
-- keys measured had been written exactly once, and those are the ones least likely to return.

CREATE TABLE IF NOT EXISTS "MemoryWriteTally" (
    -- The namespace the key lives in, not the writer. Together with "key" this is the record.
    "ownerGaii"       TEXT   NOT NULL,
    "key"             TEXT   NOT NULL,
    -- The principal that WROTE it: a GHII, a GAII, a GEAI, `ext:{name}` or `schedule:{id}`.
    -- On erasure of the owner this principal names, it becomes `erased:{hash}` rather than
    -- disappearing — see pseudonymiseTallyWriter. The row belongs to the RECEIVING owner, and
    -- deleting it would turn their "four hands" into three.
    "writerPrincipal" TEXT   NOT NULL,
    "writeCount"      BIGINT NOT NULL DEFAULT 0,
    -- A delete is a hand on the key too, and the deletion-request answer wants to know whose.
    "deleteCount"     BIGINT NOT NULL DEFAULT 0,
    "firstAt"         TEXT   NOT NULL,
    "lastAt"          TEXT   NOT NULL,
    CONSTRAINT "MemoryWriteTally_pkey" PRIMARY KEY ("ownerGaii", "key", "writerPrincipal")
);

-- "how many hands have been on THIS key" — the per-record question, served by the primary key's
-- leading columns.
CREATE INDEX IF NOT EXISTS "idx_mwt_owner_key" ON "MemoryWriteTally" ("ownerGaii", "key");
-- "what has this agent been writing" — the per-principal question, which the primary key cannot serve.
CREATE INDEX IF NOT EXISTS "idx_mwt_writer" ON "MemoryWriteTally" ("writerPrincipal");

CREATE TABLE IF NOT EXISTS "MemoryFamilyTally" (
    "ownerGaii"       TEXT   NOT NULL,
    -- The key FAMILY, e.g. `news.<date>.*`. A data-map row is a family and never a key: one owner
    -- here has 3,407 keys in a single family, and a view listing them one per line is unreadable.
    "keyFamily"       TEXT   NOT NULL,
    "writerPrincipal" TEXT   NOT NULL,
    -- On what basis the family was identified AT THE TIME OF WRITING. Stored rather than recomputed:
    -- the classifier will learn things (it learned `crews.<agent>.*` the day it was written), and a
    -- later improvement must not silently rewrite what was true a year ago.
    "tier"            TEXT   NOT NULL DEFAULT '',
    "writeCount"      BIGINT NOT NULL DEFAULT 0,
    "deleteCount"     BIGINT NOT NULL DEFAULT 0,
    "firstAt"         TEXT   NOT NULL,
    "lastAt"          TEXT   NOT NULL,
    CONSTRAINT "MemoryFamilyTally_pkey" PRIMARY KEY ("ownerGaii", "keyFamily", "writerPrincipal")
);

CREATE INDEX IF NOT EXISTS "idx_mft_owner_family" ON "MemoryFamilyTally" ("ownerGaii", "keyFamily");
CREATE INDEX IF NOT EXISTS "idx_mft_writer" ON "MemoryFamilyTally" ("writerPrincipal");
