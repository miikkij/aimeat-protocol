-- 0030_invitation_node_level.sql
--
-- Let an invitation invite someone to the NODE, not only to an organism.
--
-- The agent door (remake 4b, 12-ai-rekisteroi.md) emails a single-use expiring token that ends in
-- an account — which is exactly what this table already models. The only things that did not fit
-- were the mandatory organism and the per-variant extras, so:
--
--   * "organismId" becomes NULLable. An invitation is "an emailed, single-use, expiring token that
--     ends in an account"; which organism it ALSO joins you to belongs to one variant rather than
--     to the shape. This is what let the registration invite reuse this record, its accept endpoint
--     and its account-creation path instead of growing a second copy of all three.
--
--   * "meta" is one JSONB blob rather than a column per variant. A registration invite stores what
--     the AI CLAIMED about itself (model, vendor, client) beside what the SERVER observed
--     (ip, userAgent, at) — kept apart on purpose, because the first is a self-report and the
--     second is evidence. Nothing in it is trusted for authorization; it exists so the recipient of
--     an unrequested email can judge and trace the request that caused it.
--
--   * "type" gains 'registration' as a value. No constraint change is needed (the column is a plain
--     text with a default), so this is documentation of intent rather than DDL.
--
-- Existing rows are untouched: every one of them has an organismId and no meta.

ALTER TABLE "Invitation" ALTER COLUMN "organismId" DROP NOT NULL;

ALTER TABLE "Invitation" ADD COLUMN IF NOT EXISTS "meta" JSONB;

-- The per-address abuse cap on the open registration endpoint reads invitations by recipient, so
-- that lookup gets an index of its own rather than scanning.
CREATE INDEX IF NOT EXISTS "Invitation_emailHash_idx" ON "Invitation"("emailHash");
