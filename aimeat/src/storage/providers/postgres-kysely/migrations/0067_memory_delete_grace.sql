-- 0067 — the bin: a memory delete that can be taken back.
--
-- This node had no delete at all, on purpose: a value could be emptied but never removed, so
-- nothing could be lost by accident. That cost something real — an agent could write memory through
-- a tool and never clean up after itself, and `memory:delete` was a permission an owner could grant
-- that reached no tool at all. A delete with a way back keeps the principle and pays the cost.
--
-- DELETED IS NOT ARCHIVED. An archived row is kept and out of the way: still resolvable by key,
-- findable with an explicit archive search. A deleted one answers 404 by key, is absent from the
-- archive search too, and after the grace window the sweeper removes it for good. A "delete" that
-- never deletes would be a word that lies.
--
-- Nullable, no default, no backfill: every existing row is not deleted, which is what NULL says.

ALTER TABLE "Memory" ADD COLUMN IF NOT EXISTS "deletedAt"  TIMESTAMPTZ;
ALTER TABLE "Memory" ADD COLUMN IF NOT EXISTS "deletedBy"  TEXT;

-- The sweeper asks one question across every owner — which rows have been in the bin longer than
-- the window — and without this it is a full scan of the memory table on a timer. Partial, because
-- the answer is only ever about the small set that is in the bin at all.
CREATE INDEX IF NOT EXISTS "idx_memory_deleted_at"
  ON "Memory" ("deletedAt") WHERE "deletedAt" IS NOT NULL;
