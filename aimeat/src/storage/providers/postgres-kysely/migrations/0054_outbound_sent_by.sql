-- 0054_outbound_sent_by.sql
--
-- WHO pressed send.
--
-- The send log has always recorded `ownerGhii`, and 0049 added `organismId` so it could say which
-- COMPANY spoke. Neither of those is a person. `ownerGhii` is the BOOK the send belongs to — the
-- company's owner once a company is named — which is the right key for opt-outs, suppression and
-- the daily allowance, and is deliberately shared by everyone sending for that company.
--
-- So a team of three working out of one shared registry produced a log in which every row looked
-- identical, and "what have I sent" had no answer, not even for the person asking about themselves.
-- That was tolerable while every message left through the same address. It stops being tolerable now
-- that a message can leave through the SENDER'S OWN mailbox: the recipient sees one person's
-- address in their inbox, and a log that cannot name that person disagrees with what the recipient
-- is looking at.
--
-- An exact principal (GHII / GAII / GEAI), so an agent that sent on someone's behalf is recorded as
-- the agent rather than collapsed onto its owner — the same attribution rule the workspace write
-- path keeps.
--
-- NULL for everything sent before this migration, and for a send with no authenticated caller.
-- Null means "not recorded", never "the owner": guessing would put a name on a row nobody chose.

ALTER TABLE "OutboundMessage" ADD COLUMN IF NOT EXISTS "sentBy" TEXT;

-- "What has this person sent", per owner book, newest first. The owner is the leading column
-- because every read of this table is already scoped to one book — a cross-owner query does not
-- exist and must not become cheap.
CREATE INDEX IF NOT EXISTS "OutboundMessage_owner_sentby_idx"
  ON "OutboundMessage"("ownerGhii", "sentBy", "createdAt" DESC)
  WHERE "sentBy" IS NOT NULL;
