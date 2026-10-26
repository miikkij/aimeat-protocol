-- 0118_direct_message_reactions.sql
--
-- One person's acknowledgement mark on one direct message: a symbol (an emoji or a short word,
-- 1-32 characters) given instead of a reply.
--
-- A row per message, symbol and reactor, so the same person gives the same symbol once. The key is
-- the message id ("DirectMessage"."mid"), which every mailbox copy of the message shares, so one set
-- of rows on this node serves every local copy, a group thread's included. A reactor on another node
-- sends the mark here signed, the way a read receipt travels (services/message-reactions.ts).
--
--   "reactorGhii"  the person (GHII), or an agent reacting as itself (GAII)
--   "byAgent"      the agent that gave it in its owner's name; "reactorGhii" is then the owner
--
-- Nothing existing changes: a message with no row has no reactions.
--
-- Mirrors the SQLite table direct_message_reactions in schema-tables-3.ts.
CREATE TABLE IF NOT EXISTS "DirectMessageReaction" (
    "messageId" TEXT NOT NULL,
    "reaction" TEXT NOT NULL,
    "reactorGhii" TEXT NOT NULL,
    "byAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DirectMessageReaction_pkey" PRIMARY KEY ("messageId", "reaction", "reactorGhii")
);
