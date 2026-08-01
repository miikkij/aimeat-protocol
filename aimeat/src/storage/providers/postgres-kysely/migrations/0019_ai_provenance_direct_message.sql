-- 0019_ai_provenance_direct_message.sql
-- TARGET-058 Phase 4: the ATTACHED half for direct messages.
--
-- Every other surface this record can hang off publishes content and waits for a reader. A direct
-- message does the opposite: it DELIVERS AI-written text to one named person, which is the case
-- Article 50 cares most about and the one where "who wrote this" is hardest to reconstruct after
-- the fact. Without this column an agent's message reached a human inbox with no way for the
-- recipient's own client to say a model wrote it.
--
-- Both mailbox copies (the sender's outbound row and the recipient's inbound row) carry the SAME
-- id: the statement is about the bytes, not about whose row it is, and a record that differed per
-- copy would be two statements about one message.
--
-- NULL = UNSTATED, which is never the same as "a human wrote it".
ALTER TABLE "DirectMessage" ADD COLUMN IF NOT EXISTS "aiProvenanceId" TEXT;

-- Same reason as the Memory/App indexes in 0018: the visibility question is asked FROM the record
-- towards the items pointing at it, on a path that answers anonymous callers.
CREATE INDEX IF NOT EXISTS "DirectMessage_aiProvenanceId_idx"
  ON "DirectMessage"("aiProvenanceId") WHERE "aiProvenanceId" IS NOT NULL;
