-- 0038_organism_owners.sql
--
-- An organism had one owner, and the column holding them held two different facts.
--
-- `creatorGhii` answered both "who made this" and "who holds this". The first is history and cannot
-- change; the second is a role, and a role that only one account can hold has no way back when that
-- account becomes unreachable. A handover wrote the single column, so moving authority also rewrote
-- the past: this node's own development organism spent a month claiming it was created by an account
-- that joined it five weeks after it existed.
--
-- Splitting them costs two columns.
--
--   createdBy — immutable. A handover never touches it again.
--   owners    — the authority, plural. Never empty; the last owner cannot be removed, only replaced.
--
-- BACKFILL. Both start from `creatorGhii`, because it is the only answer the node ever recorded.
-- For `owners` that is exactly right. For `createdBy` it is right on every organism that never
-- changed hands, and wrong on the ones that did — there is no record of who held it before a
-- handover, so this backfill cannot recover it. The alternative, leaving the column null, would put
-- the same wrong answer in front of every reader anyway (`createdBy ?? creatorGhii`) while also
-- losing the ones it gets right. Where the true creator is known it is corrected by hand.
--
-- `creatorGhii` stays, as a MIRROR of owners[0] maintained by services/organism-ownership.ts, so
-- federation payloads, exports and v4 clients keep reading a field that is still true. It is
-- deprecated as of 2026-08-15 and removed in v5.0; nothing new should compare against it.

ALTER TABLE "Organism" ADD COLUMN IF NOT EXISTS "createdBy" TEXT;
ALTER TABLE "Organism" ADD COLUMN IF NOT EXISTS "owners" TEXT[];

UPDATE "Organism" SET "createdBy" = "creatorGhii" WHERE "createdBy" IS NULL;
UPDATE "Organism" SET "owners" = ARRAY["creatorGhii"] WHERE "owners" IS NULL OR cardinality("owners") = 0;
