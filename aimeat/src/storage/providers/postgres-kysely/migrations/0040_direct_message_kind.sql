-- What KIND of message this is, when it is not a person writing to a person.
--
-- 'system-fault' is the node reporting its own failure to whoever runs it, without the user having
-- been asked to describe anything. Operators triage the two differently: a person's question wants
-- an answer, a fault report wants a fix and at most an acknowledgement. Before this column an
-- operator's inbox could not tell them apart, so the only way to run the channel was to read every
-- message as if a person were waiting on it.
--
-- NULL means an ordinary message, which is every row that already exists.
ALTER TABLE "DirectMessage" ADD COLUMN IF NOT EXISTS "kind" TEXT;

-- The operator view opens on "what has the node reported lately", so the index is on the pair the
-- inbox actually filters by rather than on the column alone.
CREATE INDEX IF NOT EXISTS "DirectMessage_kind_createdAt_idx"
    ON "DirectMessage" ("kind", "createdAt" DESC)
    WHERE "kind" IS NOT NULL;
