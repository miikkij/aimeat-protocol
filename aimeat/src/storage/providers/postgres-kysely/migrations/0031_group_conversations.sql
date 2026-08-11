-- 0031_group_conversations.sql
--
-- A conversation with MORE than two participants.
--
-- Until now a thread was a pair: its id is a hash of the two sorted identities, so both nodes derive
-- the same id with no coordination and no stored row (see utils/messaging.ts conversationIdFor).
-- That is a good design for a pair and it cannot express three people, or two people and two AIs.
--
-- So a group thread gets a row, and a pair thread still does not. Nothing migrates: every
-- conversation that existed before this table keeps deriving its id exactly as it did, and the
-- absence of a row IS the statement "this is a pair".
--
-- "participants" is a JSONB array of identities (GHII, GAII or GEAI). It is the membership list, not
-- a delivery list: each participant still gets their own mailbox copy of every message, which is
-- what keeps read receipts, deletion and federation working per person rather than per thread.
--
-- "alias" records that the thread was OPENED through a named address rather than by picking people
-- (support@operators fans out to whoever holds the operator role). It is kept because "who this was
-- addressed to" and "who happened to be an operator that day" are different facts, and the second
-- one changes.

CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'group',
    "subject" TEXT,
    "participants" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "alias" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Conversation_alias_updatedAt_idx" ON "Conversation"("alias", "updatedAt");
