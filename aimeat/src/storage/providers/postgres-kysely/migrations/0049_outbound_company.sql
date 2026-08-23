-- 0049_outbound_company.sql — which company sent an outbound message (TARGET-072).
--
-- The send door has taken a `company_id` since it was written, and it reached the SMTP identity and
-- stopped there: the log recorded who the OWNER was and nothing about which of their companies had
-- spoken. So an owner with two companies had one sending reputation, one daily cap, and no way to
-- answer "what did this company send" — while their invoices, vouchers and fiscal years had carried
-- an organism id all along.
--
-- The column is the ORGANISM, not the company, for the same reason the finance records use it: it
-- is the key those records already carry, and keying sending on something else would mean two
-- different answers to "which company is this" living one table apart.
--
-- NULL for every send made before this, and for every owner who never splits their companies. The
-- cap only narrows when a caller asks for one company, so nothing about an existing account changes.

ALTER TABLE "OutboundMessage" ADD COLUMN IF NOT EXISTS "organismId" text;

-- The daily cap is a rolling 24 h count for one owner, and now optionally for one of their
-- companies. Same shape as the owner index beside it, with the company in the middle.
CREATE INDEX IF NOT EXISTS "OutboundMessage_owner_company_created_idx"
  ON "OutboundMessage" ("ownerGhii", "organismId", "createdAt");
