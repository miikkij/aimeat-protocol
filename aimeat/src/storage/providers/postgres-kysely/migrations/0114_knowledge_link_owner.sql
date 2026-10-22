-- 0114_knowledge_link_owner.sql
--
-- A knowledge link row belongs to the namespace that holds its source package manifest.
--
-- The row named its source by the manifest key alone (packages/<id>/manifest), and the table was unique
-- on (source, target). A key is unique within one namespace only: another account could write an
-- ordinary record of its own at packages/<id>/manifest, and the link routes then read, replaced and
-- deleted the package owner's link rows through that record; here the second account's row also made the
-- owner's own later link of the same target fail with 500 (secaudit 2026-10, v78).
--
-- "ownerGaii" is the ownerGaii of the record that holds the source manifest. The empty string marks a row
-- written before this migration: the once-only start step services/knowledge-link-owner-keep.ts places
-- each one with the namespace that holds its source in its contributor's account, and records what it
-- cannot place for the operator. Until then an unplaced row is listed as an incoming link only.
--
-- Mirrors the SQLite table rebuild in providers/sqlite/schema-knowledge-links.ts.

ALTER TABLE "KnowledgeLink" ADD COLUMN IF NOT EXISTS "ownerGaii" TEXT NOT NULL DEFAULT '';

DROP INDEX IF EXISTS "KnowledgeLink_source_target_key";

CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeLink_ownerGaii_source_target_key" ON "KnowledgeLink"("ownerGaii", "source", "target");

CREATE INDEX IF NOT EXISTS "KnowledgeLink_linkedBy_idx" ON "KnowledgeLink"("linkedBy");
