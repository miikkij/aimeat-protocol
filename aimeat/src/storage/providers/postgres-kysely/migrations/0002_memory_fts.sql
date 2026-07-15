-- 0002_memory_fts.sql — Postgres-specific memory optimisations (the point of a per-backend adapter).
-- The base schema (0001, generated from schema.postgres.prisma) gives the tables + btree indexes; these
-- two add what Postgres does better than the ORM ever exposed: ranked full-text over searchBlob, and a
-- prefix-scan index so `key LIKE 'organism.{id}.%'` is an index range scan (organism content is addressed
-- by key). Kept as a separate migration so the base stays a faithful 1:1 of the canonical schema.

-- Ranked full-text: a STORED generated tsvector over searchBlob + a GIN index. Matches the FTS the
-- Phase-4 KyselyPgAdapter proved (searchText → search_tsv @@ plainto_tsquery, ranked by ts_rank).
ALTER TABLE "Memory" ADD COLUMN IF NOT EXISTS "searchTsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce("searchBlob", ''))) STORED;
CREATE INDEX IF NOT EXISTS "Memory_searchTsv_gin" ON "Memory" USING GIN ("searchTsv");

-- Prefix scans: the default btree "Memory_key_idx" does not serve `key LIKE 'prefix%'` unless the DB
-- collation is C; add a text_pattern_ops index that always does.
CREATE INDEX IF NOT EXISTS "Memory_key_pattern_idx" ON "Memory" ("key" text_pattern_ops);

-- App-side ids are generated (cuid/uuid) like Prisma did; give surrogate id columns a DB default too so a
-- Kysely insert that omits id still succeeds (defensive — the mappers set id explicitly).
ALTER TABLE "Memory" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "MemoryVersion" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
