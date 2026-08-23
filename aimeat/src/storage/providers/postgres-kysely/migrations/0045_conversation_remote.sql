-- 0045_conversation_remote.sql
--
-- A support thread that arrived from a peer keeps the one party who lives on the other node, so the
-- answer has somewhere to go.
--
-- It is deliberately NOT a participant. Membership stays node-local, because a group thread is n
-- mailbox copies written in one pass, and a copy on a peer is a federation frame with its own
-- delivery, retry and membership-agreement problem — the limit createGroupConversation states and
-- refuses. An inbound support thread needs exactly one thing that limit forbids: a return address.
-- This is that, and nothing more, which is why it is a column rather than an entry in participants.

ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "remote" jsonb;
