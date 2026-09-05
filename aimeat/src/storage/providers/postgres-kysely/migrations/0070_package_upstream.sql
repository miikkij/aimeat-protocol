-- 0070_package_upstream.sql
--
-- Where a package came from, when it was pulled off another node: the source node and URL, the
-- instant its signature says it was published there, the author's GHII as provenance, and the public
-- key that signature was checked against.
--
-- ONE JSONB COLUMN, NOT EIGHT SCALARS. Nothing queries inside it: a package is found by group id and
-- version, and the upstream block is read whole when deciding whether a later pull is newer. Eight
-- columns would be eight migrations the next time the shape moves.
--
-- Nullable, because a package made on this node has no upstream and never will.
-- Mirrors the SQLite safeAddColumn('packages','upstream','TEXT').

ALTER TABLE "Package" ADD COLUMN IF NOT EXISTS "upstream" JSONB;
