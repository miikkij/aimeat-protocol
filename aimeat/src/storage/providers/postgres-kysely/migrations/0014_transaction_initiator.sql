-- 0014_transaction_initiator.sql — who made the call, beside whose balance moved.
-- "gaii" is the payer and can only ever be a human GHII, because agents and apps hold no balance
-- of their own. Without a second column the ledger cannot say whether a charge came from the
-- person, one of their agents, or an app they once connected, and after the fact nobody can tell
-- them. Nullable: a call the owner made directly has no separate initiator.
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "initiatorGaii" TEXT;
