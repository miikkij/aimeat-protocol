-- 0072_semantic_parity.sql
--
-- The `semantic` annotation on the five record types that had it on SQLite and not here.
--
-- WHAT WAS WRONG. SemanticAnnotation is a JSON-LD-compatible block (Phase 0.7b) declared on nine
-- record types. Postgres carried a column for four of them — Action, Csm, Listing, Organism — and
-- the other five lived on SQLite alone: Agent, Board, BoardPost, Ghii, PersonalNode. Nothing threw:
-- the field is optional, so a write dropped it and a read returned undefined. What made it visible
-- is that two routes ALREADY put it in their answers — routes/boards.ts and routes/catalogue.ts
-- both project `semantic` — so on the production backend those responses have been carrying a
-- permanently absent field, while the same call against a local SQLite node returned the real
-- annotation. Found by the 2026-09-06 review as item 5.8.
--
-- WHY ADD RATHER THAN REMOVE. Unlike StorageFileRecord.accessCode (item 5.7, deleted the same day
-- because nothing anywhere set or read it), this one is written: the annotation reaches these
-- records through their own write paths and is served by two live routes. The absence is the defect.
--
-- JSONB, matching the four columns that already exist. NULL means "no annotation", which is what
-- `undefined` means on the record, so no backfill is needed or possible: the rows that predate this
-- never had one.

ALTER TABLE "Agent"        ADD COLUMN IF NOT EXISTS "semantic" JSONB;
ALTER TABLE "Board"        ADD COLUMN IF NOT EXISTS "semantic" JSONB;
ALTER TABLE "BoardPost"    ADD COLUMN IF NOT EXISTS "semantic" JSONB;
ALTER TABLE "Ghii"         ADD COLUMN IF NOT EXISTS "semantic" JSONB;
ALTER TABLE "PersonalNode" ADD COLUMN IF NOT EXISTS "semantic" JSONB;
