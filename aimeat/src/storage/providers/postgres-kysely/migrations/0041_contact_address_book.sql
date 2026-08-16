-- 0041_contact_address_book.sql
-- TARGET-063: the outbound recipient registry becomes the ADDRESS-BOOK entry for a person the
-- node does not have. Three additive columns, all defaulted, so every existing row reads back
-- unchanged and no backfill is required for the send path.
--
--   emailHash  the join key promotion uses. Same hash as "GHII"."emailHash" (sha256 of the
--              lower-cased, trimmed address), so a person who verifies that address later is
--              found without a second copy of the address being stored anywhere queryable.
--              Backfilled below for existing rows; Postgres has no sha256 without pgcrypto, so
--              the backfill is left to the service (a row with an empty hash simply never
--              promotes, which is the pre-existing behaviour, not a regression).
--   links      where else this person is. JSON array of { label, url }.
--   relation   the owner's own word for the relationship. No vocabulary imposed.
ALTER TABLE "OutboundContact" ADD COLUMN IF NOT EXISTS "emailHash" text NOT NULL DEFAULT '';
ALTER TABLE "OutboundContact" ADD COLUMN IF NOT EXISTS "links" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "OutboundContact" ADD COLUMN IF NOT EXISTS "relation" text;

-- The promotion lookup is (emailHash, ghii IS NULL) across every owner, and it runs on a path a
-- person is waiting on (email verification). Partial, because a resolved row never promotes again.
CREATE INDEX IF NOT EXISTS "OutboundContact_emailHash_unresolved_idx"
  ON "OutboundContact" ("emailHash") WHERE "ghii" IS NULL;
